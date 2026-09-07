# Style Agent Instructions

`src/style/` is modular CSS built into root `styles.css`.

## Structure

- `base/` - container, variables, animations
- `components/` - header, history, messages, code, thinking, tool calls, status panel, subagents, input, context footer, tabs, navigation
- `toolbar/` - model, thinking, permission, service tier, external context, MCP selectors
- `features/` - feature surfaces such as file context, images, inline edit, diff, slash commands, file links, plan mode, ask-user, resume session
- `modals/` - instruction, MCP, fork target
- `settings/` - settings shell and provider/settings panels
- `index.css` - import order for the CSS build

## Build Rules

- Register new CSS modules in `src/style/index.css`.
- `npm run build:css` is invoked by `npm run dev`, `npm run build`, and `npm run build:release`.
- Generated root `styles.css` must match source output after release build.

## Conventions

- Use `.grimoire-` for Grimoire-owned classes.
- Prefer BEM-lite names: `.grimoire-block`, `.grimoire-block-element`, `.grimoire-block--modifier`.
- Avoid `!important` unless overriding unavoidable Obsidian host styles. The release CSS gate fails on `!important`.
- Read a **Grimoire** token, never an Obsidian one. `base/variables.css` is the only file that reads
  `--background-*`, `--text-*`, `--interactive-*`, `--radius-*`, `--size-*` or `--font-ui-*`.
- Use `var(--grimoire-mono)` for code, command, and machine-readable text.

## The Nordic token layer

[`docs/design-system.md`](../../docs/design-system.md) is the canonical description and
[`docs/design/Grimoire Nordic.html`](../../docs/design/Grimoire%20Nordic.html) is the drawing it is
of; this is the working reference for editing files in this directory. A change to a surface is
checked by rendering it beside the mock, not by reading the rule you just wrote.

**`base/variables.css` is the only file that reads an Obsidian variable.** Everything else reads a
Grimoire token. The layer is defined on `body`, not on `.grimoire-container`, because settings tabs
and modals are children of the host rather than of the chat view — three copies of it had already
grown apart before that moved.

| Group | Read this | Never this |
|---|---|---|
| Accent | `--grimoire-accent`, `--grimoire-accent-text`, `--grimoire-accent-line` (40%), `--grimoire-accent-wash` (12%), `--grimoire-accent-wash-weak` (8%), `--grimoire-focus-ring` | `--interactive-accent`, `--text-accent`, a hex, an `rgba()` triple |
| Ground | `--grimoire-ground`, `--grimoire-plane`, `--grimoire-hover`, `--grimoire-field` | `rgba(255, 255, 255, …)`, `color-mix(… #000)` |
| Line | `--grimoire-line`, `--grimoire-line-2`, `--grimoire-line-3` | a literal border colour |
| Ink | `--grimoire-ink`, `--grimoire-ink-muted`, `--grimoire-ink-faint`, `--grimoire-ink-ghost` | a literal text colour, `--text-normal`, `--text-muted` |
| Face | `--grimoire-face`, `--grimoire-mono` | `--font-interface`, `--font-monospace` |
| Space | `--grimoire-space-<n>`, named by the value: 2, 4, 6, 8, 10, 12, 14, 16, 20, 22, 24, 40 | any padding/margin/gap px below 32 |
| Size | `--grimoire-header-h` 40, `--grimoire-hit-s/m/l` 24/26/28, `--grimoire-chip-h` 24, `--grimoire-tool-row-h` 26, `--grimoire-segment-h` 26, `--grimoire-list-row-h` 34 | a one-off control height |
| Radius | `--grimoire-radius-1/2/3`, `--grimoire-radius-pill`, `--grimoire-radius-circle` | a px radius |
| Type | `--grimoire-text-2xs/xs/s/m/l/xl` (10, 11, 12, 13, 15, 20px at host defaults) | a px `font-size` |
| Icon | `--grimoire-icon-s/m/l` 12/14/16, `--grimoire-stroke` 1.75, `--grimoire-stroke-check` 2.25 | a px `width` on an svg |
| Weight | `--grimoire-weight-normal/medium/semibold/bold` | a numeric `font-weight` |
| Lift | `--grimoire-lift-0/1/2` (`none`, `--shadow-s`, `--shadow-l`) | a hand-rolled `box-shadow` stack |
| Motion | `--grimoire-duration`, `--grimoire-duration-slow`, `--grimoire-ease` | any transition time at or under 0.32s |
| Status | `--grimoire-ok`, `--grimoire-warn`, `--grimoire-error`, `--grimoire-error-line` (40%), `--grimoire-error-wash` (12%) | a colour standing in for a word |

Rules the gates hold, in `tests/unit/style/designSystem.test.ts` and `themeAdaptation.test.ts`:

1. every Grimoire token a stylesheet reads without a fallback is defined, or is one of the twelve a
   controller sets per element;
2. sizes, weights and radii are steps in the scale;
3. colour comes from the theme — no `rgba(<digits>` and no hex anywhere, including the token layer;
4. spacing below 32px is a token;
5. motion is one duration on one curve;
6. `.setting-item` is never selected without a `.grimoire-` scope;
7. the accent is read in one place;
8. the layer depends on no Obsidian variable the app does not define, resolves on both themes, and
   each type step lands where the literal it replaced stood;
