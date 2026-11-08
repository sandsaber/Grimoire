# Attachment verification

Checked on 2026-09-18 while fixing #198 and #114.

## Shared behavior

Regression tests cover missing stored bytes, hydration before a queued send or steer,
draft restoration after a refusal, and keeping newer composer images out of an older
queued text message. Opening history remains tolerant of missing files.

The live image row sends two valid 64×64 PNGs through the real execution composition
and chat persistence barrier. It checks the answer, saved attachment hashes, and
rehydration from the saved references. Image names and the prompt do not reveal the
expected colors. Model IDs are passed in query options, as the composer does.

## Live results from 2026-09-18

| Provider | Selected model | Result |
| --- | --- | --- |
| Codex | `gpt-5.6-luna` | Passed. An initial run timed out; a diagnostic run also verified ordinary text input. |
| OpenCode | `opencode/mimo-v2.5-free` | Passed. |
| MiMoCode | `xiaomi/mimo-v2.5` | Passed. |
| Kimi Code | `zai-coding-plan/glm-5v-turbo` | Passed. |
| Gemini CLI | `gemini-3.1-flash-lite` | Passed. |
| Devin | `swe-1-6-slow` | Failed the follow-up check on CLI `3000.10.31`: two plugin runs and one direct ACP request returned `unavailable` after both native image reads completed. Earlier passes do not establish reliable image interpretation. See the follow-up below. |
| Antigravity | `Gemini 3.7 Flash (Low)` | Passed using temporary file attachments. |
| Command Code | `qwen/qwen3.8-flash` | Passed using a stored vault image in Safe mode, including a native Read tool call. |
| Claude Code | `haiku` | Blocked by `authentication_failed`; `claude auth status` confirmed `loggedIn: false`. |
| Qwen Code | `qwen3.6-plus(openai)`, `qwen3.7-plus(openai)` | Native ACP calls with explicit model selection returned `403 Access to model denied`. No successful live certification for these account/model combinations. |
| Grok Build | `grok-4.5`, CLI 1.0.34 | Unsupported in the current ACP handshake (`promptCapabilities.image: false`). Managed runs also returned `Cannot read binary file`. Some runs guessed or returned the expected colors, which does not establish image support. Grimoire now hides image input and refuses saved image requests. |
| Reasonix | — | Image input remains unsupported, matching its recorded ACP handshake. |

Early runs used a malformed PNG and the older test harness's global model setting;
those runs are not evidence for the model-specific passes above. The PNG chunk CRCs
and decompressed pixel bytes were subsequently checked, and the listed passing paths
were rerun with valid fixtures. Personal CLI configuration was not changed.

## Follow-up on 2026-11-08

Antigravity 1.5.3 read the two-color image through Grimoire’s native ACP path on macOS and answered “red, blue”. Older CLIs continue to use temporary files in print mode. Reasonix 2.58.0 now advertises ACP image input. Its Grimoire adapter still uses the opt-in file attachment path. The Reasonix check on this date covered text chat and rejection of a file write.

## Reproduce

### Devin follow-up, 2026-09-18

Fourteen live non-image rows passed on `devin 3000.10.31 (b98cc431)` with
`devin:swe-1-6-slow`: streamed text and persistence, shell permission and continuation,
reload from the saved native session, completion after tab closure, two surfaces on
one conversation, persisted usage, queued input, file reading, context-window usage,
second-turn recall, approved file writing, model discovery, spend handling and cancellation
with process cleanup. No spend value was reported, so this verifies empty-state handling,
not a nonzero charge. Settings refresh in Obsidian returned the account's one available
model, `swe-1-6-slow`.

Image interpretation failed twice through Grimoire and once over direct ACP without
Grimoire code. Both image reads completed successfully each time, but the answer was
`unavailable`. Direct discovery advertised `promptCapabilities.image: true` and
`cognition.ai/supportsImages: true` for the selected model. This reproduces the failure
outside the plugin; it does not establish whether Devin's CLI or upstream inference
causes it. Image support remains declared according to native capabilities, with this
account/model/version combination explicitly unverified for reliable image use.

The live harness now saves the requested model in `savedProviderModel.devin`, which
the runtime reads; the shared global `settings.model` field does not select a Devin model.
The image row also passes the model explicitly in query options.

```bash
GRIMOIRE_DEVIN_LIVE=1 GRIMOIRE_DEVIN_MODEL=devin:swe-1-6-slow \
npm run test -- --selectProjects integration --runInBand \
  --testPathPatterns DevinChatProjectionLiveSmoke

GRIMOIRE_DEVIN_LIVE=1 GRIMOIRE_DEVIN_MODEL=devin:swe-1-6-slow \
npm run test -- --selectProjects integration --runInBand \
  --testPathPatterns 'providers/devin/execution/DevinLiveSmoke' \
  --testNamePattern 'row (2:|5:|6:|7:|17:|19:)|rows 12 and 13:'
```

The first command currently fails its image row; the other seven rows passed. The
second command runs the seven additional rows above and passed.

### Provider image rows

The live suites are opt-in and use the authenticated accounts. Select a model with
image support and an appropriate cost before running a row. For example:

```bash
GRIMOIRE_OPENCODE_LIVE=1 \
GRIMOIRE_OPENCODE_MODEL=opencode:opencode/mimo-v2.5-free \
npm run test -- --selectProjects integration --runInBand \
  --testPathPatterns OpencodeChatProjectionLiveSmoke \
  --testNamePattern 'image attachments:'
```

The other provider suites use the corresponding `GRIMOIRE_<PROVIDER>_LIVE` and
`GRIMOIRE_<PROVIDER>_MODEL` variables. Claude also requires
`NODE_OPTIONS=--experimental-vm-modules` for its ESM SDK. Command Code has a separate
single-image test enabled with `GRIMOIRE_COMMANDCODE_IMAGES_LIVE=1`.

For Qwen custom endpoints, input modality and account access are separate requirements.
Only a vision-capable model should declare `generationConfig.modalities.image: true`;
this setting cannot grant access to a model or add vision to a text-only model.
See [Qwen model settings](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/).
