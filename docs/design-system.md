# Nordic — the Grimoire design system

A restrained, theme-native visual system for the Grimoire workspace. Every colour it uses is one the
reader already chose, every size is one the reader can change, and the whole of its own vocabulary is
a hairline, a wash and a dot.

This is the canonical description. Read it before changing any surface's appearance, adding a
stylesheet, or introducing a control.

**The picture this prose describes is [`docs/design/Grimoire Nordic.html`](design/Grimoire%20Nordic.html)** —
thirteen screens of the plugin drawn in the system, in English, using nothing but Obsidian's own
variables. Open it in a browser. Where the prose and the mock disagree about a number, the mock is
the drawing and this file is the reasoning; say which one you followed and why.

| | | |
|---|---|---|
| `1a` Chat sidebar | `1b` Empty tab with history | `1c` Composer states |
| `2a` Panels | `2b` Conversation states and reasoning | `2c` Model picker and dropdowns |
| `2d` Decisions | `2e` Modals | `2f` Settings |
| `2g` Providers and tokens | `3a` Composer with many attachments | `3b` Manage context dialog |
| `3c` Add from vault | | |

Comparing a surface against it is a render, not a reading — see §16.

---

## 1 · Why a token system rather than a skin

Obsidian's plugin review penalises a plugin that redecorates the host. A plugin that ships its own
palette also breaks on every community theme, and there are thousands. The way to look designed in
Obsidian is not to paint over it — it is to use its variables with more discipline than the host
itself does, and to spend the saved attention on rhythm, hairlines and space.

Every Obsidian value the layer names was read out of the real `app.css` inside
`obsidian-1.13.7.asar` rather than remembered, because a token that does not exist degrades silently:
`var(--missing)` on a `color` property does not fall back to a sane default, it **inherits**, and the
surface renders in the wrong colour with nothing in the console. This repository had shipped three
such declarations and one fixed violet on thirty-two surfaces.

`node scripts/generate-theme-tokens.mjs` regenerates `tests/fixtures/obsidian/theme-tokens.json`, the
environment the adaptation tests resolve the layer against. Run it after adding a dependency on a
host variable and after an app upgrade.

---

## 2 · The rule the system rests on

> **Feature CSS reads a Grimoire token. Only `src/style/base/variables.css` reads an Obsidian one.**

That single sentence is what makes a theme swap a no-op and a system change a one-line edit. It was
true of the accent alone for a while, and untrue of everything else: 476 declarations across 40
sheets read `--text-muted`, `--background-primary`, `--font-ui-small` and their family directly. A
sheet that reads the host directly is a sheet that cannot be told what the system decided.

It is enforced now — `tests/unit/style/designSystem.test.ts`, "leaves every Obsidian variable to the
token layer" — with exactly one exception, stated rather than silent: `--setting-items-*`. Matching
the host's settings-row geometry means reading the host's numbers for it, which is the point of §10.

---

## 3 · Principles

1. **Inherit, never assert.** Every colour resolves to an Obsidian token. There are no fixed colours
   at all — the nine provider brand colours were the last exception and they are gone.
2. **The accent is a line, not a fill.** See the budget in §5. A saturated block of accent is
   reserved for a single primary action per surface.
3. **Elevation is subtraction.** The default elevation is `none`. Shadow is for a surface that
   genuinely floats — a popover, a dropdown, a modal — and it is one step, `--shadow-s`. The image
   lightbox is the one surface heavy enough for `--shadow-l`, because it covers the app.
4. **Structure is drawn with 1px rules and space, in that order.** A hairline separates; a card
   encloses. Prefer the hairline. Never nest a card in a card, and never put a rule inside a box that
   already has one — that is a second box.
5. **One spatial ladder**, named by its own values (§6). No arbitrary gaps.
6. **Type scales with the reader.** Sizes come from Obsidian's interface ladder, which it `calc()`s
   off the reader's `--font-text-size`. A literal `11.5px` ignores a reader who set their interface
   larger, which is an accessibility regression, not a design choice.
7. **Corners belong to the theme.** Radii come from `--radius-s/m/l`, so a square-cornered theme
   stays square.
8. **Motion is short and singular.** Two keyframes, one duration, one curve, and nothing animates
   position on a surface the reader is already reading.
9. **Status is a dot beside a word.** Never a hue on its own — that is a state a reader with a colour
   deficiency cannot read and a reader who has not learnt the palette cannot name.
10. **Settings look native.** Grimoire styles what it puts *inside* an Obsidian settings row, never
    the row.

---

## 4 · Colour — inherited, never named

