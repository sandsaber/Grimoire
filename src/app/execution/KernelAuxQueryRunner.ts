import type { AuxQueryConfig, AuxQueryRunner } from '@/core/auxiliary/AuxQueryRunner';

/**
 * What this runner needs from the provider that owns it.
 *
 * Two calls, because the two reference spaces are the provider's: it mints the
 * request and it names the conversation. Everything else — the process, the
 * session, the cancellation — belongs to the backend.
 */
export interface KernelAuxQueryPorts {
  /** Holds this turn and returns the reference the backend will carry. */
  reference(config: AuxQueryConfig, prompt: string): string;
  run(
    requestRef: string,
    options: { signal?: AbortSignal; onText?: (accumulated: string) => void },
  ): Promise<string>;
  /** Ends this runner's conversation. Its own, not every auxiliary conversation. */
  release(): Promise<void>;
}

/**
 * `AuxQueryRunner`, answered by the execution kernel.
 *
 * The seam the auxiliary services keep calling while what is behind it changes:
 * titles, refinement and inline edits ask this interface for an answer, and what
 * answers is the backend that owns every other process the provider has.
 *
 * It knows no protocol. It was written for the managed-ACP providers and named
 * for them, and Codex — a JSON-RPC app-server with threads rather than ACP
 * sessions — needed it unchanged, which is what the name says now.
 *
 * The whole adapter is four lines of policy, and they are the four things the
 * legacy runners do around a prompt: pass the caller's cancellation down, stream
 * the answer back, hand over the model, and end the conversation on `reset`.
 * `reset` is not awaited because the interface is synchronous — the caller has
 * already decided the conversation is over, and the closing is the backend's to
 * finish.
 */
export class KernelAuxQueryRunner implements AuxQueryRunner {
  constructor(private readonly ports: KernelAuxQueryPorts) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const requestRef = this.ports.reference(config, prompt);
    return this.ports.run(requestRef, {
      ...(config.abortController ? { signal: config.abortController.signal } : {}),
      ...(config.onTextChunk ? { onText: config.onTextChunk } : {}),
    });
  }

  reset(): void {
    void this.ports.release().catch(() => undefined);
  }
}
