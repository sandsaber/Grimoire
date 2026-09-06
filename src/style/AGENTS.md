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

[`docs/design-system.md`](../../docs/design-system.md) is the canonical description; this is the
working reference for editing files in this directory.

**`base/variables.css` is the only file that reads an Obsidian variable.** Everything else reads a
Grimoire token. The layer is defined on `body`, not on `.grimoire-container`, because settings tabs
and modals are children of the host rather than of the chat view — three copies of it had already
grown apart before that moved.

| Group | Read this | Never this |
|---|---|---|
| Accent | `--grimoire-accent`, `--grimoire-accent-text`, `--grimoire-accent-line`, `--grimoire-accent-soft`, `--grimoire-focus-ring` | `--interactive-accent`, `--text-accent`, a hex, an `rgba()` triple |
| Ground | `--grimoire-ground`, `--grimoire-plane`, `--grimoire-hover`, `--grimoire-field` | `rgba(255, 255, 255, …)`, `color-mix(… #000)` |
| Line | `--grimoire-line`, `--grimoire-line-2`, `--grimoire-line-3` | a literal border colour |
| Ink | `--grimoire-ink`, `--grimoire-ink-muted`, `--grimoire-ink-faint`, `--grimoire-ink-ghost` | a literal text colour |
| Space | `--grimoire-space-1` … `-8` (2, 4, 6, 8, 12, 16, 20, 24px) | any padding/margin/gap px below 32 |
| Radius | `--grimoire-radius-1/2/3`, `--grimoire-radius-pill`, `--grimoire-radius-circle` | a px radius |
| Type | `--grimoire-text-2xs` … `-2xl` (10, 11, 12, 13, 14, 16, 20px at host defaults) | a px `font-size` |
| Weight | `--grimoire-weight-normal/medium/semibold/bold` | a numeric `font-weight` |
| Lift | `--grimoire-lift-0/1/2` (`none`, `--shadow-s`, `--shadow-l`) | a hand-rolled `box-shadow` stack |
| Motion | `--grimoire-duration`, `--grimoire-duration-slow`, `--grimoire-ease` | any transition time at or under 0.32s |

Rules the gates hold, in `tests/unit/style/designSystem.test.ts` and `themeAdaptation.test.ts`:

1. every Grimoire token a stylesheet reads without a fallback is defined, or is one of the thirteen a
   controller sets per element;
2. sizes, weights and radii are steps in the scale;
3. colour comes from the theme — no `rgba(<digits>` and no hex outside a provider-mark fallback;
4. spacing below 32px is a token;
5. motion is one duration on one curve;
6. `.setting-item` is never selected without a `.grimoire-` scope;
7. the accent is read in one place;
8. the layer depends on no Obsidian variable the app does not define, resolves on both themes, and
   each type step lands where the literal it replaced stood.

**Prove a new rule by breaking it.** Copy the file to the scratchpad in the same command that injects
the defect, watch the gate fail, then restore from the copy — never `git checkout`, which discards the
uncommitted work the rule is about.

**Fixed colours.** Provider marks (`--grimoire-provider-*`) are identity rather than decoration and
are the one place a hex belongs. They live in `base/variables.css` with that reason written down.

**Accent alpha.** There is no accent RGB triple in Obsidian — `--interactive-accent-rgb` and
`--color-accent-rgb` do not exist, which is how thirty-two surfaces shipped painting a fallback
violet. Express a translucent accent as
`color-mix(in srgb, var(--grimoire-brand) N%, transparent)`.

**Regenerating the theme fixture.** `tests/fixtures/obsidian/theme-tokens.json` is the transitive
closure of the Obsidian variables this layer depends on, read from the `app.css` inside the installed
`obsidian-<version>.asar`. Take it from the root tables only — `body`, `.theme-light`, `.theme-dark`.
Collecting every declaration in the file picks up component-scoped ones and makes
`--background-modifier-border` resolve to `transparent` on both themes.

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