| Grimoire token | Resolves to | Used for |
|---|---|---|
| `--grimoire-ground` | `--background-primary` | every surface: the chat column, popovers, modals, lists |
| `--grimoire-plane` | `--background-secondary` | the user's own message, the page ground |
| `--grimoire-code` | `--code-background` | code blocks, diff blocks, inline code, a command in a permission ask |
| `--grimoire-hover` | `--background-modifier-hover` | hover, and the wash on an active tab, row or segment |
| `--grimoire-line` | `--background-modifier-border` | every 1px rule: borders, dividers, left rules |
| `--grimoire-line-2` | `--background-modifier-border-hover` | a scrollbar thumb, a hovered line |
| `--grimoire-line-3` | `--background-modifier-border-focus` | the composer's focused border, an unchecked checkbox, an empty effort dot |
| `--grimoire-ink` | `--text-normal` | primary text |
| `--grimoire-ink-muted` | `--text-muted` | secondary text, an icon button at rest, provider marks |
| `--grimoire-ink-faint` | `--text-faint` | meta: monospace paths, times, counts, group labels |
| `--grimoire-ink-ghost` | faint at 62% | the quietest ink in the system |
| `--grimoire-accent` | `--interactive-accent` | the accent, spent on the budget below |
| `--grimoire-accent-contrast` | `--text-on-accent` | text or a glyph on an accent fill |
| `--grimoire-error` | `--text-error` | a failed tool, a destructive hover, an unreadable attachment, the `−` of a diff |
| `--grimoire-ok` | `--text-success` | the `+` of a diff, and a settled state beside its word |
| `--grimoire-warn` | `--color-yellow` | a budget approaching its edge |
| `--grimoire-cover` | `--background-modifier-cover` | the lightbox scrim |
| `--grimoire-selection` | `--text-selection` | the reader's own selection |
| `--grimoire-lift-0/1/2` | `none`, `--shadow-s`, `--shadow-l` | the three steps of elevation, and the first is nothing |

**There is no accent RGB triple in Obsidian.** `--interactive-accent-rgb` and `--color-accent-rgb` do
not exist, which is how thirty-two surfaces shipped painting a fallback violet whatever accent the
reader had picked. A translucent accent is
`color-mix(in srgb, var(--grimoire-accent) N%, transparent)` — always.

---

## 5 · The accent budget

The core rule of the system. The accent may appear only as:

| Form | Where | Token |
|---|---|---|
| **Line** | active tab underline (1.5px), selected/active row leading rule (1.5px), focus ring, progress fill | `--grimoire-accent` |
| **Dot** | 5px: streaming (filled, pulsing), needs-attention (1px outline, hollow), enabled, loaded. 3px: an effort level | `--grimoire-accent` |
| **Glyph** | tool icons, success checks, decision glyphs, spinners | `--grimoire-accent` |
| **40% line** | the border on a context chip and on an attached image | `--grimoire-accent-line` |
| **12% wash** | a pressed toggle (Plan on), a drop target, an inline insertion | `--grimoire-accent-wash` |
| **8% wash** | the bulk-selection band in the manage dialog, and nothing else | `--grimoire-accent-wash-weak` |
| **Fill** | **exactly one** primary action per surface — Send, Allow once, Save, Start, Add, Done | `--grimoire-accent` + `--grimoire-accent-contrast` |

Anything else is ink, ground or line.

Two consequences worth stating on their own:

- **Provider identity is a glyph in `--grimoire-ink-muted`, never a colour.** The nine brand colours
  said nothing to a reader who had not learnt the palette and nothing at all to one who cannot
  separate the hues, and they reached five stylesheets — five chances for one provider to be two
  colours. The gate forbids `--grimoire-provider-*` and any rule selected by `[data-provider=…]`,
  because a rule selected by provider id exists to paint that provider.
- **Status is the accent dot, not a hue.** A completed tool's check is the accent rather than green,
  because green already means "added" in a diff two rows below.

---

## 6 · Space — one ladder, named by its values

```
2  4  6  8  10  12  14  16  20  22  24  40
```

`--grimoire-space-<n>`, where `<n>` is the value. A step is named by what it is, not by an ordinal
position that says nothing: `--grimoire-space-10`, never `--grimoire-space-5` that happens to be 12px
today. Where Obsidian has a step (2, 4, 6, 8, 12, 16, 20, 24) the token reads the host's, so Grimoire
keeps the app's rhythm; 10, 14, 22 and 40 are Nordic's own, because the design uses them and the 4px
ladder has no token for them.

**Sibling groups are laid out with flex or grid and `gap`, never with margins.**

The gate holds every spacing value below 32px to the ladder. Above it the number is layout, and stays
a number.

### Fixed sizes

The heights the system repeats. Nothing in between is a size.

| Token | Value | What |
|---|---|---|
| `--grimoire-header-h` | 40px | the header |
| `--grimoire-hit-s` | 24px | a control in a message meta row, a row action |
| `--grimoire-hit-m` | 26px | a panel-switch segment, a transcript jump control |
| `--grimoire-hit-l` | 28px | a header action, a composer toolbar control, Send |
| `--grimoire-chip-h` | 24px | an attachment chip |
| `--grimoire-tool-row-h` | 26px | a tool step |
| `--grimoire-segment-h` | 26px | a segmented control |
| `--grimoire-list-row-h` | 34px | a row in the manage dialog or the thread outline |

---

## 7 · Radius

