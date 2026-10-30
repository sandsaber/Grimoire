import '@/providers';

import { join } from 'node:path';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { AttachmentStore } from '@/core/attachments/AttachmentStore';
import type GrimoirePlugin from '@/main';
import { CommandcodeExecution } from '@/providers/commandcode/execution/CommandcodeExecutionComposition';
import type { CommandcodeInvocation, CommandcodeProcessRunner } from '@/providers/commandcode/runtime/CommandcodeProcess';
import { updateCommandcodeSettings } from '@/providers/commandcode/settings';

describe('Command Code image execution composition', () => {
  it('carries images from a prepared turn through the kernel to stdin and preserves text-only turns', async () => {
    const files = new Map<string, ArrayBuffer>();
    const plugin = {
      settings: { model: 'commandcode:vendor/vision', permissionMode: 'full_access' },
      app: { vault: { adapter: { basePath: '/vault' } } },
      storage: { attachments: new AttachmentStore({
        exists: async path => files.has(path), readBinary: async path => files.get(path)!,
        writeBinary: async (path, bytes) => { files.set(path, bytes); }, delete: async () => undefined,
        listFiles: async () => [...files.keys()], getResourcePath: path => path,
      }) },
      recordDebugLog: () => undefined, getApplicationRuntimeOrNull: () => null,
    } as unknown as GrimoirePlugin;
    updateCommandcodeSettings(plugin.settings, { enabled: true, imageAttachmentsAsFiles: true });
    const host = new ExecutionKernelHost({ storage: new TestDurableStorage(),
      scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined } });
    const execution = new CommandcodeExecution(plugin, host.registry);
    const invocations: CommandcodeInvocation[] = [];
    const runner: CommandcodeProcessRunner = { start: invocation => {
      invocations.push(invocation);
      return { started: Promise.resolve(), completed: Promise.resolve({ code: 0, result: { subtype: 'success', finalText: 'red' } }),
        confirmTerminated: async () => true, terminate: async () => 'confirmed' };
    } };
    host.registerBackend({ backend: execution.createBackend(runner) });
    await host.start();
    const runtime = execution.createRuntime();
    try {
      const request = { text: 'What color?', images: [{ id: 'image', name: 'color.png', mediaType: 'image/png' as const,
        data: 'cmVk', size: 3, source: 'paste' as const }] };
      const turn = runtime.prepareTurn(request);
      const chunks = [];
      for await (const chunk of runtime.query(turn, [], { model: 'commandcode:vendor/vision' })) chunks.push(chunk);
      expect(invocations).toHaveLength(1);
      expect(invocations[0]).toMatchObject({ cwd: '/vault', model: 'vendor/vision' });
      expect(files.size).toBe(1);
      expect(invocations[0].prompt).toContain(JSON.stringify(join('/vault', [...files.keys()][0])));
      expect(chunks).toContainEqual({ type: 'text', content: 'red' });
      updateCommandcodeSettings(plugin.settings, { imageAttachmentsAsFiles: false });
      expect(() => runtime.prepareTurn(request)).toThrow('Image attachments as files');
      for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Hello' }), [])) chunks.push(chunk);
      expect(invocations[1].prompt).toBe('Hello');
    } finally { await runtime.cleanup(); await host.dispose(); await execution.dispose(); }
  });
});
