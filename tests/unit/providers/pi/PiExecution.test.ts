import '@/providers';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { StreamChunk } from '@/core/types';
import { recalculateUsageForModel } from '@/features/chat/utils/usageInfo';
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
      setConfigOption: jest.fn(async request => {
        if (refuseModel) throw new Error('Selected model unavailable');
        return { configOptions: opened('native-pi').configOptions!.map(option =>
          option.type === 'select' && typeof request.value === 'string'
            ? { ...option, currentValue: request.value } : option) };
      }),
      setMode: jest.fn(), setModel: jest.fn(),
      prompt: jest.fn(async () => {
        notify({ sessionUpdate: 'usage_update', used: 0, size: 1000000 });
        notify({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'Compact' }] });
        notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } });
        notify({ sessionUpdate: 'usage_update', used: 2611, size: 1000000 });
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
    return { client, runtime, execution, host, plugin, notify,
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

  it.each(['pi:zai/test', 'pi:zai/override', 'pi'])('preserves the reported window for displayed model %s', async model => {
    const h = await harness();
    try {
      const chunks = await drain(h.runtime.query(h.runtime.prepareTurn({ text: 'Hello' }), [], { model }));
      const usage = chunks.filter(chunk => chunk.type === 'usage').at(-1)?.usage;
      expect(usage).toMatchObject({ model, contextTokens: 2611, contextWindow: 1000000, contextWindowIsAuthoritative: true });
      expect(recalculateUsageForModel(usage!, model, 0).contextWindow).toBe(1000000);
    } finally { await h.close(); }
  });

  it('keeps in-flight usage tied to the turn model when another tab changes the saved selection', async () => {
    const h = await harness();
    try {
      jest.mocked(h.client.prompt).mockImplementationOnce(async () => {
        h.plugin.settings.savedProviderModel.pi = 'pi:zai/other-tab';
        h.notify({ sessionUpdate: 'usage_update', used: 4000, size: 1000000 });
        h.notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'answer' } });
        return { stopReason: 'end_turn' };
      });
      const first = await drain(h.runtime.query(h.runtime.prepareTurn({ text: 'First' })));
      expect(first.filter(chunk => chunk.type === 'usage').at(-1)?.usage.model).toBe('pi:zai/test');
      const next = await drain(h.runtime.query(h.runtime.prepareTurn({ text: 'Next' })));
      expect(next.filter(chunk => chunk.type === 'usage').at(-1)?.usage.model).toBe('pi:zai/other-tab');
    } finally { await h.close(); }
  });
});
