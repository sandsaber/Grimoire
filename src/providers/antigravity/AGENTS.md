# Antigravity Provider Agent Instructions

`src/providers/antigravity/` adapts Google Antigravity CLI, Google's official Gemini CLI replacement, through its non-interactive `agy --print` command.

## Current Scope

- Antigravity is opt-in and disabled by default.
- Chat execution runs through the execution kernel: `AntigravityExecutionBackend` over `agy --print`, presented by `ExecutionChatRuntimeAdapter`. `AntigravityExecution` in `src/app/execution/antigravity/` composes the two and owns the request store they share. Single-turn print requests, cancellation, and model selection through `agy --model`.
- `agy --print` does not expose Grimoire file-edit approval hooks. Keep shared `normal` permission mode fail-closed for Antigravity; only launch AGY in explicit auto-approve/full-access mode unless a real approval-capable runtime is confirmed.
- Read the permission mode from the provider's own projection, not from top-level `settings.permissionMode`. That key holds whichever provider the settings tab is showing, so reading it means obeying another provider's toggle — observed as Antigravity refusing every turn while its own toggle read Auto-approve.
- The CLI is launched through the user's login shell so profile environment applies, and the argument-forwarding expression is shell-specific: fish has no `$0` or `$@`. An unknown shell launches directly rather than guessing its syntax.
- Model discovery comes from `agy models` and is stored in provider settings for the UI.
- On Windows, observed `agy` 1.0.10 can return exit code 0 with empty stdout for both `agy models` and `agy --print` even when the request succeeds. Preserve the Windows fallback paths that recover print output from Antigravity transcripts and model options from Antigravity settings plus the seeded Pro AI model list.
- Antigravity settings expose custom model labels so users can add account-specific models when Windows model discovery is incomplete.
- Antigravity CLI 1.0.7 does not expose Gemini CLI's `--acp` flag; do not route it through `src/providers/acp/` unless a real ACP-compatible runtime is confirmed.
- Auxiliary workflows such as title generation, instruction refinement, and inline edit are unsupported until an Antigravity auxiliary runner exists.

## Boundaries

- Keep Antigravity-specific runtime behavior in `src/providers/antigravity/`.
- Treat Antigravity as a best-effort Google compatibility provider, not a recommended default provider, until `agy` exposes a stronger Grimoire-compatible runtime surface. `src/providers/gemini/` may coexist only as a legacy Gemini CLI compatibility provider for tiers Google still supports.
- Do not assume Antigravity is Gemini-only. Its model catalog may include Gemini, Claude, GPT-OSS, and other model families.
- Prefer live CLI output over guessed schemas when expanding support.

## Launch

The runtime launches one request at a time:

```bash
agy --print "<prompt>"
```

Custom CLI paths are stored per host under `providerConfigs.antigravity.cliPathsByHost`. If no custom path exists, Grimoire auto-detects `agy` from PATH and falls back to launching `agy`.
