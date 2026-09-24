import type { FormInfo1 } from '@opencode/client';

import { opencodeFormAnswers, opencodeFormQuestions } from '@/providers/opencode/execution/OpencodeQuestions';

const form = (fields: FormInfo1['fields']): FormInfo1 => ({ id: 'form', sessionID: 'session', title: 'Question', fields });

describe('OpenCode native forms', () => {
  it('preserves distinct values behind duplicate labels and rejects unoffered answers', () => {
    const input = form([{ key: 'color', type: 'string', required: true, options: [
      { label: 'Blue', value: 'light' }, { label: 'Blue', value: 'dark' },
    ] }]);
    expect(opencodeFormQuestions(input)?.[0].options.map(option => option.label)).toEqual(['Blue (light)', 'Blue (dark)']);
    expect(opencodeFormAnswers(input, { 'opencode-field-0': 'Blue (dark)' })).toEqual({ color: 'dark' });
    expect(opencodeFormAnswers(input, { 'opencode-field-0': 'Purple' })).toBeNull();
    expect(opencodeFormAnswers(input, {})).toBeNull();
  });

  it('accepts native custom and multiple choices without using native keys in UI answers', () => {
    const input = form([{ key: '__proto__', type: 'multiselect', custom: true,
      options: [{ label: 'Blue', value: 'blue' }] }]);
    expect(opencodeFormQuestions(input)?.[0]).toMatchObject({ id: 'opencode-field-0', multiSelect: true, isOther: true });
    const answer = opencodeFormAnswers(input, { 'opencode-field-0': ['Blue', 'Purple'] });
    expect(Object.keys(answer!)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(answer)).toBe(Object.prototype);
    expect(answer!.__proto__).toEqual(['blue', 'Purple']);
  });

  it('converts boolean and numeric answers and rejects invalid integers', () => {
    const input = form([{ key: 'enabled', type: 'boolean' }, { key: 'count', type: 'integer' },
      { key: 'optional', type: 'string' }]);
    expect(opencodeFormAnswers(input, { 'opencode-field-0': 'No', 'opencode-field-1': '3' }))
      .toEqual({ enabled: false, count: 3 });
    expect(opencodeFormAnswers(input, { 'opencode-field-1': '3.5' })).toBeNull();
    expect(opencodeFormAnswers(input, { 'opencode-field-1': ' ' })).toBeNull();
  });
});