| Token | Value | What it encloses |
|---|---|---|
| `--grimoire-radius-1` | `--radius-s` (4px) | controls, rows, chips, code blocks, buttons |
| `--grimoire-radius-2` | `--radius-m` (8px) | surfaces: popovers, modals, the user's message, decision cards |
| `--grimoire-radius-3` | `--radius-l` (12px) | the composer card, and only that |
| `--grimoire-radius-circle` | 50% | a dot |
| `--grimoire-radius-pill` | 999px | a progress track, and only that |

**There is no badge pill.** A count, a tool name, a step number, a question tag and a provider's
status were all wearing one; they are meta type now. A pill says "look at me" about something that is
already in the row being read.

---

## 8 · Type

Obsidian's own interface ladder, which the host `calc()`s from the reader's `--font-text-size`. Five
steps carry the whole plugin.

| Token | At host defaults | What it sets |
|---|---|---|
| `--grimoire-text-2xs` | 10px | uppercase monospace group labels, keyboard hints |
| `--grimoire-text-xs` | 11px | monospace meta: paths, times, counts, token estimates |
| `--grimoire-text-s` | 12px (`--font-ui-smaller`) | the workhorse — chrome, tabs, tool rows, chips, list rows |
| `--grimoire-text-m` | 13px (`--font-ui-small`) | body prose and the composer input |
| `--grimoire-text-l` | 15px (`--font-ui-medium`) | a modal title, an empty state |
| `--grimoire-text-xl` | 20px (`--font-ui-large`) | display, used almost nowhere |
| `--grimoire-text-inline-code` | 0.92em | the one size relative to its own line — inline code has to match the sentence it is in |

The relative step is scoped to `:not(pre) > code`. Markdown renders a fence as `<pre><code>`, so a
rule that sizes `code` for a sentence lands inside a block as well, and multiplies against the step
the block has already taken. That shipped in 2.0: a fenced answer computed at 10.16px against 13px of
prose around it, in message content and thinking content both. A fenced block is set on
`--grimoire-text-s`, one step below prose — the same optical size the correction gives a word of
inline code in that prose, rather than below it. `--grimoire-text-xs` stays what the table says it
is: monospace meta, and the diff and tool rows that are meta. Screen `1a` of the drawing now carries
a fenced block in the answer, because the surface it never drew is the surface that drifted.

Faces: `--grimoire-face` for interface text, `--grimoire-mono` for paths, ids, times, token counts,
commands and keyboard hints. **Monospace means machine-readable**, not "technical-looking": a plan is
prose about the vault and is set in the interface face.

Weights: `--grimoire-weight-normal/medium/semibold/bold`. Four, down from thirteen.

Leading: `--grimoire-leading-tight` 1.3 for chrome, `--grimoire-leading` 1.5 for a control,
`--grimoire-leading-body` 1.55 for prose, `--grimoire-leading-code` 1.6 for code and diffs. Prose and
code are the only two things set looser than the chrome.

Tracking: `--grimoire-label-tracking` `.12em` for a group label, `--grimoire-section-tracking` `.14em`
for a section header. Both are uppercase monospace, and there is no third label style.

---

## 9 · Icons

Lucide, through Obsidian's `setIcon()`.

| Token | Value | Where |
|---|---|---|
| `--grimoire-icon-2xs` | 11px | a mark beside a name rather than an icon of its own: the title source |
| `--grimoire-icon-s` | 12px | inside a line of 12px text: a chevron, a chip glyph, a check |
| `--grimoire-icon-m` | 14px | the chrome default: panel segments, tool steps, list rows |
| `--grimoire-icon-l` | 16px | header actions, a decision card's glyph |
| `--grimoire-stroke` | 1.75 | every icon |
| `--grimoire-stroke-check` | 2.25 | a check and an arrow — at 1.75 a check at 12px reads as a smudge |

`fill: none`, round caps and joins. An icon never sits in a tinted tile: the tile is a second surface
inside a row that is one line tall, doing the job the accent already does.

### Icons and words

Icons carry recognition; words carry meaning.

- **Icon plus label** for anything with a decision cost — actions in menus, settings rows, buttons
  whose consequence is not obvious from the shape.
- **Icon only** in dense repeating chrome the reader learns once: tab strips, message hover actions,
  composer toolbars, panel switches. Every one carries an `aria-label` and an Obsidian tooltip, so
  the label still exists — it is deferred, not dropped.
- **Never icon-only for something that cannot be taken back.** Delete, revoke, discard, reset,
  "Remove all", "Allow once", "Always for this session", "Deny" keep their words.

**An icon-only control must still be a control.** `asActivatable` in
`src/shared/components/activatable.ts` gives a non-button element the role, the accessible name, the
tab stop and the Enter/Space handling a button has, plus the marker class the focus ring hangs on.
`markDecorative` hides an icon that sits beside its own label, because a Lucide glyph otherwise
announces as its file name. Both exist because the pattern was written by hand in twenty-four places
and missing in nineteen — including a fork-target modal that offered a choice the keyboard could not
make, where the only key it answered was Escape, which declines.

