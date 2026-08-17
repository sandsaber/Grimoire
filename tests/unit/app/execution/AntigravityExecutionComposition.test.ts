import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import {
  buildAntigravityRequest,
  createAntigravityChatRuntime,
  createAntigravityRequestResolver,
} from '@/app/execution/antigravity/AntigravityExecutionComposition';
import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import type { PreparedChatTurn } from '@/core/runtime/types';
import type { ChatMessage } from '@/core/types';
import {
  decodeAntigravityRequestRef,
  encodeAntigravityRequestRef,
} from '@/providers/antigravity/execution/AntigravityRequestCodec';
import { updateAntigravityProviderSettings } from '@/providers/antigravity/settings';

/**
 * The half of the Antigravity flip that only exists in production.
 *
 * The backend takes a request reference and knows nothing about what is inside
 * it; the adapter produces one and knows nothing either. This module is the
 * only place that knows both, so a defect here is invisible to every suite that
 * proved the two halves separately.
 */
describe('Antigravity execution composition', () => {
  function createPlugin(overrides: Record<string, unknown> = {}): any {
    const settings: Record<string, unknown> = { permissionMode: 'full_access', ...overrides };
    updateAntigravityProviderSettings(settings, {
      enabled: true,
      visibleModels: ['Gemini 3.5 Flash (Medium)'],
    });
    return {
      settings,
      app: { vault: { adapter: { basePath: '/vault' } } },
      getResolvedProviderCliPath: () => '/usr/local/bin/agy',
      recordDebugLog: () => undefined,
    };
  }

  function turn(text: string): PreparedChatTurn {
    return {
      isCompact: false,
      mcpMentions: new Set<string>(),
      persistedContent: text,
      prompt: text,
      request: { text },
    };
  }

  it('round-trips a turn through the opaque reference the kernel carries', async () => {
    const plugin = createPlugin();
    const history: ChatMessage[] = [
      { role: 'user', content: 'earlier question' } as ChatMessage,
      { role: 'assistant', content: 'earlier answer' } as ChatMessage,
    ];

    const requestRef = encodeAntigravityRequestRef(
      buildAntigravityRequest(plugin, turn('what now?'), history, { model: 'antigravity:Fast' }),
    );
    const invocation = await createAntigravityRequestResolver(plugin).resolve(requestRef);

    // Print mode keeps no session, so continuity exists only as replayed
    // history inside the prompt. Losing it here loses the conversation.
    expect(invocation.prompt).toBe(
      'User: earlier question\n\nAssistant: earlier answer\n\nUser: what now?',
    );
    expect(invocation.model).toBe('Fast');
    expect(invocation.command).toBe('/usr/local/bin/agy');
    expect(invocation.cwd).toBe('/vault');
  });

  it('reads settings when the run dispatches, not when the turn was queued', async () => {
    // The reference carries only what the turn decided. A CLI path or a
    // permission mode frozen at send time would launch what the user had
    // configured then, which is the bug this split exists to avoid.
    const plugin = createPlugin();
    const requestRef = encodeAntigravityRequestRef(
      buildAntigravityRequest(plugin, turn('go')),
    );
    plugin.getResolvedProviderCliPath = () => '/opt/agy';
    plugin.settings.permissionMode = 'normal';

    const invocation = await createAntigravityRequestResolver(plugin).resolve(requestRef);

    expect(invocation.command).toBe('/opt/agy');
    expect(invocation.permissionMode).toBe('normal');
  });

  it('passes the permission mode through so the backend can refuse it', async () => {
    // Fail-closed belongs to the backend, which turns anything short of full
    // access into `invalidated` / `pre-dispatch-rejected` before a process
    // exists. This resolver's job is to report the mode honestly, not to
    // normalize it into something launchable.
    const plugin = createPlugin({ permissionMode: 'normal' });

    const invocation = await createAntigravityRequestResolver(plugin).resolve(
      encodeAntigravityRequestRef(buildAntigravityRequest(plugin, turn('go'))),
    );

    expect(invocation.permissionMode).toBe('normal');
  });

  it('refuses to resolve when the provider is disabled', async () => {
    const plugin = createPlugin();
    const requestRef = encodeAntigravityRequestRef(buildAntigravityRequest(plugin, turn('go')));
    updateAntigravityProviderSettings(plugin.settings, { enabled: false });

    await expect(createAntigravityRequestResolver(plugin).resolve(requestRef))
      .rejects.toThrow('Antigravity is disabled.');
  });

  it('refuses a reference it cannot read rather than launching a guess', async () => {
    const resolver = createAntigravityRequestResolver(createPlugin());

    await expect(resolver.resolve('not json')).rejects.toThrow();
    await expect(resolver.resolve(JSON.stringify({ schemaVersion: 2, prompt: 'x', model: null })))
      .rejects.toThrow('unsupported schema version');
    await expect(resolver.resolve(JSON.stringify({ schemaVersion: 1, model: null })))
      .rejects.toThrow('no prompt');
  });

  it('persists the same session binding the runtime it replaced did', () => {
    // Persisted-state parity across the flip. The legacy runtime wrote
    // `sessionId: null` and echoed `providerState` back unchanged — a no-op
    // patch, since print mode has no native session to record. The adapter
    // contributes no history port for this provider and so patches nothing.
    // The conversation is the same either way, and the one observable
    // difference — an explicit null against an absent key — cannot change a
    // conversation whose session id was never anything else.
    const host = new ExecutionKernelHost({
      storage: new TestDurableStorage(),
      scheduler: { setTimeout: () => undefined, clearTimeout: () => undefined },
    });
    const runtime = createAntigravityChatRuntime(createPlugin(), host.registry);

    expect(runtime.getSessionId()).toBeNull();
    expect(runtime.resolveSessionIdForFork?.({ id: 'conversation-1' } as never)).toBeNull();
    expect(runtime.buildSessionUpdates?.({
      conversation: { id: 'conversation-1' } as never,
      sessionInvalidated: false,
    })).toEqual({ updates: {} });
  });

  it('falls back to the first visible model when the turn selected none', () => {
    const plugin = createPlugin();

    const request = buildAntigravityRequest(plugin, turn('go'));

    expect(decodeAntigravityRequestRef(encodeAntigravityRequestRef(request)).model)
      .toBe('Gemini 3.5 Flash (Medium)');
  });
});
