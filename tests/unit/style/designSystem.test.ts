import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The Nordic design system, enforced rather than documented.
 *
 * See docs/design-system.md. Every rule here replaced a class of drift that had
 * already happened in this stylesheet: fifteen literal font sizes, thirteen
 * font weights, colours that only resolved in a dark theme, and three
 * declarations reading a token nothing defined.
 */

const STYLE_ROOT = 'src/style';
const TOKENS_FILE = join(STYLE_ROOT, 'base', 'variables.css');

function listCssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return listCssFiles(path);
    return path.endsWith('.css') ? [path] : [];
  });
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const CSS_FILES = listCssFiles(STYLE_ROOT).sort();
const MODULE_FILES = CSS_FILES.filter(file => file !== TOKENS_FILE);

function read(file: string): string {
  return stripComments(readFileSync(file, 'utf8'));
}

/** Tokens a stylesheet cannot define because a controller sets them per element. */
const RUNTIME_TOKENS = new Set([
  '--grimoire-context-meter-pct',
  '--grimoire-context-ring-color',
  '--grimoire-external-context-dropdown-bottom',
  '--grimoire-external-context-dropdown-left',
  '--grimoire-external-context-dropdown-max-height',
  '--grimoire-external-context-dropdown-width',
  '--grimoire-fixed-dropdown-bottom',
  '--grimoire-fixed-dropdown-left',
  '--grimoire-fixed-dropdown-width',
  '--grimoire-history-provider-color',
  '--grimoire-input-wrapper-height',
  '--grimoire-textarea-max-height',
  '--grimoire-textarea-min-height',
]);

describe('Nordic design system', () => {
  it('resolves every Grimoire token a stylesheet reads without a fallback', () => {
    const defined = new Set<string>();
    for (const file of CSS_FILES) {
      for (const match of read(file).matchAll(/(--grimoire-[a-z0-9-]+)\s*:/g)) {
        defined.add(match[1]);
      }
    }

    const dangling: string[] = [];
    for (const file of MODULE_FILES) {
      // `var(--x)` with no comma: nothing catches it if --x is undefined, and
      // an undefined custom property inherits rather than falling back.
      for (const match of read(file).matchAll(/var\(\s*(--grimoire-[a-z0-9-]+)\s*\)/g)) {
        const token = match[1];
        if (!defined.has(token) && !RUNTIME_TOKENS.has(token)) {
          dangling.push(`${file}: ${token}`);
        }
      }
    }

    expect(dangling).toEqual([]);
  });

  it('states every size, weight and radius as a step in the scale', () => {
    const literals: string[] = [];
    for (const file of MODULE_FILES) {
      const lines = read(file).split(/\r?\n/);
      lines.forEach((line, index) => {
        const at = `${file}:${index + 1}`;
        if (/font-size:\s*[0-9.]+(px|rem|em)/.test(line)) literals.push(`${at} ${line.trim()}`);
        if (/font-weight:\s*[0-9]{3}/.test(line)) literals.push(`${at} ${line.trim()}`);
        // 0 and 50% are shapes rather than steps, so they stay literal.
        if (/border-radius:\s*[0-9]+px\s*;/.test(line)) literals.push(`${at} ${line.trim()}`);
      });
    }

    expect(literals).toEqual([]);
  });

  it('takes every colour from the theme, so the plugin follows the user', () => {
    // Provider marks are identity, not decoration, and are the one fixed
    // colour the system allows. They live in the token file with the reason.
    const offenders: string[] = [];
    for (const file of MODULE_FILES) {
      const lines = read(file).split(/\r?\n/);
      lines.forEach((line, index) => {
        const at = `${file}:${index + 1}`;
        // A literal channel triple is a colour chosen for one theme.
        if (/rgba?\(\s*[0-9]/.test(line)) offenders.push(`${at} ${line.trim()}`);
        // A hex is allowed only as the fallback of a provider mark token.
        if (/#[0-9a-fA-F]{3,8}\b/.test(line) && !/var\(--grimoire-(provider|brand)-/.test(line)) {
          offenders.push(`${at} ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it('moves at one speed on one curve', () => {
    // Sixteen interaction durations between 0.06s and 0.32s were doing the same
    // job. A transition may still name a longer time when the duration is the
    // information — a usage meter filling — but not a shorter, private one.
    const strays: string[] = [];
    for (const file of MODULE_FILES) {
      const lines = read(file).split(/\r?\n/);
      lines.forEach((line, index) => {
        const declaration = /transition:[^;]*;/.exec(line);
        if (!declaration) return;
        for (const time of declaration[0].matchAll(/([0-9.]+)(m?s)/g)) {
          const seconds = Number(time[1]) / (time[2] === 'ms' ? 1000 : 1);
          if (seconds <= 0.32) strays.push(`${file}:${index + 1} ${line.trim()}`);
        }
      });
    }

    expect(strays).toEqual([]);
  });

  it('leaves Obsidian settings chrome to Obsidian', () => {
    // A `.setting-item` rule that is not scoped under a Grimoire class restyles
    // the host's own settings rows, which is what plugin review penalises.
    const unscoped: string[] = [];
    for (const file of MODULE_FILES) {
      for (const block of read(file).split('}')) {
        const [selectors] = block.split('{');
        if (!selectors || !block.includes('{')) continue;
        for (const selector of selectors.split(',')) {
          const trimmed = selector.trim();
          if (!trimmed.includes('.setting-item')) continue;
          if (!trimmed.includes('.grimoire-')) unscoped.push(`${file}: ${trimmed}`);
        }
      }
    }

    expect(unscoped).toEqual([]);
  });

  it('reads the user accent in one place, so every surface follows it together', () => {
    // The accent is the one colour the user picks, and it reached 65 rules
    // directly before this. Host tokens with no Grimoire equivalent — the
    // background and text families — stay readable anywhere; the accent does
    // not, because the system decides how much of it a surface may show.
    const DIRECT_ACCENT = /var\(\s*--(interactive-accent|text-accent|color-accent)[a-z0-9-]*\s*[,)]/;
    const leaks: string[] = [];
    for (const file of MODULE_FILES) {
      const lines = read(file).split(/\r?\n/);
      lines.forEach((line, index) => {
        if (DIRECT_ACCENT.test(line)) leaks.push(`${file}:${index + 1} ${line.trim()}`);
      });
    }

    expect(leaks).toEqual([]);
  });
});
