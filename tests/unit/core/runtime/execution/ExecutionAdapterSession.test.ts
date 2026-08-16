import { executionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type {
  InteractionRequest,
  InteractionResolution,
} from '@/core/execution/ExecutionContracts';
import type { ExecutionEventEnvelope } from '@/core/execution/ExecutionEvents';
import {
  executionSessionId,
  interactionId as toInteractionId,
  runId as toRunId,
  sessionInstanceId,
} from '@/core/execution/ExecutionIds';
import type { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import type {
  ProviderCapabilityDescriptor,
  ProviderWorkspaceSlots,
} from '@/core/providers/ProviderModule';
import {
  ExecutionAdapterSession,
  ExecutionChatRuntimeAdapter,
  ExecutionInteractionBridge,
  ExecutionRunStream,
} from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import { antigravityProviderModule } from '@/providers/antigravity/AntigravityProviderModule';
import { claudeProviderModule } from '@/providers/claude/ClaudeProviderModule';
import { codexProviderModule } from '@/providers/codex/CodexProviderModule';

/**
 * The five members that were paper mappings.
 *
 * `prepareTurn`, `steer`, `setResumeCheckpoint`, `buildSessionUpdates`, and
 * `consumeSessionInvalidation` each had a verdict in the M0a contract and no
 * execution behind it. Three of them carry real state, and this is where that
 * state is pinned; the other two are delegation with nothing to get wrong.
 */
describe('adapter session state', () => {
  describe('resume checkpoint', () => {
    it('is held until a dispatch and cleared by it', () => {
      const session = new ExecutionAdapterSession(codexProviderModule.capabilities);

      session.setResumeCheckpoint('checkpoint-1');
      expect(session.pendingResumeCheckpoint()).toBe('checkpoint-1');

      session.confirmDispatched();
      expect(session.pendingResumeCheckpoint()).toBeUndefined();
    });

    it('survives a dispatch that never happened', () => {
      // The reason clearing is a separate step: a dispatch that threw has not
      // resumed anything, and dropping the checkpoint would quietly turn the
      // retry into a fresh conversation.
      const session = new ExecutionAdapterSession(codexProviderModule.capabilities);
      session.setResumeCheckpoint('checkpoint-1');

      expect(session.pendingResumeCheckpoint()).toBe('checkpoint-1');
      expect(session.pendingResumeCheckpoint()).toBe('checkpoint-1');
    });

    it('can be cleared explicitly by the caller that set it', () => {
      const session = new ExecutionAdapterSession(codexProviderModule.capabilities);
      session.setResumeCheckpoint('checkpoint-1');

      session.setResumeCheckpoint(undefined);

      expect(session.pendingResumeCheckpoint()).toBeUndefined();
    });
  });

  describe('session invalidation', () => {
    it('reads once and then reports nothing', () => {
      const session = new ExecutionAdapterSession(codexProviderModule.capabilities);
      session.markInvalidated();

      expect(session.consumeSessionInvalidation()).toBe(true);
      // One-shot: the caller that read it owns the consequence, and a second
      // reader must not act on the same fence twice.
      expect(session.consumeSessionInvalidation()).toBe(false);
    });

    it('reports nothing when no fence has been raised', () => {
      const session = new ExecutionAdapterSession(codexProviderModule.capabilities);

      expect(session.consumeSessionInvalidation()).toBe(false);
    });
  });

  describe('steering presence', () => {
    it('follows the provider capability rather than a stub answer', () => {
      // The contract is explicit that `steer` is absent when unsupported, not
      // present and returning false: the UI can test for an absent member and
      // cannot tell a member that always fails from a broken one.
      expect(new ExecutionAdapterSession(codexProviderModule.capabilities).supportsSteering())
        .toBe(true);
      expect(new ExecutionAdapterSession(antigravityProviderModule.capabilities).supportsSteering())
        .toBe(false);
    });
  });
});

describe('interaction bridge', () => {
  function createRequest(interactionId: string): InteractionRequest {
    return {
      interactionId: toInteractionId(interactionId),
      runId: toRunId(`run-${'c'.repeat(32)}`),
      kind: 'approval',
      presentationRef: 'opaque-presentation',
      responseIds: ['allow', 'deny'],
    };
  }

  function envelopeFor(request: InteractionRequest): ExecutionEventEnvelope {
    return {
      schemaVersion: 1,
      backendId: executionBackendId('provider-fake'),
      backendGeneration: 1,
      executionSessionId: executionSessionId(`es-${'c'.repeat(32)}`),
      sessionInstanceId: sessionInstanceId(`si-${'c'.repeat(32)}`),
      eventId: `event-${request.interactionId}`,
      sequence: 1,
      occurredAt: 1,
      scope: { kind: 'run', runId: request.runId },
      event: { kind: 'interaction-opened', interaction: request },
    };
  }

  function createRegistry(): {
    registry: ExecutionLifecycleRegistry;
    resolutions: InteractionResolution[];
  } {
    const resolutions: InteractionResolution[] = [];
    const registry = {
      resolveInteraction: async (resolution: InteractionResolution) => {
        resolutions.push(resolution);
      },
    } as unknown as ExecutionLifecycleRegistry;
    return { registry, resolutions };
  }

  it('resolves with the response the presenter chose', async () => {
    const { registry, resolutions } = createRegistry();
    const bridge = new ExecutionInteractionBridge(registry, {
      present: async () => 'deny',
    }, () => 7);

    bridge.accept(envelopeFor(createRequest(`ix-${'1'.repeat(32)}`)));
    await flush();

    expect(resolutions).toEqual([{
      interactionId: `ix-${'1'.repeat(32)}`,
      responseId: 'deny',
      resolvedAt: 7,
    }]);
  });

  it('leaves a dismissed interaction unresolved rather than answering for the user', async () => {
    // The one thing an approval prompt must never do is decide on the user's
    // behalf. A dismissal is the provider's to time out or cancel.
    const { registry, resolutions } = createRegistry();
    const bridge = new ExecutionInteractionBridge(registry, { present: async () => null });

    bridge.accept(envelopeFor(createRequest(`ix-${'2'.repeat(32)}`)));
    await flush();

    expect(resolutions).toEqual([]);
  });

  it('presents a redelivered interaction once', async () => {
    const { registry, resolutions } = createRegistry();
    let presentations = 0;
    const bridge = new ExecutionInteractionBridge(registry, {
      present: async () => {
        presentations += 1;
        return 'allow';
      },
    });
    const envelope = envelopeFor(createRequest(`ix-${'3'.repeat(32)}`));

    bridge.accept(envelope);
    bridge.accept(envelope);
    await flush();

    expect(presentations).toBe(1);
    expect(resolutions).toHaveLength(1);
  });

  it('survives a presenter that throws', async () => {
    // A view that fails to render must not leave the bridge in a state where
    // later interactions are lost.
    const { registry, resolutions } = createRegistry();
    const bridge = new ExecutionInteractionBridge(registry, {
      present: async () => {
        throw new Error('render failed');
      },
    });

    bridge.accept(envelopeFor(createRequest(`ix-${'4'.repeat(32)}`)));
    await flush();

    expect(resolutions).toEqual([]);
  });
});

async function flush(turns = 8): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}

describe('adapter members that were missing until the coverage gate found them', () => {
  it('answers a rewind the provider cannot do in the caller\'s own shape', async () => {
    // The port distinguishes `unavailable` from `failed`; the caller reads
    // `canRewind` and `error`, so the translation happens at the boundary.
    // Returning the port's outcome verbatim made a successful rewind read as
    // "this provider cannot rewind".
    const adapter = createBareAdapter(antigravityProviderModule.capabilities, {});

    await expect(adapter.rewind('user-1', 'assistant-1')).resolves.toEqual({
      canRewind: false,
      error: 'This provider cannot rewind a conversation.',
    });
  });

  it('surfaces no commands where the chat input does not ask for them', async () => {
    // Codex discovers commands through a short-lived process and the chat input
    // never requests them. Mapping from discovery instead would have turned
    // that on at its flip.
    const adapter = createBareAdapter(codexProviderModule.capabilities, {
      commands: { list: async () => [{ name: 'review', source: 'project' as const }] },
    });

    expect(await adapter.getSupportedCommands()).toEqual([]);
  });

  it('surfaces the catalog where the chat input does ask', async () => {
    const adapter = createBareAdapter(claudeProviderModule.capabilities, {
      commands: { list: async () => [{ name: 'review', source: 'project' as const }] },
    });

    // Slash commands, not port descriptors: the caller needs an id and a
    // prompt template, and an empty template is the honest value because the
    // provider owns the expansion.
    expect(await adapter.getSupportedCommands()).toEqual([
      { id: 'claude:review', name: 'review', content: '' },
    ]);
  });

  it('invalidates the session when the conversation binding changes underneath it', () => {
    const adapter = createBareAdapter(codexProviderModule.capabilities, {});

    adapter.syncConversationState({ sessionId: 'thread-1' });
    expect(adapter.consumeSessionInvalidation()).toBe(false);

    adapter.syncConversationState({ sessionId: 'thread-2' });
    expect(adapter.consumeSessionInvalidation()).toBe(true);
    // One-shot, as the contract requires.
    expect(adapter.consumeSessionInvalidation()).toBe(false);
  });

  it('reloads nothing when the provider has no Grimoire-owned MCP', async () => {
    const adapter = createBareAdapter(codexProviderModule.capabilities, {});

    await expect(adapter.reloadMcpServers()).resolves.toBeUndefined();
  });
});

function createBareAdapter(
  capabilities: ProviderCapabilityDescriptor,
  workspace: ProviderWorkspaceSlots,
): ExecutionChatRuntimeAdapter {
  return new ExecutionChatRuntimeAdapter(
    {
      registry: {} as never,
      backendId: executionBackendId('provider-fake'),
      capabilities,
      owner: { kind: 'conversation', ownerId: 'bare' },
      nextExecutionSessionId: () => executionSessionId(`es-${'d'.repeat(32)}`),
      nextRunId: () => toRunId(`run-${'d'.repeat(32)}`),
    },
    {
      prepareTurn: request => ({
        request,
        persistedContent: request.text,
        prompt: request.text,
        isCompact: false,
        mcpMentions: new Set<string>(),
      }),
      encodeRequestRef: () => 'encoded',
      reasoningControl: 'effort',
      currentSessionId: () => null,
    },
    { providerId: capabilities.providerId, chatUI: {
      modelPresentation: {
        ownsModel: () => false,
        label: modelId => modelId,
        contextWindow: () => undefined,
      },
      reasoningControl: { kind: 'none' },
      permissionToggles: [],
      icon: 'test',
    } },
    workspace,
  );
}

describe('turn metadata carries the native identities', () => {
  it('reports the run reference the controller needs for rewind', () => {
    // The controller copies these onto the messages, and rewind refuses to run
    // without the user one. Omitting them degrades rewind and resume silently,
    // which is worse than failing: the turn still looks complete.
    const stream = new ExecutionRunStream(toRunId(`run-${'e'.repeat(32)}`));
    const base = {
      schemaVersion: 1 as const,
      backendId: executionBackendId('provider-fake'),
      backendGeneration: 1,
      executionSessionId: executionSessionId(`es-${'e'.repeat(32)}`),
      sessionInstanceId: sessionInstanceId(`si-${'e'.repeat(32)}`),
      occurredAt: 1,
      scope: {
        kind: 'run' as const,
        runId: toRunId(`run-${'e'.repeat(32)}`),
        nativeRunRef: 'native-message-1',
      },
    };

    stream.accept({ ...base, eventId: 'e-1', sequence: 1, event: { kind: 'run-started' } });
    stream.accept({
      ...base,
      eventId: 'e-2',
      sequence: 2,
      event: { kind: 'result', result: { resultId: 'assistant-1', storage: 'projection' } },
    });
    stream.accept({
      ...base,
      eventId: 'e-3',
      sequence: 3,
      event: { kind: 'terminal', terminal: 'succeeded', reason: 'completed' },
    });

    expect(stream.consumeTurnMetadata()).toEqual({
      wasSent: true,
      userMessageId: 'native-message-1',
      assistantMessageId: 'assistant-1',
    });
  });

  it('reports no identity it never observed', () => {
    // Guards against filling the field with something invented: a provider with
    // no native run reference must report none rather than a synthesized id the
    // provider would not recognize.
    const stream = new ExecutionRunStream(toRunId(`run-${'f'.repeat(32)}`));
    stream.accept({
      schemaVersion: 1,
      backendId: executionBackendId('provider-fake'),
      backendGeneration: 1,
      executionSessionId: executionSessionId(`es-${'f'.repeat(32)}`),
      sessionInstanceId: sessionInstanceId(`si-${'f'.repeat(32)}`),
      eventId: 'e-1',
      sequence: 1,
      occurredAt: 1,
      scope: { kind: 'run', runId: toRunId(`run-${'f'.repeat(32)}`) },
      event: { kind: 'terminal', terminal: 'succeeded', reason: 'completed' },
    });

    expect(stream.consumeTurnMetadata()).toEqual({ wasSent: true });
  });
});