A row inside a list the container navigates with the arrow keys passes `inTabOrder: false`: it takes
the name and the role and leaves the tab order to its container.

**A menu with one way in must not need a mouse.** The tab menu was right-click only, which put six
items — close, close others, close right, rename, auto-rename, duplicate — out of reach of the
keyboard entirely. It is a header control now.

---

## 10 · Motion

Two keyframes in the whole system, both in `src/style/base/animations.css`:

- `grimoire-pulse` — 1.4s ease-in-out infinite, opacity 1 → .35. Something is alive: a streaming
  dot, a thinking line.
- `grimoire-spin` — 360°, 0.9s linear. Something is waiting: every spinner in the plugin.

Everything else a surface does — hover, press, open — is `--grimoire-duration` (120ms) on
`--grimoire-ease`. `--grimoire-duration-slow` (200ms) exists for one case: a meter whose fill is the
information.

One exception is written down rather than assumed: `grimoire-tab-close-toast-countdown`. A bar
draining over six seconds is not decoration, it is the deadline on an undo, and a number would be
worse.

Removed on adoption, and not to come back: two glows, three entrance animations and a fade. All five
animated a surface that had just appeared, which is where motion is least welcome and most expensive.

---

## 11 · The surfaces

### 11.1 Header — 40px

`height: 40px; padding: 0 8px 0 12px;` and one rule under it.

- **Tab strip** on the left, `gap: 2px`, full height. A tab is its number and its state. The active
  tab is `--grimoire-ink` at medium weight with a 1.5px accent bottom border and
  `margin-bottom: -1px`, so its underline sits *on* the header's own rule and the two read as one
  line that bends. A streaming tab shows a 5px filled accent dot with `grimoire-pulse`; a tab waiting
  on the reader shows the same dot opened out to a 1px ring; an idle tab shows nothing and is
  `--grimoire-ink-faint`. The add control ends the strip — it extends the strip, so the strip owns
  it — inset `6px 0` from the header's rule.
- **Right**: the context meter, then history, then the tab menu, at `gap: 2px`. The meter is a 14px
  ring with a 2px stroke and a monospace 11px percentage, drawn as a conic gradient with an inner
  disc rather than a radial mask — Obsidian's CSS review rates `css-masks` as partially supported
  against its compatibility baseline, and a warning there is a product score. At 0% it is a hollow
  1.5px line circle.

### 11.2 Panel switch

`padding: 8px 12px 0`, with the view segments on the left and the transcript's own three controls on
the right.

A segment is 26px tall, `padding: 0 8px`, radius 4, with a 14px glyph. The active one wears the hover
wash at medium weight and **always says its word**; the others are glyphs with a `title`, so the rail
names where the reader is without naming everywhere they are not. `showPanelLabels` names the rest —
off by default, and a chat column under 380px stays a rail whatever the setting.

The transcript controls are first message, thread outline, latest message, at 26px. They were five
translucent circles at 16% opacity floating over the column: a control that hides from the reader and
then appears on top of what they are reading. Prev and next went with the float, because the outline
reaches any message in one press and names it.

### 11.3 Transcript

`flex: 1; padding: 16px 16px 8px; gap: 20px; line-height: 1.55`. It is inset one step further than
the chrome around it, because it is the thing being read.

- **User turn.** `padding: 10px 12px` on `--grimoire-plane` at radius 8. Ground says "this is
  yours" quietly enough to read the answer beside it; it was an accent wash inside an accent border,
  right-aligned at 86%, which spent the reader's own accent on the one thing in the transcript that
  needs no emphasis. Below it, right-aligned: a monospace 11px time, then 24px copy, rewind and fork.
  The controls hold their space at rest and change only colour and ground on hover, so revealing them
  never moves the text above.
- **Assistant turn.** `gap: 10px`. The meta line is monospace 11px faint — an 11px provider mark in
  ink, then `Claude Code · Opus 4.5 · high`. It is a caption, not a heading; it was uppercase,
  tracked and semibold, which is section-title weight on three words of provenance. Then the
  reasoning toggle: a 12px chevron and "Thought for 8s" in faint, muted on hover.
- **Tool steps.** A run of steps is drawn against **one hairline**, offset 6px so it sits under the
  centre of the provider mark on the line above. The rule is a pseudo-element rather than a border,
  so a step can extend it up through the gap when it follows another step — the run reads as one line
  without the renderer having to wrap the steps in a box, which it cannot do while they arrive one at
  a time from a stream. Each row is 26px: a 14px accent glyph, the name in ink at semibold, the
  argument in monospace 11px muted and truncated with an ellipsis, the result right-aligned in faint
  ("212 lines", "6 matches", "+7 −2"), then a 12px accent check at stroke 2.25.
- **Diff.** Inline, on `--grimoire-code`, radius 4, `padding: 8px 10px`, monospace 11px at 1.6. The
  **sign carries the colour** and nothing else does: `−` in `--grimoire-error` with the line struck
  through and receding, `+` in `--grimoire-ok` with the line in ink. A long line truncates and never
  wraps — a wrapped diff line stops being a line, which is the only thing a diff is made of.
