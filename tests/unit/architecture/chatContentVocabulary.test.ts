import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { listAllSourceModules } from '@test/helpers/moduleReachability';

/**
 * The split between what a provider *says* and what a turn *is*.
 *
 * M5's structural deletion gate searches for `StreamChunk`, and the plan says a
 * neutral content type that still needs streamed rendering receives a
 * projection-specific name rather than being retained under ambiguous
 * ownership. `ChatContentItem` is that name. The half beside it,
 * `ChatTurnLifecycleChunk`, is what the execution projection now states as a
 * fact and what the seam deletion removes.
 *
 * The classification is the load-bearing part, so it is pinned here rather than
 * left to a comment: a variant that drifts to the wrong side is a variant the
 * deletion either takes with it or leaves behind, and neither is visible by
 * reading the union.
 */

const CHAT_TYPES = 'src/core/types/chat.ts';

/**
 * The five the projection replaced, each with the fact that replaces it.
 *
 * `user_message_start` / `assistant_message_start` — a turn's boundaries, which
 * a run's start and terminal state; `status` — the thinking indicator's text,
 * which the run's state drives; `error` — the terminal's own reason; `done` —
 * the terminal itself.
 */
const LIFECYCLE_VARIANTS = [
  'user_message_start',
  'assistant_message_start',
  'status',
  'error',
  'done',
];

/**
 * Where turn framing may still be read, and the reason it is exactly one file.
 *
 * `InputController` splits a steered turn into separate messages by watching
 * these, and it is the module M5's flip deletes. A second reader appearing
 * while that flip is in flight is two opinions about where a turn begins, in
 * the same period when the projection is becoming the answer.
 */
const FRAMING_READERS = ['src/features/chat/controllers/InputController.ts'];

function read(module: string): string {
  return readFileSync(resolve(process.cwd(), module), 'utf8');
}

function variantsOf(source: string, alias: string): string[] {
  // Terminated by a blank line rather than by the first `;`: a variant whose
  // fields span several lines ends a line with `;` too, and the first version
  // of this stopped inside `progress` and reported a union three long.
  const declaration = new RegExp(`export type ${alias} =([\\s\\S]*?)(?:\\n\\n|$)`).exec(source);
  if (!declaration) {
    throw new Error(`No declaration found for "${alias}".`);
  }
  return [...declaration[1].matchAll(/type: '([a-z_]+)'/g)].map(([, variant]) => variant);
}

describe('chat content vocabulary', () => {
  const source = read(CHAT_TYPES);

  it('names the lifecycle half as exactly what the projection replaced', () => {
    expect(variantsOf(source, 'ChatTurnLifecycleChunk').sort())
      .toEqual([...LIFECYCLE_VARIANTS].sort());
  });

  it('keeps every other variant on the content side', () => {
    const content = variantsOf(source, 'ChatContentItem');

    expect(content).not.toHaveLength(0);
    expect(content.filter(variant => LIFECYCLE_VARIANTS.includes(variant))).toEqual([]);
    // `usage` is the one that looks like a fact about the run and is not: no
    // part of the kernel carries token counts, and the only thing that knows
    // them is the provider payload it arrives in.
    expect(content).toContain('usage');
  });

  it('reads its own declarations rather than matching the file', () => {
    // Guards the guard: a parser that found nothing would pass both rules above
    // by reporting an empty union, and a rule over an empty set is no rule.
    expect(variantsOf(
      "export type Sample =\n  | { type: 'alpha' }\n  | { type: 'beta'; id: string };\n",
      'Sample',
    )).toEqual(['alpha', 'beta']);
    expect(() => variantsOf('', 'Missing')).toThrow(/No declaration/);
  });

  it('has one production reader of turn framing, and it is the one M5 deletes', () => {
    const readers = listAllSourceModules()
      .filter(module => module !== CHAT_TYPES)
      .filter(module => /\buser_message_start\b|\bassistant_message_start\b/.test(read(module)))
      // A provider emitting framing is a producer; this rule is about readers.
      .filter(module => new RegExp(`case '(user|assistant)_message_start'`).test(read(module)));

    expect(readers).toEqual(FRAMING_READERS);
  });
});
