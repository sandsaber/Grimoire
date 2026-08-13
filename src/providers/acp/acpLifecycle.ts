/**
 * Lightweight lifecycle helpers shared by ACP managed-CLI runtimes.
 *
 * Full runtime base extraction is intentionally incremental: these helpers
 * cover generation/cleanup races first without forcing a large class hierarchy.
 */

export interface AcpLifecycleState {
  cleanupPromise: Promise<void> | null;
  lifecycleGeneration: number;
}

/** Bump generation so in-flight ensureReady/query work can detect staleness. */
export function bumpAcpLifecycleGeneration(state: AcpLifecycleState): number {
  state.lifecycleGeneration += 1;
  return state.lifecycleGeneration;
}

export function isAcpLifecycleCurrent(
  state: AcpLifecycleState,
  generation: number,
): boolean {
  return state.lifecycleGeneration === generation;
}

/**
 * Run shutdown work under a shared cleanup promise so concurrent callers await
 * the same teardown and later work can wait via `await state.cleanupPromise`.
 */
export async function runAcpLifecycleCleanup(
  state: AcpLifecycleState,
  cleanup: () => Promise<void>,
): Promise<void> {
  if (state.cleanupPromise) {
    await state.cleanupPromise;
    return;
  }

  bumpAcpLifecycleGeneration(state);
  let pending!: Promise<void>;
  pending = (async () => {
    try {
      await cleanup();
    } finally {
      if (state.cleanupPromise === pending) {
        state.cleanupPromise = null;
      }
    }
  })();
  state.cleanupPromise = pending;
  await pending;
}