- **Prose.** `gap: 8px`, `text-wrap: pretty`. Footer meta: a monospace 11px duration with an 11px
  clock, then 24px copy and retry.

### 11.4 Composer

Outer `padding: 8px 12px 12px`. The card is one 1px line at radius 12, and focus moves that line to
`--grimoire-line-3`. It used to answer focus with an accent border, an inset highlight and an outer
ring: three effects saying one thing about a box the cursor is already inside. There is no rule above
the toolbar, because a line inside a box that has one is a second box.

- **Textarea**: 3 rows, transparent, `padding: 10px 12px 4px`, 13px at 1.5, `dir="auto"`.
- **Toolbar**: `padding: 4px 6px 6px 8px`, `gap: 2px`. The model control (28px: a 12px provider mark,
  the name in ink at medium, a 12px chevron), the effort control (a 14px gauge and four 3px dots,
  filled to the level, the rest `--grimoire-line-3`), a spacer, then 28px icon controls: attach
  context, MCP servers (a 5px accent dot when any is enabled), permissions, plan mode (pressed = an
  accent glyph on a 12% accent wash). Every one is transparent at rest and takes the hover wash on
  hover; they were sitting on a permanent raised surface, so eight controls read as pressed.
- **Send** is the one filled action: 28px, accent, `--grimoire-accent-contrast`, a 15px arrow at
  stroke 2.25. **While streaming the same square becomes Stop, in place.** Nothing to send is an
  inert square in `--grimoire-line`, not a dimmed accent.
- Under 380px the model's name gives way to its mark — the longest string in the toolbar and the one
  whose absence costs least. The breakpoint is a container query on the chat column, because the pane
  is what the reader resizes and the viewport is not.

### 11.5 History

A 480px popover hanging off the button that opened it, at `top: 44px; right: 8px`, radius 8,
`--grimoire-lift-1`. It was a sheet inset 13px on all four sides: looking for another conversation is
not a reason to lose sight of this one.

The cap was 352, and a cap is only doing work above the pane width where `calc(100% - 16px)` stops
being the smaller half of the `min()`. Below 368px the popover is sized by its pane and the number is
inert, which is the default right sidebar; above it the title's room froze at 317px, so a 1000px tab
scanned the same 55 characters a 400px one did. 480 gives the title about 70 characters, inside the
45-75 a reader scans; the full tab width this list carried before Nordic is what put it past that.

A 34px search row, then rows of 56px at radius 4 with a hover wash. The open conversation carries a
1.5px accent leading rule. A row is two lines: the title has the first to itself, full width, and
truncates; the second carries the monospace 11px time and the model that answered, `14:02 | GPT-5.4`,
at one end and, on hover, an open-in-tab and a rename at 24px plus a "Delete" text control that turns
`--grimoire-error` at the other. The buttons occupy their space at rest, so revealing them shifts
nothing — including the title, which is what a single line could not deliver: floated over the stamp,
controls wider than
that stamp reached back across the title and sat on its last words. Group labels ("Today",
"Yesterday") are the uppercase monospace micro-label.

This is not the second line Nordic removed. That one carried provider, prompt preview, source count
and usage in mono under every title and turned a list you scan into a wall you read; this one carries
what the row already showed, moved off the title's line. It costs about a third of the rows in view.

**Two facts, not one or the other.** The stamp used to be a time for today's rows and the model's
name for everything older, because one slot cannot hold two things and the model is the one you scan
for: it is how you tell two conversations apart before you open either, and a tooltip answers none of
that — it cannot be read down a list, does not open on keyboard focus though the row is focusable,
and on touch does not exist. Substituting them cost both, and it showed: given a line of its own the
model appeared twice on every row that was not from today, once in each place. So the line says both,
divided by a typed `|` in the same faint ink — the time bounded at 160px and never shrinking, the
model taking the rest and clipping, because a label can arrive as a whole billing path. The rule is
a glyph rather than a border: it sits on the baseline with the two facts it separates, and it is
drawn by the model, so a conversation that never recorded one leaves no mark dangling after its time.

**Who named the conversation** is an 11px mark before the title, and only here: `sparkles` for a
title a model wrote, `pencil` for one the user typed. Both are `--grimoire-ink-muted` and carry the
word as an `aria-label` and a tooltip.

Two marks, not three. The mark answers "who named this", and for the placeholder cut from the first
message the answer is nobody — so its absence is the answer, and the row already draws the
regenerate control on exactly those rows. A third glyph standing for "no one" read as neither, and
it indented the one kind of row that has least to say.

The shape is the meaning and the colour is none, for the reason §3.9 gives and for a second one this
mark found: the first draft told the sources apart by hue — muted, `--grimoire-ok`,
`--grimoire-accent-text` — and in a vault whose accent is green two of them are the same colour.
Nowhere else draws it: not the tab badge, which shows a number rather than a name; not the tab
context menu; not the rename dialog, whose input holds the title itself and would save a prefix as
part of the name. The tab's `aria-label` is the one other place the provenance is said at all, and
it says the placeholder in words — a string has no DOM to colour, and its reader cannot see one.

