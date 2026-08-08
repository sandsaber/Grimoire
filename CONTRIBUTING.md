# Contributing to Grimoire

Thanks for helping improve Grimoire. This guide describes the architecture,
security, testing, and review expectations that apply to contributions.

## Before You Start

- Search existing issues and pull requests before opening a new change.
- Open or reference an issue for behavior changes, bug fixes, and provider work.
- Discuss broad architecture changes before implementing them, especially changes
  that affect multiple providers, permission handling, storage, or release behavior.
- Keep each pull request focused on one coherent problem. Separate follow-up work
  when it has a different root cause or acceptance criteria.

## Development Setup

Grimoire is an Obsidian desktop plugin. Development and CI require npm 12.0.2
with Node.js 22.22.2 through 22.x, Node.js 24.15.0 through 24.x, or Node.js
26.0.0 or newer.

```bash
npm ci
npm run dev
```

Useful verification commands:

```bash
npm run test
npm run typecheck
npm run lint
npm run build:release
```

Set `OBSIDIAN_VAULT` in `.env.local` if you want builds copied into a local test
vault. Do not commit local vault paths, credentials, transcripts, or debug artifacts.

## Architecture

The plugin shell is provider-neutral. Provider adapters wrap external tools such as
Claude Code, Codex, OpenCode, MiMoCode, Kimi Code, Qwen Code, Antigravity CLI, and Grok Build.

- Put shared runtime, provider, security, storage, and tool contracts in `src/core/`
  only when at least two providers use the behavior.
- Keep protocol handling, CLI resolution, launch artifacts, mode and model
  normalization, storage, history parsing, and provider settings in
  `src/providers/<provider>/`.
- Register provider runtimes and services through `ProviderRegistry` and
  `ProviderWorkspaceRegistry`.
- Feature code under `src/features/` must consume provider-neutral contracts. It
  must not interpret provider-native identifiers or read provider-specific
  `Conversation.providerState` fields.
- Preserve native provider behavior when possible. Adapt documented or observed
  runtime semantics instead of reimplementing provider features in shared UI code.
- OpenCode and MiMoCode intentionally mirror each other closely. Check both when
  changing their shared launch, ACP, storage, history, settings, or UI behavior.

Read the nearest `AGENTS.md` before changing provider-specific or path-specific
code. These files contain durable implementation constraints for their directories.

## UI And Product Design

Grimoire UI changes must preserve the product hierarchy across realistic Obsidian
pane sizes. Compactness is useful only when controls remain identifiable and the
primary task stays clear.

- Treat a named design handoff as the source of truth. When no handoff exists,
  extend established Grimoire components, spacing, typography, and Obsidian theme
  tokens instead of introducing a parallel visual language.
- Design responsive states deliberately. Wrap semantic groups into a stable
  narrow layout rather than allowing flex shrink to collapse labels, isolate a
  primary action on an otherwise empty row, or reorder controls accidentally.
- Never reduce an information-bearing control to an unexplained icon or color dot.
  When truncation is unavoidable, keep the distinguishing part visible and expose
  the complete value through an accessible label and tooltip.
- Test dynamic content with long model names, provider namespaces, file paths,
  localized strings, attachments, usage indicators, and multiple simultaneous
  toolbar controls. Content must not overlap, clip adjacent content, or become
  indistinguishable.
- Keep persistent actions such as Send visible and visually associated with their
  supporting controls at every supported width. Prefer container-aware layout
  rules because an Obsidian pane can be narrow inside a wide application window.
- Use Obsidian and Grimoire design tokens for colors and surfaces. Provider marks
  must use the resolved provider's brand token and remain correct across default,
  hover, selected, and open states.
- Preserve keyboard access, focus treatment, Escape and outside-click behavior,
  semantic labels, and cleanup of document-level listeners when components are
  destroyed.

When a pull request changes the UI, include current screenshots of the changed
states in the PR description. Prefer a before-and-after comparison and include a
narrow-pane screenshot when responsive behavior is affected.

For meaningful UI changes, verify at least one wide and two narrow pane widths.
Exercise the longest realistic labels and relevant open, selected, attachment,
loading, and empty states. Build success and CSS string tests do not replace
visual verification inside Obsidian.

## Security And Permission Modes

Provider responses, model output, session notifications, tool arguments, paths, and
external configuration are untrusted inputs.

- Never turn provider-observed state into a broader persistent permission without
  an explicit, attributable user action.
- Keep effective session state separate from the user's saved authorization when
  the values can diverge.
- Safe and Plan modes must not silently gain Auto-approve authority.
- Validate paths at the final filesystem boundary. Do not weaken workspace
  containment based on untrusted session state.
- Fall back between protocol methods only for the documented unsupported-method
  error. Re-throw transport, validation, authentication, and policy failures.
- Do not log secrets, environment values, prompts, note contents, or unsanitized
  provider payloads. Production code must not use `console.*`.
- Add regression coverage for both directions of every permission transition and
  for delayed, stale, mismatched-session, create, load, and reconnect events.

If a change affects authorization, filesystem scope, commands, credentials, MCP,
provider process launch, or external paths, explain the trust boundary and failure
mode in the pull request.

