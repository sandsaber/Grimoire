# Antigravity Provider Agent Instructions

`src/providers/antigravity/` adapts Google Antigravity CLI, Google's official Gemini CLI replacement, through its non-interactive `agy --print` command.

## Current Scope

- Antigravity is opt-in and disabled by default.
- Chat execution runs through the execution kernel: `AntigravityExecutionBackend` over `agy --print`, presented by `ExecutionChatRuntimeAdapter`. `AntigravityExecution` in `src/providers/antigravity/execution/` composes the two and owns the request store they share. Single-turn print requests, cancellation, and model selection through `agy --model`.
- `agy --print` does not expose Grimoire file-edit approval hooks. Keep shared `normal` permission mode fail-closed for Antigravity; only launch AGY in explicit auto-approve/full-access mode unless a real approval-capable runtime is confirmed.
- Read the permission mode from the provider's own projection, not from top-level `settings.permissionMode`. That key holds whichever provider the settings tab is showing, so reading it means obeying another provider's toggle — observed as Antigravity refusing every turn while its own toggle read Auto-approve.
- The CLI is launched through the user's login shell so profile environment applies, and the argument-forwarding expression is shell-specific: fish has no `$0` or `$@`. An unknown shell launches directly rather than guessing its syntax.
- Model discovery comes from `agy models` and is stored in provider settings for the UI.
- On Windows, observed `agy` 1.0.10 can return exit code 0 with empty stdout for both `agy models` and `agy --print` even when the request succeeds. Preserve the Windows fallback paths that recover print output from Antigravity transcripts and model options from Antigravity settings plus the seeded Pro AI model list. The Windows build also prints `--help` only to stderr (stdout stays empty, measured on the 2026-08-20 build), so the capability probe must keep collecting both streams.
- `agy` can emit `status:"ERROR"` for CLI-internal tool-permission bookkeeping (for example `write_to_file` into a workspace subdirectory or `view_file` on a missing path) after the agent has already streamed a complete answer. A non-empty `result.response` therefore resolves the turn — the CLI complaint is appended as a trailing note — and only an ERROR result without an answer is a hard failure.
- An `agy` tool call is drawn by `AntigravityContentPresenter`, which is this provider's whole content vocabulary: a call starting and the same call ending, bracketed by one `step_index`. Everything else it says is the answer, which travels on the transient output channel as it arrives. `antigravityToolNormalization` maps `agy`'s tool names and PascalCase argument keys onto the neutral ones the shared renderer keys its icon, header and diff off — and keeps the native key beside the neutral one, because `agy`'s own argument names are what its transcripts show.
- Antigravity settings expose custom model labels so users can add account-specific models when Windows model discovery is incomplete.
- The AGY slash menu lists read-only vault skills from `.claude/skills` and `.agents/skills` through `VaultSkillCommandCatalog` (content-only SKILL.md files allowed). Because `agy --print` has no slash surface, `expandAntigravityVaultSkillInvocation` (`AntigravityVaultSkills`) expands a leading `/skill-name` invocation before the CLI is launched, called from the execution composition's request resolver — the one place that already reads ambient state at dispatch, and the only one that may read the vault asynchronously. It takes the skill source as an argument rather than reaching for a catalog, and a vault it cannot list sends the prompt as the person typed it. Keep menu filtering and the expansion grammar in sync.
- Antigravity CLI 1.0.7 does not expose Gemini CLI's `--acp` flag; do not route it through `src/providers/acp/` unless a real ACP-compatible runtime is confirmed.
- On Windows, resolved `.exe` commands launch directly; `.cmd`/`.bat` launchers and bare command names go through an explicit `cmd.exe /d /s /c` invocation with per-argument quoting in `AntigravityProcessLaunch` — never Node's `shell: true`, which concatenates the command line without quoting arguments (#59).
- Grimoire probes `agy --help` once per CLI command for capability flags (`--add-dir` from #67, `--input-format`/`--output-format` stream-json from #69, `--print-timeout` from #70) via `AntigravityCliCapabilities` and prepends `--add-dir <vault>` to the print run when advertised, so the agent workspace includes the vault root without wrapper scripts (#67). Conclusive help output — including the Windows empty-help quirk — is cached per CLI command; cancelled, timed-out, or errored probes fail closed for the current turn and are retried on the next turn instead of being cached.
- Print runs are bounded by two timers: a 10-minute inactivity timer refreshed by stdout/stderr chunks and by `--log-file` growth (agy emits stream frames only on step transitions, so one long tool call can legitimately stay pipe-silent for minutes while it keeps logging), and a 30-minute absolute ceiling. When the CLI advertises `--print-timeout`, Grimoire passes `29m` so agy self-terminates with a structured result frame just before the absolute ceiling kills the process (#70). The `--log-file` is unlinked only after a successful run; failures preserve it for diagnosis because it is the only place agy records the real wall-clock cause.
- Image attachments have no CLI flag and no content-block channel: `agy --help` exposes nothing for images and the stream-json `user` event carries `content` as a plain string. `AntigravityImageAttachments` therefore writes each attachment into a fresh `os.tmpdir()` directory and appends the absolute paths to the prompt. Measured 2026-09-03 against agy on Windows: the agent opens such a path even when the file lives outside the workspace and no `--add-dir` is passed, so do not couple attachments to the `--add-dir` probe. The temp directory holds user data and is removed on every exit — success, failure and cancel — unlike `--log-file`, which is deliberately kept on failure. An attachment therefore lives for exactly one turn: the files are gone when the turn ends and print-mode history is text-only, so a follow-up question cannot reach the image and the user has to attach it again. An attachment that cannot be written is reported to the user as a `notice` chunk naming it, not only through the debug log, which is off by default.
- Auxiliary workflows such as title generation, instruction refinement, and inline edit are unsupported until an Antigravity auxiliary runner exists.

## Boundaries

- Keep Antigravity-specific runtime behavior in `src/providers/antigravity/`.
- Treat Antigravity as a best-effort Google compatibility provider, not a recommended default provider, until `agy` exposes a stronger Grimoire-compatible runtime surface. `src/providers/gemini/` may coexist only as a legacy Gemini CLI compatibility provider for tiers Google still supports.
- Do not assume Antigravity is Gemini-only. Its model catalog may include Gemini, Claude, GPT-OSS, and other model families.
- Prefer live CLI output over guessed schemas when expanding support.

## Launch

`AntigravityPrintProcessRunner` launches one request at a time, and the capabilities that shape the launch are probed in the execution composition's resolver — the runner returns its handle synchronously and a probe is a process. When the CLI advertises stream-json support, the prompt travels over stdin as one NDJSON user event (`AntigravityStreamJson`), stdout is parsed line-by-line for the final `{"event":"result"}` frame, and the transcript never touches argv — Windows `CreateProcess` rejects command lines longer than ~32767 characters, which a growing conversation used to hit as `spawn ENAMETOOLONG` (#69):

```bash
agy --input-format stream-json --output-format stream-json
stdin: {"event":"user","message":{"role":"user","content":"<prompt>"}}\n
```

Older CLIs without `--input-format` keep the legacy argv transport:

```bash
agy --print "<prompt>"
```

Custom CLI paths are stored per host under `providerConfigs.antigravity.cliPathsByHost`. If no custom path exists, Grimoire auto-detects `agy` from PATH and falls back to launching `agy`.