While a title is being generated the row shows a turning `loader-2` where its controls are. The
glyph turns and the control around it does not: animating the element spun its rounded ground too,
which reads as a tilting square rather than an arc going round. It wears the action button's class
for its size and its place in the row and is not one — nothing happens when it is pressed, so
nothing lights up when it is pointed at.

**What the drawing shows.** [`Grimoire Nordic.html`](design/Grimoire%20Nordic.html) draws all of the
above on screen `1b`: the popover at 480, a 34px search row, rows of 56px on two lines, the mark
before the title, and stamps that say both facts. Five rows carry the five states worth drawing — the
open conversation with its accent rule, a hovered row with its controls beside the stamp rather than
over the title, a title still generating with the turning glyph where those controls go, a row open in
another tab at the 40% rule, and a model label long enough to clip while the title does not. The
"Delete all" control sits under the list, where the surface puts it.

### 11.6 Decisions — one shape for every ask

Three surfaces ask: a plan to approve, a question to answer, a permission to grant. All three wear
one shape:

> **a glyph · what is being decided · the material it acts on · numbered choices**

The card is a 1px line at radius 8 on `--grimoire-ground`, `padding: 14px`, with **no shadow** — a
decision is part of the thread, not a modal over it. The glyph is a 16px accent glyph, not a tile.
The tool's name is provenance in monospace 10px, not a pill.

A choice is a 32px row: the key that picks it in monospace 10px one column wide, then the words. The
chosen row is the hover wash with a 1.5px accent rule on its leading edge — the same mark the history
row and the thread outline use for "this one". Choices keep their words, always, and the keyboard map
sits under them in monospace 10px: `↑↓ navigate · ⏎ select · esc cancel`.

Only one action on the card is filled. Two filled buttons make neither of them the answer.

### 11.7 Context management

The one genuinely new surface. It lives in `src/features/chat/ui/context-manager/`, and its model —
`ContextItem`, the derived cost and the budget — is in `contextItems.ts` with the reasons written
beside each rule.

One list over the three places an attachment can come from — the open note, mentioned vault paths,
external files. Each had its own view before, and none could see the other two, so "what is attached,
and what does it cost" was a question the composer could not answer.

- **Composer.** One attached thing it draws as a chip, removable where it stands, with a dashed "Add"
  chip and a list control ending the row. The second collapses to one row: an accent file glyph,
  "**9 files**", a monospace "~18.4k · 34% of window", an add control and "Manage".

  The drawing collapses at the fifth and keeps a second row echoing the three most recent behind a
  "+6 more". Both were cut against a real sidebar. Four chips wrap to three lines at every width the
  plugin is actually used at, and the echo row is three names out of five with no remove on them —
  something to read and nothing to do — that wraps as badly as the chips it replaced. One chip always
  fits; past it a single line that never wraps says the count and the cost, and the names are in the
  dialog, which every state now reaches.
- **Over budget.** The card's border goes `--grimoire-error-line` and the summary becomes a warning
  row naming the overage. **Send stays enabled** — the reader decides, and a file silently dropped is
  a turn that goes out about a file it does not have.
- **Manage dialog.** 640 × 560, focus-trapped, five bands: a 44px header, a 40px search band that
  filters what is attached and starts offering the vault when nothing matches, a 34px bulk bar on an
  8% accent wash, the grouped list (Vault, then External; insertion order inside a group and nothing
  re-sorted under the reader), and a 48px footer with the budget drawn as a 64 × 4px bar. "Remove
  all" asks once by becoming its own question rather than opening a second dialog over the first.

  **Those 640 are set on `.modal`, not on what it holds.** Obsidian's own `.modal` is 560px wide with
  16px of padding, so a 640px content box overflowed it by 112px and the host's `overflow: auto` cut
  the whole right column off: every row's token count, every row's remove cross, Add, and Done. The
  dialog whose one job is deciding what to keep could not remove a file.

  **It draws no close of its own.** The drawing puts a cross in the header, but the host already
  draws one over that corner, so the header carried a second one stacked under it. Hiding the host's
  meant knowing where and when the host builds it — through `.modal` it is not there, and at
  `onOpen` it does not exist yet. Drawing none needs neither answer; the header reserves
  `--grimoire-hit-l` at its end so the title clears the host's control, and Escape still closes.
- **Add picker.** 400px, radius 8. `⏎` adds and closes; `⇥` adds and keeps it open — which is why it
  is not a `SuggestModal`. The matched substring is underlined in the accent. A row for something
  already attached is highlighted, inert, and says "attached". Its footer offers the open note and
  the two native dialogs, asked for separately: Windows and Linux cannot show one that returns
  either a file or a folder, and Electron answers a request for both with the folder picker.

  Opened from the composer it rises above the row; opened from the manage dialog it drops out of that
  dialog's search band, and is mounted **inside** the dialog. A modal is its own stacking context, so
  a panel drawn in the composer while the dialog is open lands behind it at any `z-index`, and the
  control that opened it reads as a button that does nothing.
