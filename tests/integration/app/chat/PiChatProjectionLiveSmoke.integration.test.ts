import '@/providers';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeVaultAdapter } from '@test/helpers/nodeVaultAdapter';
import { openChatProjection, userMessage } from '@test/integration/app/chat/chatProjectionLiveHarness';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { VaultDurableStorage } from '@/app/storage/VaultDurableStorage';
import { AttachmentStore } from '@/core/attachments/AttachmentStore';
import { hydrateImagesForSend } from '@/core/attachments/hydrateImages';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { Conversation, ImageAttachment } from '@/core/types';
import { PiExecution } from '@/providers/pi/execution/PiExecutionComposition';
import { piProviderModule } from '@/providers/pi/PiProviderModule';
import { hydratePiHistory } from '@/providers/pi/runtime/PiHistory';
import { getPiSettings, updatePiSettings } from '@/providers/pi/settings';

// Opt-in: four paid turns, including vision. Requires authenticated Pi + pi-acp and an image-capable model.
const live = process.env.GRIMOIRE_PI_LIVE === '1' ? describe : describe.skip;

live('Pi live chat projection', () => {
  jest.setTimeout(180_000);

  it('discovers model-specific effort without dispatching a prompt', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-pi-models-'));
    const settings = {};
    updatePiSettings(settings, { enabled: true });
    const plugin = { settings, manifest: { version: 'test' }, app: { vault: { adapter: { basePath: vault } } },
      getAllViews: () => [], saveSettings: async () => undefined };
    const host = new ExecutionKernelHost({ storage: new VaultDurableStorage(nodeVaultAdapter(vault)),
      scheduler: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: h => clearTimeout(h as NodeJS.Timeout) } });
    const execution = new PiExecution(plugin as never, host.registry);
    host.registerBackend(execution.createBackendRegistration());
    await host.start();
    try {
      expect(await execution.discoverModels()).toBe(true);
      const models = getPiSettings(settings).discoveredModels;
      expect(models.length).toBeGreaterThan(0);
      for (const model of models) expect(model.thinkingLevels?.length).toBeGreaterThan(0);
      process.stdout.write(`PI EFFORT QA: ${JSON.stringify(models.map(({ rawId, thinkingLevels }) => ({ rawId, thinkingLevels })))}\n`);
    } finally { execution.dispose(); await host.dispose(); rmSync(vault, { recursive: true, force: true }); }
  });

  it('persists an answer, reloads the kernel, and resumes the native conversation', async () => {
    const model = process.env.GRIMOIRE_PI_MODEL;
    if (!model) throw new Error('Set GRIMOIRE_PI_MODEL to an explicitly selected inexpensive model (pi:provider/id).');
    const vault = mkdtempSync(join(tmpdir(), 'grimoire-pi-live-'));
    const running: Array<() => Promise<void>> = [];
    async function open() {
      const vaultAdapter = nodeVaultAdapter(vault);
      const effort = process.env.GRIMOIRE_PI_EFFORT;
      const settings: Record<string, unknown> = { savedProviderModel: { pi: model }, savedProviderEffort: { pi: effort ?? 'default' } };
      updatePiSettings(settings, { enabled: true });
      const plugin = { settings, manifest: { version: 'test' }, app: { vault: { adapter: { basePath: vault } } },
        getAllViews: () => [], saveSettings: async () => undefined };
      const host = new ExecutionKernelHost({ storage: new VaultDurableStorage(vaultAdapter),
        scheduler: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: h => clearTimeout(h as NodeJS.Timeout) } });
      const execution = new PiExecution(plugin as never, host.registry);
      host.registerBackend(execution.createBackendRegistration());
      await host.start();
      if (effort) await execution.discoverModels();
      expect(ProviderSettingsCoordinator.getProviderSettingsSnapshot(settings, 'pi').effortLevel).toBe(effort ?? 'default');
      const runtime = execution.createRuntime();
      const harness = await openChatProjection({ backendId: piProviderModule.execution.descriptor.backendId,
        conversationId: 'pi-live', lifecycle: host.registry, providerId: 'pi', runtime,
        vaultPath: vault, vaultAdapter, syncConversation: true });
      let closed = false;
      const close = async () => {
        if (closed) return;
        closed = true;
        await harness.close(); await runtime.cleanup(); execution.dispose(); await host.dispose();
      };
      running.push(close);
      return { harness, runtime, close };
    }
    try {
      const first = await open();
      const text = 'QA in a disposable directory. Run exactly one bash tool call: printf PI-TOOL-5827. Do not read or write files. Then remember cobalt-5827 and reply exactly cobalt-5827.';
      const send = await first.harness.tab.send({ text }, userMessage(text), { queryOptions: { model } });
      expect((await send.ticket.completion).terminal.kind).toBe('succeeded');
      await first.harness.tab.settled();
      await first.harness.saveAfterTurn();
      expect(first.harness.column.drawn.join('')).toContain('cobalt-5827');
      const session = first.runtime.getSessionId();
      expect(session).toBeTruthy();
      const saved = await first.harness.sessions.records.read('pi-live');
      expect(saved.kind).toBe('present');
      if (saved.kind !== 'present') throw new Error('Missing persisted session');
      expect(saved.metadata.sessionId).toBe(session);
      const tools = (saved.metadata.messages ?? []).flatMap(message => message.toolCalls ?? []);
      expect(tools).toContainEqual(expect.objectContaining({ status: 'completed', result: expect.stringContaining('PI-TOOL-5827') }));
      await first.close();
      const recovered = { sessionId: session, messages: [] } as unknown as Conversation;
      expect(await hydratePiHistory(recovered, vault)).toEqual({ outcome: 'recovered', reason: 'nativePiTranscript' });
      expect(recovered.messages.some(message => message.role === 'assistant' && message.content.includes('cobalt-5827'))).toBe(true);
      const second = await open();
      const reopened = await second.harness.sessions.records.read('pi-live');
      expect(reopened.kind === 'present' && reopened.metadata).toEqual(saved.metadata);
      expect(second.harness.column.state.messages).toEqual(saved.metadata.messages);

      const followup = 'What exact token did I ask you to remember? Reply with that token only. Do not use tools.';
      const resumed = await second.harness.tab.send({ text: followup }, userMessage(followup), {
        queryOptions: { model }, nativeSessionRef: session ?? undefined,
      });
      expect((await resumed.ticket.completion).terminal.kind).toBe('succeeded');
      await second.harness.tab.settled();
      expect(second.runtime.getSessionId()).toBe(session);
      expect(second.harness.column.drawn.join('')).toContain('cobalt-5827');
      expect(second.harness.column.failures).toEqual([]);
      await second.harness.saveAfterTurn();
      const attachments = new AttachmentStore(nodeVaultAdapter(vault));
      const pngs = [1, 2].map(index => readFileSync(join(__dirname, '../../../fixtures/pi', `attachment-${index}.png`)));
      const images: ImageAttachment[] = await Promise.all(pngs.map(async (png, index) => ({
        ...await attachments.put(Uint8Array.from(png).buffer, 'image/png'),
        id: `pi-image-${index}`, name: `attachment-${index}.png`, source: 'paste' as const, data: '',
      })));
      await hydrateImagesForSend(images, attachments);
      const imageText = 'Identify the dominant colors of these two attached images, in order. Reply with only the two English color names. Do not use tools or read files. If you cannot see the images, say unavailable.';
      const vision = await second.harness.tab.send({ text: imageText, images }, { ...userMessage(imageText), images }, { queryOptions: { model } });
      expect((await vision.ticket.completion).terminal.kind).toBe('succeeded');
      await second.harness.tab.settled();
      await second.harness.saveAfterTurn();
      const answer = second.harness.column.state.messages.filter(message => message.role === 'assistant').at(-1)?.content;
      expect(answer).toMatch(/yellow[\s\S]*green/i);
      const withImages = await second.harness.sessions.records.read('pi-live');
      expect(withImages.kind).toBe('present');
      if (withImages.kind !== 'present') throw new Error('Missing image session');
      const storedImages = withImages.metadata.messages?.find(message => message.images?.length)?.images;
      expect(storedImages?.map(image => image.hash)).toEqual(images.map(image => image.hash));
      const raw = readFileSync(join(vault, '.grimoire/sessions/pi-live.meta.json'), 'utf8');
      expect(raw).not.toContain(pngs[0].toString('base64'));
      await second.close();
      const third = await open();
      const imageReload = await third.harness.sessions.records.read('pi-live');
      expect(imageReload.kind === 'present' && imageReload.metadata).toEqual(withImages.metadata);
      const restoredImages = storedImages!.map(image => ({ ...image, data: '' }));
      await hydrateImagesForSend(restoredImages, new AttachmentStore(nodeVaultAdapter(vault)));
      expect(restoredImages.map(image => image.data)).toEqual(pngs.map(png => png.toString('base64')));
      const native = { sessionId: session, messages: [] } as unknown as Conversation;
      expect((await hydratePiHistory(native, vault)).outcome).toBe('recovered');
      expect(native.messages.find(message => message.images?.length)?.images?.map(image => image.data))
        .toEqual(pngs.map(png => png.toString('base64')));
      const recall = 'Without tools or reading files, repeat the token I asked you to remember and the two image colors in their original order.';
      const last = await third.harness.tab.send({ text: recall }, userMessage(recall), { queryOptions: { model }, nativeSessionRef: session ?? undefined });
      expect((await last.ticket.completion).terminal.kind).toBe('succeeded');
      await third.harness.tab.settled();
      await third.harness.saveAfterTurn();
      expect(third.runtime.getSessionId()).toBe(session);
      const recalled = third.harness.column.state.messages.filter(message => message.role === 'assistant').at(-1)?.content;
      expect(recalled).toMatch(/cobalt-5827/);
      expect(recalled).toMatch(/yellow[\s\S]*green/i);
      expect(third.harness.column.state.messages.filter(message => message.role === 'user')).toHaveLength(4);
      expect(third.harness.column.failures).toEqual([]);
      process.stdout.write(`PI QA: disk reload, tool results, two native images, image bytes and native recall passed (${model}).\n`);
    } finally {
      for (const close of running) await close();
      rmSync(vault, { recursive: true, force: true });
    }
  });
});
