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

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
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
    // There is no exception left. Provider marks were the one fixed colour the
    // system allowed, and Nordic draws a provider as its glyph in --text-muted
    // instead, so nothing in the plugin names a hue the user did not pick.
    const offenders: string[] = [];
    for (const file of CSS_FILES) {
      const lines = read(file).split(/\r?\n/);
      lines.forEach((line, index) => {
        const at = `${file}:${index + 1}`;
        // A literal channel triple is a colour chosen for one theme.
        if (/rgba?\(\s*[0-9]/.test(line)) offenders.push(`${at} ${line.trim()}`);
        if (/#[0-9a-fA-F]{3,8}\b/.test(line)) offenders.push(`${at} ${line.trim()}`);
      });
    }

    expect(offenders).toEqual([]);
  });

  it('carries provider identity as a glyph, never as a hue', () => {
    // Nine vendor colours reached five stylesheets, which is five chances for
    // one provider to be two colours. Status is the accent dot; identity is the
    // mark. Neither is a brand palette.
    const brands: string[] = [];
    for (const file of CSS_FILES) {
      const lines = read(file).split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/--grimoire-(provider|brand)-[a-z]/.test(line)) {
          brands.push(`${file}:${index + 1} ${line.trim()}`);
        }
        // A rule selected by provider id exists to paint that provider.
        if (/\[data-provider(-id)?=/.test(line)) brands.push(`${file}:${index + 1} ${line.trim()}`);
      });
    }

    expect(brands).toEqual([]);
  });

  it('spaces on one ladder', () => {
    // Twenty-seven spacing values were in use, ten of them off any grid. Below
    // the ladder's top rung a spacing value is a step in the rhythm and must be
    // a token; above it the number is layout, and stays a number.
    const offGrid: string[] = [];
    const SPACING = /\b(padding|margin|gap|row-gap|column-gap)(-[a-z]+)*\s*:\s*([^;{}]+);/g;
    for (const file of MODULE_FILES) {
      const lines = read(file).split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const declaration of line.matchAll(SPACING)) {
          for (const value of declaration[3].matchAll(/(?<![\w.-])([0-9]+)px/g)) {
            if (Number(value[1]) > 1 && Number(value[1]) < 32) {
              offGrid.push(`${file}:${index + 1} ${line.trim()}`);
            }
          }
        }
      });
    }

    expect(offGrid).toEqual([]);
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

  it('closes every block it opens', () => {
    // A stray `}` is not a typo the build reports: `build-css` concatenates, and
    // the browser recovers from it by discarding the rule that follows. One in
    // tabs.css swallowed `.grimoire-panel-switch` whole, so the panel rail fell
    // back to `display: block` and the transcript's jump controls dropped onto a
    // row of their own — visible in the plugin, invisible in every gate.
    const unbalanced: string[] = [];
    for (const file of CSS_FILES) {
      const css = read(file);
      const opened = (css.match(/\{/g) ?? []).length;
      const closed = (css.match(/\}/g) ?? []).length;
      if (opened !== closed) unbalanced.push(`${file}: ${opened} open, ${closed} closed`);
    }

    expect(unbalanced).toEqual([]);
  });

  it('gives every selector exactly one sheet', () => {
    // Two sheets writing the same selector is a rule nobody owns: whichever the
    // build imports last decides, silently. It had happened twice — an old
    // `.grimoire-input-nav-content` in input.css flattened the header's tab
    // strip so the active underline floated in mid-air, and the context
    // manager's list row took the composer's `.grimoire-context-row`, leaving an
    // empty 34px band above the textarea in every chat.
    const owners = new Map<string, Set<string>>();
    for (const file of CSS_FILES) {
      for (const block of read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = block[1].split(/\s+/).join(' ').trim();
        if (!selector.startsWith('.grimoire')) continue;
        const sheets = owners.get(selector) ?? new Set<string>();
        sheets.add(file);
        owners.set(selector, sheets);
      }
    }

    const shared: string[] = [];
    for (const [selector, sheets] of owners) {
      if (sheets.size > 1) shared.push(`${selector}: ${[...sheets].sort().join(', ')}`);
    }

    expect(shared.sort()).toEqual([]);
  });

  it('gives every selector one rule in its own sheet', () => {
    // The cross-sheet check above cannot see a selector written twice in the
    // same file, and one was: `.grimoire-model-group-label` held its colour in
    // one block and its truncation in another, ten blank lines apart, because a
    // scripted edit had removed what sat between them. Two blocks for one
    // selector is one of them waiting to be edited and not take effect.
    // Rules inside an at-rule are skipped: a media query overriding a selector
    // it also sets at the top level is the point of a media query.
    const repeated: string[] = [];
    for (const file of CSS_FILES) {
      const css = read(file);
      const seen = new Map<string, number>();
      let depth = 0;
      let start = 0;
      for (let index = 0; index < css.length; index += 1) {
        const char = css[index];
        if (char === '{') {
          if (depth === 0) {
            const selector = css.slice(start, index).split(/\s+/).join(' ').trim();
            if (selector.startsWith('.grimoire')) {
              seen.set(selector, (seen.get(selector) ?? 0) + 1);
            }
          }
          depth += 1;
        } else if (char === '}') {
          depth = Math.max(0, depth - 1);
          if (depth === 0) start = index + 1;
        }
      }
      for (const [selector, count] of seen) {
        if (count > 1) repeated.push(`${file}: ${selector} \u00d7 ${count}`);
      }
    }

    expect(repeated.sort()).toEqual([]);
  });

  it('outranks the host on every field it paints', () => {
    // The same trap as the buttons, one element over: Obsidian styles
    // `input[type='text']` and its siblings with a form-field ground, a
    // border and its own height, which is element-plus-attribute weight. The
    // manage-context dialog's borderless search band came back as a filled,
    // bordered Obsidian field until its rule named the element too.
    const fieldClasses = new Set<string>();
    for (const file of listSourceFiles('src')) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/createEl\(\s*'input'\s*,\s*\{([\s\S]{0,600}?)\}/g)) {
        const cls = /cls:\s*(\[[^\]]*\]|'[^']*')/.exec(match[1]);
        if (!cls) continue;
        for (const token of cls[1].match(/[A-Za-z0-9_-]+/g) ?? []) {
          if (token.startsWith('grimoire-')) fieldClasses.add(token);
        }
      }
    }
    expect(fieldClasses.size).toBeGreaterThan(10);

    const painted = new Set([
      'background', 'background-color', 'border', 'border-color', 'border-width',
      'box-shadow', 'color', 'height', 'padding',
    ]);
    const outranked: string[] = [];
    for (const file of CSS_FILES) {
      for (const rule of read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sets = rule[2]
          .split(';')
          .some(declaration => painted.has(declaration.split(':')[0]?.trim() ?? ''));
        if (!sets) continue;
        const parts = rule[1].split(',').map(part => part.split(/\s+/).join(' ').trim());
        for (const trimmed of parts) {
          if (!/^\.[\w-]+$/.test(trimmed)) continue;
          if (!fieldClasses.has(trimmed.slice(1))) continue;
          if (parts.includes(`input${trimmed}`)) continue;
          outranked.push(`${file}: ${trimmed}`);
        }
      }
    }

    expect([...new Set(outranked)].sort()).toEqual([]);
  });

  it('outranks the host on every button it paints', () => {
    // Obsidian styles `button:not(.clickable-icon)` with a grey
    // --interactive-normal fill, its inset-border shadow and --text-normal.
    // That selector counts an element and a class, so a rule written as
    // `.grimoire-primary-action` cannot reach it however late it loads: every
    // filled action in the plugin resolved to rgb(51,51,51) rather than the
    // accent, and every flat one carried a fill and a hairline. A rule that
    // paints a button has to name the element too.
    const buttonClasses = new Set<string>();
    for (const file of listSourceFiles('src')) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/createEl\(\s*'button'\s*,\s*\{([\s\S]{0,600}?)\}/g)) {
        const cls = /cls:\s*(\[[^\]]*\]|'[^']*')/.exec(match[1]);
        if (!cls) continue;
        for (const token of cls[1].match(/[A-Za-z0-9_-]+/g) ?? []) {
          if (token.startsWith('grimoire-')) buttonClasses.add(token);
        }
      }
    }
    expect(buttonClasses.size).toBeGreaterThan(20);

    const painted = new Set(['background', 'background-color', 'box-shadow', 'color']);
    const outranked: string[] = [];
    for (const file of CSS_FILES) {
      for (const rule of read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sets = rule[2]
          .split(';')
          .some(declaration => painted.has(declaration.split(':')[0]?.trim() ?? ''));
        if (!sets) continue;
        const parts = rule[1].split(',').map(part => part.split(/\s+/).join(' ').trim());
        for (const trimmed of parts) {
          if (!/^\.[\w-]+$/.test(trimmed)) continue;
          if (!buttonClasses.has(trimmed.slice(1))) continue;
          // A class that also lands on a div keeps its bare selector and adds
          // the qualified twin beside it, which is enough to win.
          if (parts.includes(`button${trimmed}`)) continue;
          outranked.push(`${file}: ${trimmed}`);
        }
      }
    }

    expect([...new Set(outranked)].sort()).toEqual([]);
  });

  it('lets a modifier outrank the base it modifies', () => {
    // The other half of the same trap. `button.grimoire-icon-btn` counts an
    // element and a class, so `.grimoire-icon-btn--small` - named by class
    // alone - never reached its own width and height, and every small icon
    // button in the plugin drew at the large size. The two pixels that cost
    // were visible: a control pinned beside a chip sat lower than the chip.
    type Base = { selector: string; element: string; properties: Set<string> };
    const bases = new Map<string, Base>();
    const rules: Array<{ file: string; parts: string[]; properties: Set<string> }> = [];

    for (const file of CSS_FILES) {
      for (const rule of read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const parts = rule[1].split(',').map(part => part.split(/\s+/).join(' ').trim());
        const properties = new Set(rule[2]
          .split(';')
          .map(declaration => declaration.split(':')[0]?.trim() ?? '')
          .filter(Boolean));
        rules.push({ file, parts, properties });
        for (const part of parts) {
          const qualified = /^([a-z]+)\.([\w-]+)$/.exec(part);
          if (!qualified) continue;
          const existing = bases.get(qualified[2]);
          if (existing) {
            for (const property of properties) existing.properties.add(property);
            continue;
          }
          bases.set(qualified[2], {
            selector: part,
            element: qualified[1],
            properties: new Set(properties),
          });
        }
      }
    }
    expect(bases.size).toBeGreaterThan(0);

    const losing: string[] = [];
    for (const { file, parts, properties } of rules) {
      for (const part of parts) {
        const bare = /^\.([\w-]+--[\w-]+)$/.exec(part);
        if (!bare) continue;
        const modifier = bare[1];
        for (const [name, base] of bases) {
          if (!modifier.startsWith(`${name}--`)) continue;
          const contested = [...properties].filter(property => base.properties.has(property));
          if (contested.length === 0) continue;
          // Naming the element beside the bare selector is enough to win.
          if (parts.includes(`${base.element}${part}`)) continue;
          losing.push(`${file}: ${part} loses ${contested.sort().join(', ')} to ${base.selector}`);
        }
      }
    }

    expect([...new Set(losing)].sort()).toEqual([]);
  });

  it('leaves no drawn chevron where a real one was put', () => {
    // `.grimoire-model-group-chevron` was a 6px box with two borders rotated
    // 45 degrees. When the glyph became a lucide `chevron-right`, the box
    // stayed - so every model-group header drew an svg inside a rotated,
    // bordered square, and the arrow came out bent. A class that a rule turns
    // into a triangle is a glyph the CSS is drawing itself, so nothing may
    // also put an icon in it.
    const drawn = new Set<string>();
    for (const file of CSS_FILES) {
      for (const rule of read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = rule[2];
        if (!/transform:\s*rotate\(/.test(body)) continue;
        if (!/border-(right|bottom|width)\s*:/.test(body)) continue;
        for (const selector of rule[1].split(',')) {
          if (selector.includes('::')) continue;
          const last = selector.split(/\s+/).filter(Boolean).at(-1) ?? '';
          for (const cls of last.match(/\.grimoire-[\w-]+/g) ?? []) drawn.add(cls.slice(1));
        }
      }
    }

    const boxedIcons: string[] = [];
    for (const file of listSourceFiles('src')) {
      const source = readFileSync(file, 'utf8');
      for (const cls of drawn) {
        const holder = new RegExp(`createSpan\\(\\{\\s*cls:\\s*'${cls}'\\s*\\}\\)`);
        if (!holder.test(source)) continue;
        if (!new RegExp(`setIcon\\(\\w*[Cc]hevron\\w*`).test(source)) continue;
        boxedIcons.push(`${file}: .${cls}`);
      }
    }

    expect(boxedIcons).toEqual([]);
  });

  it('sizes and colours a glyph, and never boxes one', () => {
    // `.grimoire-file-chip-icon svg` had been left at the head of the chip's
    // own rule, so every 12px file glyph in the composer inherited the chip's
    // 24px height, its padding and its 40% accent border - a bordered box
    // around a bordered box, on every attachment. An svg takes width, height,
    // stroke and colour; a box is the element around it.
    const boxed: string[] = [];
    for (const file of CSS_FILES) {
      const css = read(file);
      for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selectors = rule[1].split(',').map(part => part.split(/\s+/).join(' ').trim());
        if (!selectors.some(selector => /(^|\s)svg(:[a-z-]+)?$/.test(selector))) continue;
        for (const declaration of rule[2].split(';')) {
          const [property, value] = declaration.split(':').map(part => part?.trim());
          if (!property || !value) continue;
          if (!/^(border|padding|background)/.test(property)) continue;
          if (['none', 'transparent', '0'].includes(value)) continue;
          boxed.push(`${file}: ${selectors.join(', ')} -> ${property}: ${value}`);
        }
      }
    }

    expect(boxed).toEqual([]);
  });

  it('spends the accent at the alphas the token layer names', () => {
    // The budget is a 40% border, a 12% wash and an 8% wash. Fourteen feature
    // declarations had written their own alpha instead - 7, 10, 13, 14, 15, 20,
    // 42, 46 - which is how a system with three accent surfaces ends up with
    // eight that no two surfaces share. The mix belongs in the token layer; a
    // sheet reads --grimoire-accent-line, -wash or -wash-weak.
    const literal: string[] = [];
    for (const file of MODULE_FILES) {
      for (const match of read(file).matchAll(/color-mix\([^)]*var\(--grimoire-accent\)\s*\d+%/g)) {
        literal.push(`${file}: ${match[0]}`);
      }
    }

    expect(literal).toEqual([]);
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

  it('leaves every Obsidian variable to the token layer', () => {
    // The rule the whole system rests on, and it was true of the accent only:
    // 476 declarations across 40 sheets read --text-muted, --background-primary
    // and their family directly, so "swap the token layer" was a claim the
    // stylesheets could not honour. A reference that carries its own fallback
    // is a stack rather than a dependency and stays readable.
    const HOST_TOKEN = /var\(\s*(--(?:background|text|interactive|color|font|size|radius|shadow|line-height|icon|scrollbar|code|input|prompt|tab|nav|checkbox|toggle|slider|divider|indentation|blockquote|embed|callout|graph|table|list|hr|bold|italic|link|highlight|mermaid|canvas|swatch|search|titlebar|ribbon|status-bar|file-explorer|metadata|inline-title|heading|h[1-6]|cursor|collapse|vault|mobile|modal|dialog|dragging|layer|pdf|footnote|math|dataview|setting)[a-z0-9-]*)\s*\)/;
    // Obsidian's own settings-row variables are the exception, and the reason
    // is the rule next door: a settings surface must look native, so matching
    // the host's row geometry means reading the host's numbers for it.
    const NATIVE_SETTINGS_ROW = /^--setting-items-/;
    const leaks: string[] = [];
    for (const file of MODULE_FILES) {
      const lines = read(file).split(/\r?\n/);
      lines.forEach((line, index) => {
        const match = HOST_TOKEN.exec(line);
        if (match && !NATIVE_SETTINGS_ROW.test(match[1])) {
          leaks.push(`${file}:${index + 1} ${match[1]}`);
        }
      });
    }

    expect(leaks).toEqual([]);
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

/*
 * A utility that hides has to outweigh the component rules it hides.
 *
 * Order only decides a tie, and `.grimoire-hidden` written once is a single
 * class — it loses outright to any component rule with two. The composer has
 * one, so it could not be hidden at all, and the plan card that is appended
 * after it (and only looks like a replacement because the composer goes away)
 * was drawn underneath the text field. Repeating the class is what buys the
 * weight; `!important` is not available, and the review gate is right about that.
 */
describe('visibility utilities', () => {
  const css = readFileSync('src/style/accessibility.css', 'utf8');

  it('outweighs a two-class component rule', () => {
    expect(css).toContain('.grimoire-hidden.grimoire-hidden {');
  });

  it('is not undone by the component rule that shipped broken', () => {
    // The composer is the element this was found on: a two-class rule sets its
    // display, and the plan card takes its place only by hiding it.
    const input = readFileSync('src/style/components/input.css', 'utf8');
    const composerRule = input.match(
      /\.grimoire-container--chat-window \.grimoire-composer-shell \{[^}]*\}/,
    )?.[0] ?? '';

    expect(composerRule).toContain('display: grid');

    // And order still has to back the weight up: a tie goes to the last rule.
    const index = readFileSync('src/style/index.css', 'utf8');
    expect(index.indexOf('accessibility.css'))
      .toBeGreaterThan(index.indexOf('components/input.css'));
  });
});