- **Costs are estimates and say so.** No provider exposes a tokeniser Grimoire can call before the
  turn is sent, so this reads `stat.size` and divides by four; every surface labels it "est.". An
  unknown cost is an em dash — zero would be a claim that the file is free.
- **Nothing is silently dropped.** A file that moved keeps its row and its reason until the reader
  removes it. A folder is expanded to its files at attach time rather than kept as a row nothing
  downstream could send.

### 11.8 Settings

Obsidian's declarative settings API, rendering native `.setting-item` rows. Grimoire styles the
content it puts *inside* a row — never `.setting-item`, `.setting-item-info`, `.setting-item-name`,
`.setting-item-control` or their spacing. A settings tab that looks native is the goal, not a
constraint worked around. The gate refuses any `.setting-item` selector not scoped under a
`.grimoire-` class.

---

## 12 · Responsive

520px is the reference width — a typical Obsidian right sidebar — and every surface must survive
320–900px.

The breakpoint container is the chat column (`container-name: grimoire-chat`), not the viewport,
because the pane is what the reader resizes.

- Below ~380px: the composer toolbar drops the model's name to its glyph, and the panel switch stays
  a rail of icons whatever `showPanelLabels` says.
- Chips truncate at ~18ch, **through the middle and never through the extension** — the extension is
  what says what the thing is, and a tail truncation eats it first.
- The manage dialog goes full-width with its columns collapsing to name, size and remove.
- Above ~700px nothing grows except the transcript's measure, capped at ~72ch.

Wide content — tables, diagrams, code blocks — scrolls inside its own container. The chat column
never scrolls horizontally.

---

## 13 · Accessibility

- **4.5:1 minimum for text.** That is why status is a dot *plus a word*, never colour alone.
- Every icon button carries an `aria-label`; toggles carry `aria-pressed`; the manage dialog is a
  real focus-trapped `role="dialog"`; list rows expose `aria-selected` and their checkbox
  `aria-checked`.
- Focus is a visible ring, and every interactive element is reachable by keyboard in visual order.
- Streaming keeps the transcript's scroll position unless the reader is already at the bottom, in
  which case it follows. It never scrolls the note editor.
- A failure names its cause in one line — "String not found", "unreadable — needs a text layer",
  "missing — moved or deleted" — and offers exactly one recovery.
- `prefers-reduced-motion` collapses every animation and transition to ~0.

---

## 14 · Gates

The system is enforced, not documented. Extend the gates when you extend the system, and **prove a
new rule by breaking it**: copy the file to the scratchpad in the same command that injects the
defect, watch the gate fail, then restore from the copy — never `git checkout`, which discards the
uncommitted work the rule is about.

`tests/unit/style/designSystem.test.ts`

1. every Grimoire token a stylesheet reads without a fallback is defined, or is one of the twelve a
   controller sets per element;
2. sizes, weights and radii are steps in the scale;
3. colour comes from the theme — no `rgba(<digits>` and no hex anywhere, including the token layer;
4. provider identity is a glyph — no `--grimoire-provider-*`, no `[data-provider=…]` rule;
5. spacing below 32px is a token;
6. motion is one duration on one curve;
7. `.setting-item` is never selected without a `.grimoire-` scope;
8. no module sheet reads an Obsidian variable, `--setting-items-*` excepted;
9. the accent is read in one place.

`tests/unit/style/themeAdaptation.test.ts` resolves the whole layer against Obsidian's own variables
— the transitive closure taken from the root tables of the real `app.css` — and holds that every
token resolves on both themes, that the two themes are drawn from different ground, that changing
`--accent-h` moves every accent-derived token, that nothing is pinned to a literal, and that each type
step lands where the literal it replaced stood.

Two things that rule learnt about itself, both by being broken on purpose:

