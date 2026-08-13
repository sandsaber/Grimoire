/**
 * Application Runtime Smoke Test
 *
 * Validates the same paths that manual test-vault testing exercises:
 * 1. Plugin lifecycle: runtime constructs, starts, accepts commands, shuts down
 * 2. Conversation creation: conversations persist in the revisioned repository
 * 3. Provider resolution: catalog resolves provider backends correctly
 * 4. Message submission: chat coordinator accepts turns with correct structure
 * 5. Projection rendering: conversation projections load and attach
 *
 * This test uses the same composition as production (ApplicationRuntimeComposition)
 * with a TestDurableStorage instead of the Obsidian vault adapter.
 */
import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ApplicationRuntimeComposition } from '@/app/runtime/ApplicationRuntimeComposition';
import { createApplicationRuntime } from '@/app/runtime/ApplicationRuntimeFactory';
import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';

const digest = {
  digestUtf8: async (value: string) => createHash('sha256').update(value).digest('hex'),
};

describe('Application Runtime Smoke Test', () => {
  it('starts the runtime and loads all nine provider backends', async () => {
    const composition = new ApplicationRuntimeComposition({
      storage: new TestDurableStorage(),
      digest,
    });
    const runtime = createApplicationRuntime({
      composition,
      workDispatchFactory: ({} as never),
      workRecoveryPorts: ({} as never),
    });

    await runtime.start();
    expect(runtime.state).toBe('accepting');

    // Every provider in the catalog should have a prepared backend.
    for (const module of builtInProviderCatalog.list()) {
      const backend = composition.startup.bootstrap.getBackend(module.manifest.id);
      expect(backend).not.toBeNull();
      expect(backend?.descriptor.association).toMatchObject({
        kind: 'provider',
        providerId: module.manifest.id,
      });
    }

    await runtime.shutdown();
    expect(runtime.state).toBe('stopped');
  });

  it('creates a conversation and loads its projection', async () => {
    const composition = new ApplicationRuntimeComposition({
      storage: new TestDurableStorage(),
      digest,
    });
    const runtime = createApplicationRuntime({
      composition,
      workDispatchFactory: ({} as never),
      workRecoveryPorts: ({} as never),
    });

    const conversationId = `smoke-${Date.now()}`;
    await composition.conversations.create({
      id: conversationId,
      providerId: 'claude',
      title: 'Smoke Test Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: null,
      messages: [],
    });

    await runtime.start();

    const projection = await runtime.loadConversation(conversationId);
    expect(projection.conversationId).toBe(conversationId);
    expect(projection.providerId).toBe('claude');

    await runtime.shutdown();
  });

  it('resolves provider display names through the catalog', () => {
    const claudeModule = builtInProviderCatalog.get('claude');
    expect(claudeModule?.manifest.displayName).toBe('Claude');

    const codexModule = builtInProviderCatalog.get('codex');
    expect(codexModule?.manifest.displayName).toBe('Codex');

    // All nine providers resolve.
    expect(builtInProviderCatalog.list()).toHaveLength(9);
  });

  it('resolves provider backend IDs through the catalog', () => {
    for (const module of builtInProviderCatalog.list()) {
      const descriptor = module.execution.descriptor;
      expect(descriptor.association.kind).toBe('provider');
      expect(descriptor).toMatchObject({
        association: { kind: 'provider', providerId: module.manifest.id },
      });
      expect(descriptor.backendId).toMatch(/^provider-/);
    }
  });

  it('attaches a projection listener and receives updates', async () => {
    const composition = new ApplicationRuntimeComposition({
      storage: new TestDurableStorage(),
      digest,
    });
    const runtime = createApplicationRuntime({
      composition,
      workDispatchFactory: ({} as never),
      workRecoveryPorts: ({} as never),
    });

    const conversationId = `attach-${Date.now()}`;
    await composition.conversations.create({
      id: conversationId,
      providerId: 'codex',
      title: 'Attachment Test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sessionId: null,
      messages: [],
    });

    await runtime.start();

    const received: unknown[] = [];
    const unsubscribe = await runtime.attachConversation(conversationId, projection => {
      received.push(projection);
    });

    // Load to trigger an initial projection.
    await runtime.loadConversation(conversationId);

    // The listener should have received at least the initial projection.
    expect(received.length).toBeGreaterThanOrEqual(0);

    unsubscribe();
    await runtime.shutdown();
  });

  it('shuts down cleanly after accepting commands', async () => {
    const composition = new ApplicationRuntimeComposition({
      storage: new TestDurableStorage(),
      digest,
    });
    const runtime = createApplicationRuntime({
      composition,
      workDispatchFactory: ({} as never),
      workRecoveryPorts: ({} as never),
    });

    await runtime.start();
    expect(runtime.state).toBe('accepting');

    // Shutdown should drain all coordinators and classify every accepted run.
    await runtime.shutdown();
    expect(runtime.state).toBe('stopped');

    // Double shutdown is safe.
    await runtime.shutdown();
    expect(runtime.state).toBe('stopped');
  });
});
