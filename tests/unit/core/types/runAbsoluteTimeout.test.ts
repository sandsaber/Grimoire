import {
  DEFAULT_RUN_ABSOLUTE_TIMEOUT_MINUTES,
  MAX_RUN_ABSOLUTE_TIMEOUT_MINUTES,
  normalizeRunAbsoluteTimeoutMinutes,
  resolveRunAbsoluteTimeoutMs,
} from '@/core/types/settings';

describe('run ceiling settings', () => {
  it('treats zero as a value and a non-number as an absence', () => {
    // Zero is how the ceiling is removed, for a turn expected to run for
    // hours. Anything that is not a number is a file nobody wrote this field
    // into, which is not the same request and must not disable the ceiling.
    expect(normalizeRunAbsoluteTimeoutMinutes(0)).toBe(0);
    expect(resolveRunAbsoluteTimeoutMs({ runAbsoluteTimeoutMinutes: 0 })).toBe(0);
    expect(normalizeRunAbsoluteTimeoutMinutes(undefined))
      .toBe(DEFAULT_RUN_ABSOLUTE_TIMEOUT_MINUTES);
    expect(normalizeRunAbsoluteTimeoutMinutes('45'))
      .toBe(DEFAULT_RUN_ABSOLUTE_TIMEOUT_MINUTES);
    expect(normalizeRunAbsoluteTimeoutMinutes(Number.NaN))
      .toBe(DEFAULT_RUN_ABSOLUTE_TIMEOUT_MINUTES);
  });

  it('bounds what a hand-edited settings file can ask for', () => {
    expect(normalizeRunAbsoluteTimeoutMinutes(-5)).toBe(0);
    expect(normalizeRunAbsoluteTimeoutMinutes(90.7)).toBe(90);
    expect(normalizeRunAbsoluteTimeoutMinutes(10_000))
      .toBe(MAX_RUN_ABSOLUTE_TIMEOUT_MINUTES);
  });

  it('answers in the milliseconds a backend arms', () => {
    expect(resolveRunAbsoluteTimeoutMs({ runAbsoluteTimeoutMinutes: 90 })).toBe(90 * 60_000);
  });
});
