# Nordic — the Grimoire design system

A restrained, theme-native visual system for the Grimoire workspace: Japanese and Scandinavian
minimalism expressed through Obsidian's own design tokens, so the plugin follows whatever theme and
accent colour the user has chosen without ever naming either.

## Why a token system rather than a skin

Obsidian's plugin review penalises a plugin that redecorates the host. A plugin that ships its own
palette also breaks on every community theme, and there are thousands. The way to look designed in
Obsidian is not to paint over it — it is to use its variables with more discipline than the host
itself does, and to spend the saved attention on rhythm, hairlines and space.

Every value below was read out of the real `app.css` in `obsidian-1.13.7.asar` rather than
remembered, because a token that does not exist degrades silently: `var(--missing)` on a `color`
property does not fall back to a sane default, it inherits, and the surface renders in the wrong
colour with nothing in the console. This repository already had three such declarations.

## Principles

1. **Inherit, never assert.** Every colour resolves to an Obsidian token. The only fixed colours in
   the system are provider brand marks, which are identity rather than decoration.
2. **The accent is a line, not a fill.** The user's accent appears as a hairline, a focus ring, an
   active label, a status dot, or a 10-16% wash. A saturated block of accent is reserved for a single
   primary action per surface, where Obsidian itself would use `.mod-cta`.
3. **Elevation is subtraction.** The default elevation is `none`. Shadow is for surfaces that
   genuinely float above the document — popovers, dropdowns, modals — and it comes from Obsidian's
   `--shadow-s` / `--shadow-l`, so it matches every other floating thing in the app.
4. **Structure is drawn with 1px rules and space**, in that order. A hairline separates; a card
   encloses. Prefer the hairline. Never nest a card in a card.
5. **One spatial grid.** Obsidian's 4px ladder (`--size-2-*`, `--size-4-*`). No arbitrary gaps.
6. **Type scales with the reader.** Sizes come from `--font-ui-smaller/small/medium/large`, which are
   `calc()`ed off the user's own `--font-text-size`. A literal `11.5px` ignores a reader who set
   their interface larger, which is an accessibility regression, not a design choice.
7. **Corners belong to the theme.** Radii come from `--radius-s/m/l`, so a square-cornered theme
   stays square.
8. **Motion is short and singular.** One duration, one easing curve, and nothing animates position
   on a surface the user is reading.

## Icons and text

Icons carry recognition; words carry meaning. The rule that follows from that:

- **Icon plus label** for anything with a decision cost — actions in menus, settings rows, buttons
  whose consequence is not obvious from the shape. The icon speeds re-finding; the label is what
  makes the choice.
- **Icon only** in dense, repeating chrome where the same control appears many times and the user
  learns it once: tab strips, message hover actions, composer toolbars. Every icon-only control
  carries an `aria-label` and an Obsidian tooltip, so the label still exists — it is just deferred.
- **Never icon-only for a destructive or irreversible action.** Delete, revoke, discard and reset
  keep their words.
- Icons come from Obsidian's bundled Lucide set via `setIcon()`, at `--icon-s`/`--icon-m` with the
  host's stroke width, so they weigh the same as every native icon beside them.

**An icon-only control must still be a control.** `asActivatable` in
`src/shared/components/activatable.ts` gives a non-button element the role, the accessible name, the
tab stop and the Enter/Space handling a button has, and the marker class the focus ring hangs on.
`markDecorative` hides an icon that sits beside its own label, because a Lucide glyph otherwise
announces as its file name. Both exist because the pattern was written by hand in twenty-four places
and missing in nineteen — including a fork-target modal that offered a choice the keyboard could not
make, where the only key it answered was Escape, which declines.

A row inside a list the container navigates with the arrow keys passes `inTabOrder: false`: it takes
the name and the role and leaves the tab order to its container. Rows that already have a visible
label and a container-level focus model — the inline plan and question lists — are left alone: a
`role="button"` on a row a listbox owns would describe it wrongly, and a wrong role is worse than
none.

## Tokens

Grimoire tokens are a semantic layer over Obsidian's. Feature CSS reads the Grimoire token; only
`base/variables.css` reads an Obsidian one. That is what makes a theme change a no-op and a system
change a one-line edit.

