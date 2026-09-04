import themeTokens from '@test/fixtures/obsidian/theme-tokens.json';
import { readFileSync } from 'fs';

/**
 * Proof that the plugin follows the user's theme and accent, rather than a
 * claim that it does.
 *
 * The environment is Obsidian's own, read out of the app.css inside
 * obsidian-1.13.7.asar. Resolving Grimoire's token layer against it is what
 * found that `--interactive-accent-rgb` and `--color-accent-rgb` do not exist
 * in Obsidian at all, so thirty-two accent surfaces had been painting the
 * fallback triple — a fixed violet — whatever accent the user had picked.
 */

type Env = Record<string, string>;

function tokenLayer(): Env {
  const css = readFileSync('src/style/base/variables.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const body = css.slice(css.indexOf('{') + 1, css.lastIndexOf('}'));
  const declarations: Env = {};
  for (const match of body.matchAll(/(--grimoire-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    declarations[match[1]] = match[2].trim();
  }
  return declarations;
}

/** Expands `var(--x, fallback)` against an environment, innermost first. */
function resolve(value: string, env: Env, depth = 0): string {
  if (depth > 24) return value;
  const open = value.indexOf('var(');
  if (open === -1) return value;

  let cursor = open + 4;
  let nesting = 1;
  while (cursor < value.length && nesting > 0) {
    if (value[cursor] === '(') nesting += 1;
    if (value[cursor] === ')') nesting -= 1;
    cursor += 1;
  }
  const inner = value.slice(open + 4, cursor - 1);
  const comma = splitTopLevel(inner);
  const name = comma[0].trim();
  const fallback = comma.slice(1).join(',').trim();

  const defined = env[name];
  const replacement = defined !== undefined
    ? resolve(defined, env, depth + 1)
    : fallback
      ? resolve(fallback, env, depth + 1)
      : '';

  return resolve(value.slice(0, open) + replacement + value.slice(cursor), env, depth + 1);
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function environment(theme: 'light' | 'dark', overrides: Env = {}): Env {
  return { ...(themeTokens[theme] as Env), ...tokenLayer(), ...overrides };
}

function resolveAll(theme: 'light' | 'dark', overrides: Env = {}): Env {
  const env = environment(theme, overrides);
  const out: Env = {};
  for (const name of Object.keys(tokenLayer())) {
    out[name] = resolve(`var(${name})`, env);
  }
  return out;
}

describe('theme adaptation', () => {
  it('depends on no Obsidian variable the app does not define', () => {
    // The check that caught the accent triple. An undefined dependency is not a
    // theming choice, it is a value silently frozen at its fallback — and a
    // fallback hides it, so this reads the layer rather than the resolution.
    const layer = tokenLayer();
    const known = new Set([
      ...Object.keys(themeTokens.light),
      ...Object.keys(themeTokens.dark),
    ]);

    const unknown = new Set<string>();
    for (const value of Object.values(layer)) {
      for (const match of value.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
        const name = match[1];
        if (!name.startsWith('--grimoire-') && !known.has(name)) unknown.add(name);
      }
    }

    expect([...unknown].sort()).toEqual([]);
    // And the generator agrees, from the other direction.
    expect(themeTokens.absentFromObsidian).toEqual([]);
  });

  it.each(['light', 'dark'] as const)('resolves every token to a real value on the %s theme', theme => {
    const resolved = resolveAll(theme);
    const unresolved = Object.entries(resolved)
      .filter(([, value]) => value.trim() === '' || value.includes('var('))
      .map(([name, value]) => `${name} -> ${value || '(empty)'}`);

    expect(unresolved).toEqual([]);
  });

  it('draws the two themes from different ground, so neither is the other painted over', () => {
    const light = resolveAll('light');
    const dark = resolveAll('dark');

    expect(light['--grimoire-ground']).not.toBe(dark['--grimoire-ground']);
    expect(light['--grimoire-ink']).not.toBe(dark['--grimoire-ink']);
    expect(light['--grimoire-line']).not.toBe(dark['--grimoire-line']);
  });

  it('carries the accent the user picked into every accent-derived token', () => {
    // Obsidian composes its accent from --accent-h/s/l, which is what a user
    // changes in Appearance. Nothing downstream may ignore that.
    const chosen = { '--accent-h': '12', '--accent-s': '90%', '--accent-l': '50%' };
    const before = resolveAll('dark');
    const after = resolveAll('dark', chosen);

    // Selected by name, with one exclusion stated rather than derived.
    // Selecting by what a token is *made of* looked tidier and was a hole: a
    // token pinned to a literal stops referencing the accent, so the filter
    // drops it from the list exactly when it breaks. Proved by pinning
    // --grimoire-accent-text to #7f5fd9 and watching this pass.
    //
    // --grimoire-accent-contrast is Obsidian's --text-on-accent, which is white
    // at every hue by design; it is the one token here that must not move.
    const FIXED_BY_DESIGN = new Set(['--grimoire-accent-contrast']);
    const accentTokens = Object.keys(tokenLayer())
      .filter(name => name.startsWith('--grimoire-accent') || name === '--grimoire-brand')
      .filter(name => !FIXED_BY_DESIGN.has(name));
    expect(accentTokens.length).toBeGreaterThan(4);

    for (const name of accentTokens) {
      expect(after[name]).not.toBe(before[name]);
      expect(after[name]).toContain('12');
    }
  });

  it('keeps the provider marks fixed, because those are identity rather than theme', () => {
    const light = resolveAll('light');
    const dark = resolveAll('dark');

    expect(light['--grimoire-provider-claude']).toBe('#d97757');
    expect(dark['--grimoire-provider-claude']).toBe('#d97757');
  });

  it('lands each type step where the literal it replaced stood', () => {
    // The ladder replaced fifteen literals between 8.5px and 20px. Being
    // relative is only half the job: at Obsidian's own defaults each step has
    // to arrive where its literals were, or the sweep quietly resized the whole
    // plugin. An earlier base assumed --font-ui-small was 15px when the host's
    // `body` table sets 13px, which shrank every string by an eighth.
    const resolved = resolveAll('dark');
    // Innermost-first, because a step is a calc over the base, which is itself
    // a calc once anything upstream is. Evaluating one level answers NaN, which
    // fails the assertion without naming the size that went wrong.
    const px = (name: string): number => {
      let value = resolved[name];
      const innermost = /calc\(([^()]*)\)/;
      while (innermost.test(value)) {
        value = value.replace(innermost, (_, expression: string) =>
          String(expression.split('*').reduce(
            (product: number, part: string) => product * Number.parseFloat(part.trim()),
            1,
          )));
      }
      return Number.parseFloat(value);
    };

    expect(px('--grimoire-text-2xs')).toBeCloseTo(10, 0);
    expect(px('--grimoire-text-xs')).toBeCloseTo(11, 0);
    expect(px('--grimoire-text-s')).toBeCloseTo(12, 0);
    expect(px('--grimoire-text-m')).toBeCloseTo(13, 0);
    expect(px('--grimoire-text-l')).toBeCloseTo(14, 0);
    expect(px('--grimoire-text-xl')).toBeCloseTo(16, 0);
    expect(px('--grimoire-text-2xl')).toBeCloseTo(20, 0);
  });

  it('scales type with the reader rather than pinning it', () => {
    const normal = resolveAll('dark');
    const larger = resolveAll('dark', { '--font-ui-small': '20px' });

    expect(normal['--grimoire-text-m']).not.toBe(larger['--grimoire-text-m']);
    expect(larger['--grimoire-text-m']).toContain('20px');
  });
});
