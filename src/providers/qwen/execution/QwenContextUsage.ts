import type { AcpUsageUpdate } from '@/providers/acp/types';

/**
 * How full a Qwen session's context is, which ACP has no method for.
 *
 * `qwen/status/session/context_usage` is this CLI's own, and it is the only
 * source: no `usage_update` this provider sends carries the parent window. The
 * legacy runtime asks once per turn, after the prompt returns, and this is that
 * call and its parsing moved rather than a second opinion about either.
 *
 * The three-second bound is the legacy runtime's too. A window is a badge, and a
 * badge is not worth holding a finished turn open for.
 */
export const QWEN_CONTEXT_USAGE_METHOD = 'qwen/status/session/context_usage';
export const QWEN_CONTEXT_USAGE_TIMEOUT_MS = 3_000;

interface QwenContextUsageStatus {
  usage?: {
    contextWindowSize?: unknown;
    totalTokens?: unknown;
  };
}

/**
 * The two numbers a badge needs, or nothing.
 *
 * Both or neither: a used count with no window renders as a fraction of nothing,
 * and a window of zero is a division nobody wants. An older Qwen that has no such
 * method answers nothing at all, which reaches here as a rejection rather than as
 * a shape.
 */
export function parseQwenContextUsage(status: unknown): AcpUsageUpdate | null {
  const usage = (status as QwenContextUsageStatus | null)?.usage;
  const used = usage?.totalTokens;
  const size = usage?.contextWindowSize;
  if (
    typeof used !== 'number'
    || !Number.isFinite(used)
    || used < 0
    || typeof size !== 'number'
    || !Number.isFinite(size)
    || size <= 0
  ) {
    return null;
  }
  return { size, used };
}
