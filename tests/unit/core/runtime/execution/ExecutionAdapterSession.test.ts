import { ExecutionAdapterSession } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import { antigravityProviderModule } from '@/providers/antigravity/AntigravityProviderModule';
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
