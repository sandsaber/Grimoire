# OpenCode V2 compatibility

Grimoire keeps one OpenCode provider and detects the installed CLI version. OpenCode 1.x uses `opencode acp`. V2 uses the CLI's native HTTP API and event stream through an owned, authenticated loopback server.

V2 ACP can capture an incomplete agent catalog during startup and retain it for the session. This reproduces outside Grimoire: the native API initially returns only built-in agents, then exposes the managed agents after configuration discovery finishes. Sleeping before the first ACP session or upgrading from 2.0.15 to 2.0.16 does not reliably fix it. The V2 adapter waits for the required agents and enabled models before creating a session.

## Verified versions

The following checks were run on macOS arm64 on 2026-09-24. CLI binaries came from the official OpenCode distribution; temporary V2 archives were checked against their npm integrity hashes.

| Version | Grimoire transport | Verification |
| --- | --- | --- |
| 1.18.32 | ACP | Live streaming response, cold session resume, allowed write, denied write |
| 2.0.15 | Native API | Live streaming response, cold session resume, allowed write, denied write, native question and answer |
| 2.0.16 | Native API | Full live smoke matrix, including native questions, with isolated configuration, cache, state, and database paths |

The sanitized ACP mode replies that demonstrate the original issue are recorded in `tests/fixtures/provider-traces/opencode-mode-compatibility.json`. The live suite covers streaming, tools, context usage and selected-model identity, continuation, cold resume, replacement of missing sessions, permission allow/deny, model and command discovery, spend handling, cancellation, and native questions. The cold-resume check also verifies history hydration from native storage. A separate metadata-only check with the local user's normal configuration successfully discovered and selected both Safe and Auto-approve through the V2 adapter.

## Adapter behavior

- The generated V1-style agent configuration remains accepted by the verified V2 build. Keep V1 support; do not rewrite a user's native configuration as part of provider startup.
- V2 launches `serve --stdio --hostname 127.0.0.1 --port 0`, validates the reported loopback address, and uses a fresh random password. The existing execution owner starts and stops the process. Credentials and question answers are not persisted.
- Safe, Plan, and auxiliary agents retain the vault boundary through native `external_directory` denial. Agent discovery checks that this policy has loaded. Auto-approve retains its broader native permissions.
- Validate an advertised mode list before applying a mode. Missing managed modes must stop configuration with an actionable error. Never substitute Build for Safe, since that can remove approval requirements.
- Re-read reasoning options after switching models, so an effort option from the previous model is not sent to the new model. The same fix applies to MiMoCode.
- Map native permissions to existing approval cards and ordinary native forms to existing question cards. Choice labels are mapped back to native values; multiple choices and custom answers are supported. The question presenter is shared with Qwen without changing Qwen's protocol.
- Read V2 messages from `session_message`, ordered by `seq`, and normalize embedded text, reasoning, tool inputs, results, and errors through the existing chat presentation path. V1 `message` and `part` tables remain supported, including databases containing both schemas. All reads are read-only.
- Read V2 aggregate session spend from `session_v2.cost`. Free models correctly produce no spend badge; the tests use a positive-cost fixture to verify the storage fallback.
- Normalize V2 file-tool `path` inputs and the native `shell` tool name for the existing file and command renderers.
- MiMoCode keeps its current adapter and storage schema. The V2 transport and database changes are specific to OpenCode.

The official `@opencode/client` dependency is pinned to 2.0.0 to respect the repository's minimum release age. Command and permission replies use the verified 2.0.15/2.0.16 payload names directly because those two SDK payload names changed after 2.0.0.

## Verification limits

The V2 live suite used temporary vaults, isolated databases, and the CLI's available free model. The normal user configuration check covered discovery and mode selection only; it did not send a model request. External MCP servers, image handling, paid billing accuracy, Windows, and visual rendering inside Obsidian have not been verified by this matrix.

External and conditional native forms are cancelled with an explicit unsupported-interaction error instead of leaving a turn waiting for an invisible UI. SSE MCP transports are rejected; native stdio and HTTP MCP configuration is mapped to the API. V1 ACP does not deliver V2 native forms to the question callback.

The live suite is opt-in with `GRIMOIRE_OPENCODE_LIVE=1` and can make model requests. Set `GRIMOIRE_OPENCODE_V2_LIVE=1` as well to include the V2-only question scenario. Versions older than the V2 builds above have not been validated.

Official references: [V2 installation](https://opencode.ai/v2/docs), [native API](https://opencode.ai/v2/docs/api/), [ACP](https://opencode.ai/v2/docs/cli/acp/), and [V1 configuration compatibility](https://opencode.ai/v2/docs/migrate-v1/).