9. provider identity is a glyph in ink — no `--grimoire-provider-*`, and no rule selected by
   `[data-provider=…]`, because a rule selected by provider id exists to paint that provider;
10. no module sheet reads an Obsidian variable at all. The rule was true of the accent only, and
    476 declarations across 40 sheets read `--text-muted`, `--background-primary` and their family
    directly — so "swap the token layer" was a claim the stylesheets could not honour. The one
    exception is `--setting-items-*`, because matching the host's settings-row geometry means
    reading the host's numbers for it.

**Prove a new rule by breaking it.** Copy the file to the scratchpad in the same command that injects
the defect, watch the gate fail, then restore from the copy — never `git checkout`, which discards the
uncommitted work the rule is about.

**No fixed colours.** There is no exception left. The nine provider brand colours were the one place
a hex belonged, and Nordic draws a provider as its own mark in `--grimoire-ink-muted` instead, so
nothing in the plugin names a hue the user did not pick. Status is an accent dot beside a word, never
a hue on its own.

**Accent alpha.** There is no accent RGB triple in Obsidian — `--interactive-accent-rgb` and
`--color-accent-rgb` do not exist, which is how thirty-two surfaces shipped painting a fallback
violet. Express a translucent accent as
`color-mix(in srgb, var(--grimoire-accent) N%, transparent)`.

**Regenerating the theme fixture.** `node scripts/generate-theme-tokens.mjs` rewrites
`tests/fixtures/obsidian/theme-tokens.json` — the transitive closure of the Obsidian variables this
layer depends on, read from the `app.css` inside the installed `obsidian-<version>.asar`. Run it
after adding a dependency on a host variable, and after an app upgrade. It takes the root tables only
— `body`, `.theme-light`, `.theme-dark` — because collecting every declaration in the file picks up
component-scoped ones and makes `--background-modifier-border` resolve to `transparent` on both
themes.

## Outranking the host

Obsidian names elements and attributes; Grimoire names classes; a class alone loses. Every rule below
replaced a shipped defect, and every one of them was found by rendering the surface with the real
`app.css` — see §16 of [`docs/design-system.md`](../../docs/design-system.md) for how to build that
render and read measurements out of it.

| The host's rule | Weight | Write |
|---|---|---|
| `button:not(.clickable-icon)` | element + class | `button.grimoire-…` |
| `input[type='text']` | element + attribute | `input.grimoire-…` |
| `input[type='text']:focus`, `:focus-visible` | element + attribute + pseudo | `input.grimoire-…:focus`, `:focus-visible` |
| `.modal` (width, padding) | class, on the modal itself | size `.grimoire-…-modal`, not its `.modal-content` |

And one that is Grimoire against itself: **a modifier of an element-named base must name the element
too.** `button.grimoire-icon-btn` outweighs `.grimoire-icon-btn--small`, so that modifier never
reached its own width and height and every small icon button drew at the large size. The gate for it
is `lets a modifier outrank the base it modifies` in `tests/unit/style/designSystem.test.ts`.

Two things the gates cannot do for you. They only see properties the plugin actually wrote, so a
missing `:focus` rule is not a violation of anything — nothing will tell you the host is drawing a
ring you did not ask for. And they compare text, not pixels: a rule can be present, correct and
overruled. Render the surface.

## Obsidian community CSS review

Obsidian community plugin review scores CSS against a **compatibility baseline** (historically Electron / app **1.11.4**), not only against Grimoire's `manifest.json` `minAppVersion` (currently 1.13.0). Features that work fine in modern Obsidian can still lower the review score if the baseline lists them as partial or unsupported.

Local gate (runs in `npm run review:css` and `prebuild:release`):

- `scripts/reviewCss.js` — `OBSIDIAN_PARTIAL_CSS_FEATURES` denylist (regex + message matching Obsidian's wording).
- `scripts/check-review-css.mjs` — fails on `!important` **and** any denylisted feature in `src/style/**` and root `styles.css`.

**Known denylisted feature today**

| Feature | Do not use | Prefer |
|---------|------------|--------|
| `css-display-contents` | `display: contents` | Normal flow (`display: block` / `flex` / `grid` on a real box). For marker wrappers (e.g. `.grimoire-workspace-provider-section`), keep a real box and style children with `> .wrapper > …` selectors when needed. |

When Obsidian's CSS lint reports a new partial/unsupported feature:

1. Prefer a layout rewrite that avoids the feature (do not silence the warning with host-only assumptions).
2. Add a denylist entry to `OBSIDIAN_PARTIAL_CSS_FEATURES` with the same feature id/message Obsidian used.
3. Add or extend a unit test in `tests/unit/scripts/reviewGate.test.ts` (and a focused style assertion under `tests/unit/style/` when the fix is specific to one surface).
4. Mention the constraint in this file if it is a recurring pattern, not a one-off.

Do not assume “we require Obsidian 1.13+ so the 1.11.4 warning is irrelevant” — community review still rates against their baseline.

## UI Gotchas

- Keep chat tables and tool outputs contained with local scrolling/truncation instead of widening the chat pane.
- Do not put cards inside cards.
- Keep fixed-format controls dimensionally stable so hover states, counters, labels, and loading text do not shift layout.
- Obsidian uses `body.theme-dark` and `body.theme-light` for theme detection.
- Modal z-index must be high enough to overlay Obsidian UI.
