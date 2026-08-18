import { CODEX_EXECUTION_NOTIFICATION_METHODS } from '@/providers/codex/runtime/CodexExecutionConnection';
import { CODEX_ROUTED_NOTIFICATION_METHODS } from '@/providers/codex/runtime/CodexNotificationRouter';

/**
 * What the daemon is asked for, against what the surface can draw.
 *
 * The flip subscribed to eleven notifications while the renderer it kept
 * handles nineteen. The eight in between carry streamed command output, patch
 * updates, raw response items, plan updates and token usage — everything a
 * Codex turn shows past the first sentence — and none of them arrived, which no
 * test noticed because both halves were right about their own list.
 */
describe('Codex routed notifications', () => {
  it('delivers every notification the renderer knows how to draw', () => {
    const delivered = new Set<string>(CODEX_EXECUTION_NOTIFICATION_METHODS);

    expect(CODEX_ROUTED_NOTIFICATION_METHODS.filter(method => !delivered.has(method)))
      .toEqual([]);
  });

  it('also delivers what the backend itself acts on', () => {
    // Not the renderer's, but the run's: the turn it owns, the thread's status,
    // a request the daemon answered by itself, and the plan-limit updates the
    // usage store reads.
    expect(CODEX_EXECUTION_NOTIFICATION_METHODS).toEqual(expect.arrayContaining([
      'turn/started',
      'thread/status/changed',
      'serverRequest/resolved',
      'account/rateLimits/updated',
    ]));
  });
});
