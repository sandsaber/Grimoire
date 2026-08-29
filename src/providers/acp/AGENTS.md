# ACP Provider Agent Instructions

`src/providers/acp/` contains protocol-generic ACP transport, subprocess, session config, session update normalization, usage conversion, and tool stream helpers.

## Rules

- Keep this directory provider-generic. OpenCode and future ACP providers can depend on it; it must not depend on provider-specific settings.
- Normalize ACP events into shared provider-neutral shapes only when the mapping is stable across ACP providers.
- Keep provider-specific model/mode discovery, settings UI, launch paths, and history ownership under the concrete provider directory.
- Prefer current wire traces over guessed method or event shapes when extending ACP support.
- Grimoire-managed ACP MCP configuration is stored per provider under `.grimoire/mcp/` and converted only at the session boundary. Keep native CLI configuration untouched.
- ACP session configuration does not currently provide Grimoire's context-saving or per-tool filtering semantics; do not expose those controls for ACP-managed servers.

## Managed session helpers

Shared building blocks for OpenCode-family / Grok-style managed CLIs (incremental base — not a full abstract runtime class yet):

| Module | Responsibility |
|--------|----------------|
| `acpSessionResume.ts` | Failed `session/load` wipe policy, persist fields, debug events |

On failed `session/load`, runtimes must soft-fail (invalidate live binding, keep
history / native store paths, create a new session on the next turn) and log via
debug helpers. Do **not** show a user-facing `Notice` for resume failure — the
recovery is automatic and the toast only scares users.
| `acpLifecycle.ts` | lifecycle generation + serialized cleanup promises |
| `acpApprovals.ts` | permission decision mapping + write-text approval |

Provider runtimes should call these helpers instead of re-copying load/create/retry trees.

The load/create phase plan, the transport-close retry gates and `ensureReadyForQuery` are **not**
here any more: `ManagedAcpExecutionBackend` owns all three on the kernel path — `ensureClient`,
`ensureSessionBinding`, and the single-attempt retry in `recover` — and the helper module they used
to live in went with the legacy runtimes that called it.