## Tests

Tests mirror `src/` under `tests/unit/` and `tests/integration/`.

- Add a focused regression test for every behavior change or bug fix.
- Test the real protocol shape, including structured error classes and codes. Avoid
  replacing protocol evidence with a generic `Error` carrying similar text.
- Inspect real provider runtime output before adding or changing normalization.
- Run the narrowest relevant tests while iterating, then run the complete gate before
  requesting review for meaningful provider or UI changes:

```bash
npm run test -- --selectProjects unit
npm run typecheck
npm run lint
npm run build:release
```

State which commands were run and report any environment limitation. Do not claim
manual verification unless the behavior was exercised in Obsidian with the relevant
provider.

## Obsidian Community Review Gates

Obsidian community plugin review scores CSS, source, and dependency graphs and
affects how the plugin is rated. Local release checks mirror the durable parts of
that process:

| Gate | Command | Catches |
|------|---------|---------|
| Source | `npm run review:source` | Type-aware ESLint: no-deprecated, no-explicit-any, no-unsafe-* |
| CSS | `npm run review:css` | `!important` and CSS features only partially supported by Obsidian's review baseline |
| Dependencies | `npm run review:deps` | Known advisory floors in the lockfile |

`npm run build:release` runs all three via `prebuild:release`.

### Source / unsafe typing

Local `review:source` already fails the build on `@typescript-eslint/no-unsafe-assignment`
(and call/return/member/argument) plus `no-explicit-any`. Keep that gate green.

Obsidian’s hosted scanner can still report large `no-unsafe-assignment` lists when
its TypeScript/`obsidian` type resolution differs from ours. Treat that as a
scoring signal, not as “local lint is off.” When their report names specific
files:

1. Prefer type guards and `unknown` over `as` casts.
2. For storage/MCP/context/path helpers, also keep
   `@typescript-eslint/no-unsafe-type-assertion` green (enforced for those paths).
3. Expand path coverage wave-by-wave rather than one giant diff.

### CSS

CSS review is stricter than “works in current Obsidian.” The community lint
baseline is historically Electron / app **1.11.4**, while Grimoire's
`minAppVersion` may be newer. Do not use `display: contents` (flagged as
`css-display-contents`); prefer real layout boxes. When Obsidian reports a new
partial-support CSS warning, fix the stylesheet, add the feature to
`OBSIDIAN_PARTIAL_CSS_FEATURES` in `scripts/reviewCss.js`, and cover it with a
unit test. Full style conventions live in `src/style/AGENTS.md`.

Document unavoidable dependency review findings in `DISCLOSURES.md` rather than
leaving them unexplained.

## Generated Artifacts And Dependencies

`npm run build:release` refreshes generated `main.js`, root `styles.css`, and
`dist/grimoire`. The root bundle files and `dist/grimoire` are build outputs: do
not commit them. Verify the release bundle from source before tagging, and publish
the three files from `dist/grimoire` as GitHub Release assets.

npm is the canonical package manager. Keep `package-lock.json` synchronized with
`package.json`, and do not add another lockfile unless the repository intentionally
changes its package-management and CI workflow.

`.npmrc` controls npm resolution: it delays newly published packages by seven
days (`min-release-age=7`) and only runs install scripts from the exact
`allowScripts` entries in `package.json`. The `check:lockfile-age` gate validates
the committed lockfile versions against npm publication timestamps before CI
installs dependencies. Review every requested script approval, add or update only
the exact resolved `package@version` after confirming why it is needed, and remove
approvals that are no longer required. Explicit `false` entries document install
scripts that must remain disabled.

`lockfile-age-exceptions.json` is a temporary transition policy for already-audited
locked versions. Each entry must name one exact package and version, explain the
exception, and expire no later than that version's normal release-age eligibility
time. The validator still fetches and validates the registry publication timestamp,
tarball origin, and integrity; exceptions cannot cover new versions or bypass those
checks. Remove entries once their versions become eligible.

Do not commit temporary handoff material, local transcripts, provider credentials,
test vault contents, `.env.local`, or unrelated generated files.

## Pull Requests

A reviewable pull request should:

- explain the user-visible problem and the root cause;
- describe why the change belongs in the chosen shared or provider-owned layer;
- link the relevant issue with `Fixes #<issue>` when appropriate;
- list automated tests and truthful manual verification;
- call out permission, filesystem, process, credential, storage, and compatibility
  effects;
- include source changes and verification evidence from the same release build;
- avoid unrelated cleanup or refactoring;
- preserve attribution when incorporating another contributor's work, using a
  `Co-authored-by` trailer when appropriate.

Use the repository pull request template and keep its architecture and security
sections substantive. A passing test suite does not replace reasoning about trust
boundaries or provider-native behavior.

## Releases

Version changes must update `package.json`, `package-lock.json`, `manifest.json`,
`versions.json`, and `CHANGELOG.md` together. Release tags must exactly match the
manifest version and must not have a leading `v`.

Maintainers run the release workflow and final production dependency audit. Regular
bug-fix pull requests should not bump the plugin version unless requested.
