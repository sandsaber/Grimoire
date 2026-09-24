# OpenCode V2 setup and compatibility

Grimoire keeps one OpenCode provider and detects the installed CLI version. OpenCode 1.x uses `opencode acp`. V2 uses the CLI's native HTTP API and event stream through an owned, authenticated loopback server.

## Set up V2

Use a Grimoire build containing [the V2 integration in PR #223](https://github.com/sandsaber/Grimoire/pull/223). An older Grimoire build that launches V2 over ACP does not gain this support by upgrading the CLI alone.

1. Install the CLI from the [official V2 installation page](https://opencode.ai/v2/docs):

   ```bash
   curl -fsSL https://opencode.ai/v2/install | bash
   opencode --version
   ```

   Alternatives are `npm install -g @opencode/cli` and `brew install anomalyco/tap/opencode-v2`. Windows users should use the standalone binary linked on the installation page.
2. Run `opencode` and connect the providers you intend to use. V2 and V1 share the command name and configuration locations. Keep a copy of your V1 setup if you need rollback, and follow the [migration guide](https://opencode.ai/v2/docs/migrate-v1/) when replacing a package-managed installation. Supported V1 configuration does not require wholesale conversion; native V2-only configuration and V2 plugins are separate migration considerations.
3. Enable **OpenCode** in Grimoire's provider settings. Set **OpenCode CLI path** if the executable you want is not the one found automatically. Reload Grimoire after replacing the CLI.
4. Click **Refresh all models**, open **Browse models**, and select the models to show in chat. Refresh preserves existing selections and aliases, including entries the CLI no longer reports; it does not select every new model automatically. Select an available model for the first V2 turn. Changes appear in the existing chat tab.

Grimoire starts and stops its private V2 server automatically. There is no second provider to enable or server to launch manually.

## If the selected mode or model is unavailable

V2 ACP can capture an incomplete agent catalog during startup and retain it for the session. This reproduces outside Grimoire: the native API initially returns only built-in agents, then exposes the managed agents after configuration discovery finishes. Sleeping before the first ACP session or upgrading from 2.0.15 to 2.0.16 does not reliably fix it. Grimoire's V2 adapter waits for the required agents and enabled models before creating a session.

For a `mode not found` error, check the Grimoire build and the selected CLI path, then reload the plugin. For an unavailable model, refresh the catalog and choose a model the current CLI reports; an old selected model can remain visible intentionally. Do not switch to Auto-approve to work around a missing Safe mode.

## Verified versions

The following checks were run on macOS arm64 on 2026-09-24. CLI binaries came from the official OpenCode distribution; temporary V2 archives were checked against their npm integrity hashes.

| Version | Grimoire transport | Verification |
| --- | --- | --- |
| 1.18.32 | ACP | Live streaming response, cold session resume, allowed write, denied write |
| 2.0.15 | Native API | Live streaming response, cold session resume, allowed write, denied write, native question and answer |
| 2.0.16 | Native API | All 13 live smoke scenarios, plus the Obsidian test-vault checks below |

The sanitized ACP mode replies that demonstrate the original issue are recorded in `tests/fixtures/provider-traces/opencode-mode-compatibility.json`. The live suite covers streaming, tools, context usage and selected-model identity, continuation, cold resume, replacement of missing sessions, permission allow/deny, model and command discovery, spend handling, cancellation, and native questions. The cold-resume check also verifies history hydration from native storage. A separate metadata-only check with the local user's normal configuration successfully discovered and selected both Safe and Auto-approve through the V2 adapter.

In Obsidian 1.13.7 on the local test vault, the installed bundle matched the source build and passed these checks:

- Refresh discovered current models; a newly selected model appeared in an already open tab.
- A V2 chat returned the expected answer and updated the context meter.
- The native question card passed the selected answer back to the agent.
- Safe created a test file containing that answer only after **Allow once**. A second test file was absent after **Reject**.
- The question and permission cards were visually checked in the real Obsidian window.

## Adapter behavior

- The generated V1-style agent configuration remains accepted by the verified V2 build. Keep V1 support; do not rewrite a user's native configuration as part of provider startup.
- V2 launches `serve --stdio --hostname 127.0.0.1 --port 0`, validates the reported loopback address, and uses a fresh random password. The existing execution owner starts and stops the process. Server passwords are ephemeral. Interaction-resolution payloads are not persisted in Grimoire's control records; native transcripts can contain question answers.
- Safe, Plan, and auxiliary agents retain the vault boundary through native `external_directory` denial. Agent discovery checks that this policy has loaded. Auto-approve retains its broader native permissions.
- Validate an advertised mode list before applying a mode. Missing managed modes must stop configuration with an actionable error. Never substitute Build for Safe, since that can remove approval requirements.
- Re-read reasoning options after switching models, so an effort option from the previous model is not sent to the new model. The same fix applies to MiMoCode.
- Map native permissions to existing approval cards and ordinary native forms to existing question cards. Choice labels are mapped back to native values; multiple choices and custom answers are supported. The question presenter is shared with Qwen without changing Qwen's protocol.
- Read V2 messages from `session_message`, ordered by `seq`, and normalize embedded text, reasoning, tool inputs, results, and errors through the existing chat presentation path. V1 `message` and `part` tables remain supported, including databases containing both schemas. All reads are read-only.
- Read V2 aggregate session spend from `session_v2.cost`. Free models correctly produce no spend badge; the tests use a positive-cost fixture to verify the storage fallback.
- Normalize V2 file-tool `path` inputs and the native `shell` tool name for the existing file and command renderers.
- MiMoCode keeps its current adapter and storage schema. The V2 transport and database changes are specific to OpenCode.

The official `@opencode/client` dependency is pinned to 2.0.0 to respect the repository's minimum release age. Command and permission replies use the verified 2.0.15/2.0.16 payload names directly because those two SDK payload names changed after 2.0.0. The optional `msgpackr-extract` install script is explicitly denied in `allowScripts`; clean `npm ci` succeeds without relaxing the repository's strict script policy.

## Verification limits

The automated V2 live suite used temporary vaults, isolated databases, and an available free model. The later Obsidian checks used the normal local configuration and the free model. External MCP servers, image handling, paid billing accuracy, and the native OpenCode CLI on Windows have not been verified. Cross-platform CI validates Grimoire's tests and lifecycle contracts; it is not a live Windows CLI test.

External and conditional native forms are cancelled with an explicit unsupported-interaction error instead of leaving a turn waiting for an invisible UI. SSE MCP transports are rejected; native stdio and HTTP MCP configuration is mapped to the API. V1 ACP does not deliver V2 native forms to the question callback.

The live suite is opt-in with `GRIMOIRE_OPENCODE_LIVE=1` and can make model requests. Set `GRIMOIRE_OPENCODE_V2_LIVE=1` as well to include the V2-only question scenario. Versions older than the V2 builds above have not been validated.

Official references: [V2 installation](https://opencode.ai/v2/docs), [native API](https://opencode.ai/v2/docs/api/), [ACP](https://opencode.ai/v2/docs/cli/acp/), and [V1 configuration compatibility](https://opencode.ai/v2/docs/migrate-v1/).