- **Selecting the accent tokens by what they are made of was a hole.** A token pinned to a literal
  stops referencing the accent, so the filter dropped it from the list exactly when it broke.
  Selection is by name now, with the one token that must not move
  (`--grimoire-accent-contrast`, Obsidian's `--text-on-accent`) excluded by name and with its reason.
- **A fallback hides a missing dependency**, so the dependency rule reads the token layer's text
  rather than its resolution.

`tests/unit/style/decisionCardCss.test.ts` holds the one shape of §11.6 across both decision sheets.

`npm run review:css` holds Obsidian's community review baseline: no `!important`, and no feature on
the partial-support denylist in `scripts/reviewCss.js`. Review scores CSS against a compatibility
baseline (historically Electron / app 1.11.4), not only against `minAppVersion` — "we require 1.13+"
is not an answer.

---

## 15 · What adopting it found

Recorded because each one is a class, not an instance.

- **Three declarations read `--grimoire-workbench-ghost`, and nothing defined it.** An undefined
  custom property does not fall back — it inherits — so the panel section count and two history
  surfaces rendered in their parent's colour, silently. This is why the token gate checks resolution
  rather than spelling.
- **The plugin was partly hardcoded to dark themes.** Scrollbars at `rgba(255, 255, 255, 0.14)`,
  hover states as white washes, a menu at `rgba(31, 30, 36, 0.985)`, an image backdrop at
  `rgba(0, 0, 0, 0.85)`, and panels tinted by mixing toward `#000`. All read as intended on a dark
  theme and as damage on a light one.
- **The accent was not the reader's on thirty-two surfaces.** `--grimoire-brand-rgb` read
  `var(--interactive-accent-rgb, var(--color-accent-rgb, 127, 95, 217))`, and Obsidian defines
  neither triple, so every one resolved to a fixed violet. The fallback is what hid it: the value
  looked considered and was frozen.
- **476 declarations across 40 sheets read Obsidian directly**, so the system's founding rule was a
  claim the stylesheets could not honour.
- **The tab menu had one way in and it was a right-click**, which a keyboard cannot perform.
- **Stop appeared only once a subagent was seen working**, beside a Send that stayed enabled — so an
  ordinary turn could not be stopped from the composer at all, and a subagent turn had two primary
  actions where the design allows one.
- **Attachments were counted by two chip rows that never agreed**, because the open note, mentioned
  paths and external files each had their own view.

Scale, before and after: 15 font sizes to a 6-step ladder that scales with the reader's own setting;
13 font weights to 4; 12 radii to 3 plus two shapes; 16 interaction durations to 1; 123 shadows to a
3-step lift where the default is nothing; 8 animations to 2; 9 fixed brand colours to none.

---

## 16 · Looking at it

Obsidian cannot be screenshotted from a terminal, and a CSS claim that is only read is a CSS claim
that is only guessed. Both halves of the comparison can be rendered.

**The mock**: open [`docs/design/Grimoire Nordic.html`](design/Grimoire%20Nordic.html) in a browser,
or screenshot one screen of it headlessly.

**The plugin**: write an HTML file with two `<style>` blocks — Obsidian's own `app.css` first, the
built root `styles.css` second — put the plugin's markup under `.grimoire-container--chat-window` on
a `body.theme-dark`, and

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=560,340 --screenshot=shot.png "file://…/harness.html"
```

For measurements rather than pixels, append a `<script>` that writes `getComputedStyle` results into
a `data-probe` attribute on `body` and read it back with `--dump-dom`.

**Include `app.css`, not just the theme fixture.** A harness carrying only
`tests/fixtures/obsidian/theme-tokens.json` shows the plugin as it would look if the host had no
rules of its own, and the host's rules are what break it: `button:not(.clickable-icon)` and
`input[type='text']` are element-plus-class weight, so a rule named only `.grimoire-primary-action`
never wins. Every filled action in the plugin resolved to `rgb(51,51,51)` and every field to
Obsidian's form-field chrome until the rules named the element too. Take `app.css` from the `.asar`
the way `scripts/generate-theme-tokens.mjs` does.

This is also how the stray `}` in `tabs.css` was found: it made Chrome discard
`.grimoire-panel-switch` entirely, and no gate, build or test saw it — only the render did. And the
manage dialog's missing right-hand column: the harness reported `.modal` at 560 and its content at
640 before anything was changed, which is the whole diagnosis in two numbers.

### Naming the element is not the end of it

Three more ways the host outranks a rule that looks right, each found in a render rather than in a
reading:

- **A modifier of an element-named base must name the element too.** `button.grimoire-icon-btn`
  counts an element and a class, so `.grimoire-icon-btn--small` never reached its own width and
  height and every small icon button drew at the large size. `designSystem.test.ts` now fails any
  `.x--m` that sets a property an `element.x` rule also sets.
- **A field's focus ring is the host's, at `input[type='text']:focus-visible`** — element, attribute
  and pseudo-class. `box-shadow: none` on `input.grimoire-…` is overruled the moment the field takes
  focus, which for a panel that focuses its field as it opens is permanent chrome. Answer it with a
  `:focus` and `:focus-visible` rule of the same weight, and let focus read on the glyph instead: a
  glyph in the accent is inside the budget, a 2px box around a band drawn flat is not.
- **A modal is sized on `.modal`.** Sizing `.modal-content` leaves the host's width and padding in
  place underneath, and the host clips what overflows.

The shape of all four is one thing: the host names elements and attributes, Grimoire names classes,
and a class alone loses. The gates cannot see a property the plugin never wrote — a missing `:focus`
rule is not a violation of anything — so the render stays the check that finds these.

### A specimen you can move

The system also renders itself at
<https://claude.ai/code/artifact/4856c3ff-b400-49c8-afcf-57ff24ab7e32> — every plate on that page is
built out of these tokens, and the strip at the top writes `--accent-h/s/l` and the theme exactly the
way Obsidian's Appearance pane does. Nothing on it names a colour, so moving the accent moves the
whole page.