| Group | Grimoire token | Resolves to |
|---|---|---|
| Accent | `--grimoire-accent`, `--grimoire-accent-text`, `--grimoire-accent-line`, `--grimoire-accent-wash` | `--interactive-accent`, `--text-accent`, accent at 40% / 10% |
| Ground | `--grimoire-ground`, `--grimoire-plane`, `--grimoire-hover`, `--grimoire-field` | `--background-primary`, `--background-secondary`, `--background-modifier-hover`, `--background-modifier-form-field` |
| Line | `--grimoire-line`, `--grimoire-line-2`, `--grimoire-line-3` | `--background-modifier-border{,-hover,-focus}` |
| Ink | `--grimoire-ink`, `--grimoire-ink-muted`, `--grimoire-ink-faint`, `--grimoire-ink-ghost` | `--text-normal`, `--text-muted`, `--text-faint`, faint at 62% |
| Space | `--grimoire-space-1` … `--grimoire-space-8` | `--size-2-1` … `--size-4-6` |
| Radius | `--grimoire-radius-1/2/3` | `--radius-s/m/l` |
| Type | `--grimoire-text-xs/s/m/l` | `--font-ui-smaller/small/medium/large` |
| Weight | `--grimoire-weight-normal/medium/semibold` | `--font-normal/medium/semibold` |
| Lift | `--grimoire-lift-0/1/2` | `none`, `--shadow-s`, `--shadow-l` |
| Motion | `--grimoire-duration`, `--grimoire-ease` | fixed, and the only two motion values in the system |

## Settings

Settings surfaces are built with Obsidian's declarative settings API and render as native
`.setting-item` rows. Grimoire styles the content it puts *inside* a row, never the row itself: no
overrides of `.setting-item`, `.setting-item-info`, `.setting-item-name`, `.setting-item-control` or
their spacing. A settings tab that looks native is the goal, not a constraint worked around.

## Gates

- `npm run review:css` — no `!important`, no feature on Obsidian's partial-support denylist.
- `tests/unit/style/designSystem.test.ts` — the system is enforced rather than documented: every
  Grimoire token a stylesheet reads must be defined, and the literals the system replaced must not
  come back.

## What adopting it found

The sweep was mechanical, but it surfaced defects rather than only inconsistencies. Recorded here
because each one is a class, not an instance.

- **Three declarations read `--grimoire-workbench-ghost`, and nothing defined it.** An undefined
  custom property does not fall back — `color: var(--undefined)` inherits — so the panel section
  count and two history surfaces rendered in their parent's colour, silently. This is the reason the
  token gate checks resolution rather than spelling.
- **The plugin was partly hardcoded to dark themes.** Scrollbars at `rgba(255, 255, 255, 0.14)`,
  hover states as white washes, a menu at `rgba(31, 30, 36, 0.985)`, an image backdrop at
  `rgba(0, 0, 0, 0.85)`, and panels tinted by mixing toward `#000`. All of them read as intended on a
  dark theme and as damage on a light one. Obsidian has a token for each: `--scrollbar-thumb-bg`,
  `--background-modifier-hover`, `--background-secondary`, `--background-modifier-cover`.
- **A light-mode override existed to repair one of those.** `code.css` re-stated the code background
  under `body.theme-light` because the dark value was a literal. `--code-background` answers both
  themes, so the override is deleted rather than kept.
- **The settings sheet carried a second design system.** Its own radii (`--gs-r1/2/3` at 6/9/13px),
  its own pill, and a full second copy of the provider palette in `--gs-dot-*` — nine declarations,
  every one of them unused. The token block moved to `body` so settings, modals and the chat view
  read one definition, and the duplicate is gone.
- **The accent reached 65 rules directly.** Every one was a correct use of the user's colour and none
  of them went through a decision about how much accent a surface may show. They read the token now,
  which is what makes "the accent is a line, not a fill" enforceable instead of aspirational.
- **A violet glow was hardcoded** in an animation, in a plugin whose accent is the user's choice.

Scale, before and after: 15 font sizes to a 7-step ladder that scales with the reader's own setting;
13 font weights to 4; 12 radii to 3 plus two shapes; 16 interaction durations to 1; 123 shadows to a
3-step lift where the default is nothing; 6 decorative gradients to flat surfaces.
