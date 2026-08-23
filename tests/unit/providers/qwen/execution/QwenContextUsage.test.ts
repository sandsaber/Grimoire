import { parseQwenContextUsage } from '@/providers/qwen/execution/QwenContextUsage';

/**
 * The two numbers a context badge needs, out of a method ACP does not define.
 *
 * `qwen/status/session/context_usage` is this CLI's own and is the only source:
 * no `usage_update` it sends carries the parent window. Reached through
 * `QwenChatRuntime` before the extraction; both now read the same parser.
 */
describe('parseQwenContextUsage', () => {
  it('reads a window and what is used of it', () => {
    expect(parseQwenContextUsage({ usage: { contextWindowSize: 1_048_576, totalTokens: 4_096 } }))
      .toEqual({ size: 1_048_576, used: 4_096 });
  });

  it('takes both numbers or neither', () => {
    // A used count with no window renders as a fraction of nothing.
    expect(parseQwenContextUsage({ usage: { totalTokens: 4_096 } })).toBeNull();
    expect(parseQwenContextUsage({ usage: { contextWindowSize: 1_048_576 } })).toBeNull();
  });

  it('refuses a window of zero, which is a division nobody wants', () => {
    expect(parseQwenContextUsage({ usage: { contextWindowSize: 0, totalTokens: 0 } })).toBeNull();
    expect(parseQwenContextUsage({ usage: { contextWindowSize: -1, totalTokens: 10 } })).toBeNull();
  });

  it('refuses a used count that is not a count', () => {
    expect(parseQwenContextUsage({ usage: { contextWindowSize: 100, totalTokens: -1 } })).toBeNull();
    expect(parseQwenContextUsage({ usage: { contextWindowSize: 100, totalTokens: Number.NaN } }))
      .toBeNull();
    expect(parseQwenContextUsage({ usage: { contextWindowSize: 100, totalTokens: '4096' } }))
      .toBeNull();
  });

  it('answers nothing for an agent that has no such method', () => {
    // An older Qwen does not answer it at all, which reaches here as a rejection
    // upstream and as one of these shapes when it answers something else.
    expect(parseQwenContextUsage(null)).toBeNull();
    expect(parseQwenContextUsage(undefined)).toBeNull();
    expect(parseQwenContextUsage({})).toBeNull();
    expect(parseQwenContextUsage({ usage: null })).toBeNull();
  });
});
