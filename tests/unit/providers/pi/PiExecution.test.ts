import '@/providers';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { StreamChunk } from '@/core/types';
import type { ManagedAcpClient, ManagedAcpClientFactory } from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpNewSessionResponse, AcpSessionNotification } from '@/providers/acp/types';
import { PiExecution } from '@/providers/pi/execution/PiExecutionComposition';
import * as settings from '@/providers/pi/settings';

describe('Pi execution wiring', () => {
  afterEach(() => jest.restoreAllMocks());

  async function harness(refuseModel = false) {
    jest.spyOn(settings, 'resolvePiAdapter').mockReturnValue('/usr/bin/pi-acp');
    jest.spyOn(settings, 'resolvePiCommand').mockReturnValue('/usr/bin/pi');
    const plugin = { settings: { savedProviderModel: { pi: 'pi:zai/test' } },
      app: { vault: { adapter: { basePath: '/tmp' } } }, manifest: { version: 'test' },
      getAllViews: () => [], saveSettings: async () => undefined };
    settings.updatePiSettings(plugin.settings, { enabled: true });
    const host = new ExecutionKernelHost({ storage: new TestDurableStorage(), scheduler: {
      setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
    } });
    const opened = (sessionId: string): AcpNewSessionResponse => ({ sessionId, configOptions: [
      { type: 'select', id: 'model', category: 'model', name: 'Model', currentValue: 'zai/test',
        options: [{ value: 'zai/test', name: 'Test' }] },
    ] });
    const listeners = new Set<(event: AcpSessionNotification) => void>();
    const notify = (update: AcpSessionNotification['update']) => listeners.forEach(fn => fn({ sessionId: 'native-pi', update }));
    const client: ManagedAcpClient = {
      initialize: jest.fn(async () => undefined),
      newSession: jest.fn(async () => opened('native-pi')),
      loadSession: jest.fn(async request => opened(request.sessionId)),
      setConfigOption: jest.fn(async () => {
        if (refuseModel) throw new Error('Selected model unavailable');
        return { configOptions: opened('native-pi').configOptions! };
      }),
      setMode: jest.fn(), setModel: jest.fn(),
      prompt: jest.fn(async () => {
        notify({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'Compact' }] });
        notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } });
        return { stopReason: 'end_turn' };
      }),
      cancel: jest.fn(), close: jest.fn(async () => 'confirmed' as const),
      onSessionNotification: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
      onConnectionLost: () => () => undefined,
    };
    const factory: ManagedAcpClientFactory = { create: jest.fn(async () => client) };
    const execution = new PiExecution(plugin as never, host.registry);
    host.registerBackend(execution.createBackendRegistration(factory));
    await host.start();
    const runtime = execution.createRuntime();
    return { client, runtime, execution, host, plugin,
      close: async () => { await runtime.cleanup(); execution.dispose(); await host.dispose(); } };
  }

  async function drain(stream: AsyncGenerator<StreamChunk>) {
    const chunks: StreamChunk[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return chunks;
  }

  it('delivers text once, images natively, and no MCP or permission-mode requests', async () => {
    const h = await harness();
    try {
      const chunks = await drain(h.runtime.query(h.runtime.prepareTurn({ text: 'Describe',
        images: [{ id: 'image', name: 'test.png', source: 'file', mediaType: 'image/png', data: 'AA==', size: 1 }],
        enabledMcpServers: new Set(['ignored']) })));
      expect(chunks.filter(chunk => chunk.type === 'text').map(chunk => chunk.content).join('')).toBe('answer');
      expect(h.client.newSession).toHaveBeenCalledWith(expect.objectContaining({ mcpServers: [] }));
      expect(h.client.prompt).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.arrayContaining([
        { type: 'image', data: 'AA==', mimeType: 'image/png' },
      ]) }));
      expect(h.client.setMode).not.toHaveBeenCalled();
      expect(h.client.setConfigOption).toHaveBeenCalledWith(expect.objectContaining({ configId: 'model', value: 'zai/test' }));
      expect(h.runtime.getSessionId()).toBe('native-pi');
    } finally { await h.close(); }
  });

  it('loads only the conversation native session', async () => {
    const h = await harness();
    try {
      h.runtime.syncConversationState({ sessionId: 'saved-pi', providerState: {} });
      await drain(h.runtime.query(h.runtime.prepareTurn({ text: 'Continue' })));
      expect(h.client.loadSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'saved-pi' }));
      expect(h.client.newSession).not.toHaveBeenCalled();
    } finally { await h.close(); }
  });

  it('does not dispatch a prompt if the model change was refused', async () => {
    const h = await harness(true);
    try {
      const chunks = await drain(h.runtime.query(h.runtime.prepareTurn({ text: 'Hello' })));
      expect(h.client.prompt).not.toHaveBeenCalled();
      expect(chunks).toContainEqual(expect.objectContaining({ type: 'error', content: expect.stringContaining('Selected model unavailable') }));
    } finally { await h.close(); }
  });
});
