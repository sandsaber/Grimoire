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
| `acpSessionResume.ts` | Whether a failed `session/load` means the session is gone |

On failed `session/load`, the kernel path soft-fails: `ManagedAcpExecutionBackend`
asks `isAcpSessionGone`, drops the binding for a session the agent no longer has,
and opens a fresh one in the same dispatch. Do **not** show a user-facing
`Notice` for resume failure — the recovery is automatic and the toast only
scares users. The conversation is told through the `sessionDropped` port, which
draws the session-restart seam above the thread.
| `acpApprovals.ts` | permission decision mapping |
| `execution/AcpWorkspaceFileSystem.ts` | the vault an agent reads and writes through: containment, the line window, the write approval |

A read of a file that is not there answers `-32002 Resource not found: <path>`, the protocol's own
code, and every other failure keeps the internal error — so a missing file and a path the workspace
refused are different answers on the wire. Agents ask this before creating a file, and Gemini CLI's
own client tests the message for exactly that sentence.

Provider runtimes should call these helpers instead of re-copying load/create/retry trees.

The load/create phase plan, the transport-close retry gates and `ensureReadyForQuery` are **not**
here any more: `ManagedAcpExecutionBackend` owns all three on the kernel path — `ensureClient`,
`ensureSessionBinding`, and the single-attempt retry in `recover` — and the helper module they used
to live in went with the legacy runtimes that called it.
