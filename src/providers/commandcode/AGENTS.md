# Command Code Provider

Command Code uses `command-code --print --output-format json`, not ACP. Verified CLI versions are 1.53.0 (2026-09-13) and 1.66.0 (2026-09-26).

- Keep native authentication, configuration, skills, MCP and transcripts CLI-owned.
- Send prompts through stdin. Resume only the explicit native session ID; never use `--continue`, which can select another tab's session.
- Only the final `type: result` frame and confirmed process exit settle a run. `run_end` contains the full native transcript and must never be forwarded or logged.
- Safe approvals are Grimoire-owned: a per-run private IPC server, native before-tool mod, and Node launcher guard installed before importing the CLI. The guard refuses run startup without registration and refuses tool execution without a one-time hook permit. This depends on verified 1.53.0 and 1.66.0 event ordering; unknown versions fail before launch, never fall back to unguarded `--yolo`.
- Both modes lift the print gate with `--yolo`; only Auto runs without the Grimoire guard. Keep native deny and ask rules. Safe denies native subagents because their separate loops do not inherit the mod hooks. Failures, disconnects and cancellation deny pending approvals; late answers cannot allow execution.
- Keep tool input in memory, never in control records. Project `tool_hook_blocked` and `tool_denied` as failed results so cards settle. Questions remain unsupported.
- Keep model IDs opaque and discover them with `--list-models`. Do not infer context windows, prices or account quotas.
- Use the execution kernel and owned process-tree termination, including on cancellation and unload.

Reasoning levels come from the CLI validation probe for the exact selected model, never model-name heuristics. Invalid effort plus empty stdin exits before inference or config writes. A valid `--effort` writes global CLI config in 1.53.0, so actual turns use a disposable native session mod calling `cmd.setEffort`. Keep effort in the turn snapshot and verify the reported `model_request_end.effort`. CLI default leaves native resumed-session effort intact.
