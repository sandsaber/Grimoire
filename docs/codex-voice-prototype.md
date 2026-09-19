# Dictation prototype (#189)

Status: investigation saved on 2026-09-19; no product dictation UI or standalone
audio application has been implemented.

Issue: [#189 — voice interaction](https://github.com/sandsaber/Grimoire/issues/189).

Branch: `codex/189-codex-voice-prototype`, based on `main` at
`9f39f9fb94ed38fbe23df42ab98dee8591c32596`.

## Initial dictation scope

The user clarified that the required feature is speech-to-text input, not a two-way
voice conversation. Spoken replies and a realtime conversation are no longer part of
the prototype. Codex remains the initial chat provider for manual verification.

Proposed first slice: explicitly start and stop recording, transcribe the recording,
and insert the result into the composer while preserving its existing draft. The user
can edit the text and submit it through the normal chat flow. Transcription itself
must not start an agent turn. Errors or cancellation must leave the draft intact, and
recording must stop when its UI is disposed.

This flow can be independent of the selected chat provider: after transcription,
Codex receives an ordinary text prompt. A Codex realtime connection is not required.

## Later discussion: independent audio application and CLI

The discussion expanded from a microphone button in Grimoire to a separately
installed audio tool that is useful without Obsidian or OpenClaw. The user proposed
an application plus CLI, with Grimoire integration following later. This is a saved
direction for future work, not authorization to create or publish a new project.

The working proposal is one recognition core with three entry points:

| Entry point | Proposed responsibility |
| --- | --- |
| Application UI | Model selection and download, microphone recording, audio-file transcription, editable text output |
| CLI | Setup, file transcription for scripts, and headless service operation |
| Local HTTP API | Readiness checks and audio-to-text requests from Grimoire or other clients |

All entry points should share the model cache, configuration, and recognition
runtime. OpenClaw and a conversational LLM are unnecessary for dictation. A full
spoken assistant would be a separate scope decision.

### Installation and implementation candidates

- Prefer a separately installed CLI with a simple setup command. Global npm
  installation was proposed as the first distribution channel; a shell/PowerShell
  installer for prebuilt releases is another option. Neither package nor installer
  exists yet, and `grimoire-audio` is only a working name.
- npm distribution does not require implementing the service in TypeScript: a
  package can select and launch a prebuilt native binary for the host platform.
  We would own builds and packaging of the runtime's required dependencies.
- `cargo install` is an optional developer-oriented route, not `cargo -g`. It
  generally builds from source and requires the Rust toolchain.
- Rust for the service and TypeScript for a small browser UI were proposed, not
  finalized. TypeScript with Bun is also technically viable. Recognition speed
  depends primarily on the model, runtime, and hardware rather than the wrapper.
- A browser UI served by the CLI would preserve simple installation. A Tauri
  desktop wrapper and graphical installers were discussed but are not required
  for the first prototype.
- Candidate engines are Whisper through whisper.cpp and Parakeet v3. Choose after
  checking Russian transcription quality, latency, memory use, and packaging on
  target hardware. No local recognition engine has been installed or benchmarked
  during this investigation.
- Model weights should be downloaded during explicit setup and cached outside the
  vault. Grimoire would locate the installed executable (with a configured path
  fallback), start it as needed, and check service/model readiness.
- Prefer a small HTTP transcription contract, such as an OpenAI-shaped
  `POST /v1/audio/transcriptions`, over implementing ACP sessions for dictation.
  Actual engine compatibility and readiness endpoints still need verification.

The [Obsidian community-directory policies](https://docs.obsidian.md/community-directory/developer-policies)
prohibit plugins from installing or updating their dependencies. This supports
keeping runtime installation outside the plugin. The policy should not be
misrepresented as a blanket ban on downloading model data.

### Dictation into other applications

The user also explored dictating into other chats and editors on macOS and Windows.
The proposed flow is a global shortcut, microphone capture, transcription, and
insertion into the focused text field, leaving message submission to the user.

A browser UI alone does not provide this system-wide input integration. The local
background process would own shortcuts and native insertion, potentially using
clipboard paste. On macOS this requires microphone access and Accessibility
permission for input control. Windows `SendInput` is subject to privilege-level
restrictions. Unusual editors, protected fields, focus changes, and clipboard
preservation need real compatibility testing; no such insertion test has run yet.

Sources: [macOS Accessibility](https://support.apple.com/guide/mac-help/allow-accessibility-apps-to-access-your-mac-mh43185/mac),
[Windows SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput).

System-wide dictation could make basic input work in Obsidian without a dedicated
Grimoire integration. The later API integration would provide an in-plugin
microphone control and recording/transcription status.

### Banter reference and cost discussion

Banter is a browser-based React voice chat UI plus a Bun control plane. OpenClaw
is its separately connected agent gateway; speech recognition and synthesis run
in separate services. Its documented interaction is inside its chat. A built-in
global dictation mode that inserts text into other applications was not found in
the reviewed README and architecture documentation.

Its [speech-model guide](https://github.com/arvindvenkataramani/banter/blob/main/docs/models.md)
describes Parakeet TDT 0.6B v3 and Whisper large-v3-turbo for recognition. Synthesis
options include Kokoro, NeuTTS Air, and Voxtral; Pocket TTS needs a suitable server,
and OmniVoice was described as still needing an adapter. These synthesis features
are outside the current dictation scope. Local speech recognition can be combined
with a separately billed cloud chat model; their costs are independent.

At the pricing snapshot checked on 2026-09-18, `gpt-4o-mini-transcribe` was estimated
at USD 0.003 per audio minute (USD 0.18 per recorded hour). Earlier two-way realtime
estimates were USD 2.88 for 30 minutes of new input audio plus 30 minutes of output
with `gpt-realtime-1.5`, or USD 0.90 with `gpt-realtime-mini`. Those excluded extra
text/history costs and did not establish compatibility with Codex's native route.
Recheck [OpenAI pricing](https://developers.openai.com/api/docs/pricing) before making
a product decision. No separately billed API dependency has been selected.

Claude Code's [voice dictation](https://code.claude.com/docs/en/voice-dictation)
was also reviewed: its documented claude.ai-authenticated dictation does not count
transcription against usage limits. No supported Grimoire/Agent SDK bridge to that
dictation feature was established.

### Resume point

Before building a standalone product, validate one installed recognition engine
with a short Russian recording and file transcription. Then settle the initial
platforms, engine, and packaging, define the shared API, and add UI/CLI clients.
If system-wide input is included, test it independently from speech recognition.
Integrate Grimoire after the standalone transcription path is verified. Keep
unselected alternatives as proposals, not accepted requirements.

## Speech-to-text choice

No transcription backend has been selected or verified inside Obsidian yet.

- First check native macOS Dictation in the existing composer. Apple documents
  [dictation in text fields](https://support.apple.com/en-mide/guide/mac-help/mh40584/mac);
  compatibility with this composer still needs a manual check. This option requires
  no Grimoire speech service or separate API key.
- An integrated recording button can submit a completed recording to a speech-to-text
  service such as the [OpenAI transcription API](https://developers.openai.com/api/docs/guides/speech-to-text).
  This would introduce a separate API key and billing; that choice is still open.
- Local speech recognition can be considered if offline operation becomes a requirement.
  Model installation and runtime management are additional work, not prerequisites for
  a first dictation prototype.

The generated experimental app-server protocol for installed Codex 0.154.0 exposes
no standalone dictation/transcription RPC. `thread/realtime/appendSpeech` accepts text;
its name does not establish a speech-to-text API. Do not assume desktop-app dictation
is available through subscription-authenticated app-server calls.

## Native audio attachment probe

Codex 0.154.0's generated `UserInput` schema includes `audio` and `localAudio`
variants for ordinary `turn/start` requests. These are separate from realtime RPCs.
Schema acceptance alone does not establish that the selected model receives audio.

On 2026-09-18, two ephemeral tests sent a 3.6-second synthetic WAV to the default
`gpt-6-astra` model using existing ChatGPT authentication: once as `localAudio`
with an absolute path, and once as `audio` with a WAV data URL. Both requests were
acknowledged and completed without a transport error. Both replies said the audio
was unavailable; neither transcribed the recording. No transcription tools were used.

The same connection's `model/list` advertised only `text` and `image` for all five
visible models. The official [app-server documentation](https://developers.openai.com/codex/app-server)
defines `inputModalities` as the supported input types. These results do not establish
working native audio input in this installation; other models, formats, and future
versions remain untested. Passing a file to an agent that invokes a separate speech
recognizer is a different workflow and still requires that recognizer.

## Earlier realtime investigation

The findings below concern the superseded two-way voice approach. They do not block
dictation through an independent transcription backend.

On 2026-09-18, installed `codex-cli 0.154.0` reported `Logged in using ChatGPT`.
Fresh ephemeral threads in an empty temporary directory successfully completed
`initialize`, `thread/start`, and the `thread/realtime/start` RPC acknowledgement.
WebSocket startup then emitted:

```json
{
  "method": "thread/realtime/error",
  "params": {
    "threadId": "<test-thread>",
    "message": "realtime conversation requires API key auth"
  }
}
```

The default protocol and explicitly selected `v2` and `v3` all failed this way.
No `thread/realtime/started` or output audio arrived. The probes did not record a
microphone or read vault notes. No user authentication or global configuration was changed.

The official source confirms the API-key requirement in
[`realtime_api_key`](https://github.com/openai/codex/blob/7498521d288b9b3b96ffba4eedf089d8d6e06a84/codex-rs/core/src/realtime_conversation.rs#L1773-L1796).
Its temporary fallback reads `OPENAI_API_KEY` even for ChatGPT-authenticated sessions.
This source snapshot supports the observed failure; it is not a promise about future CLI versions.
Voice in the Codex desktop app does not establish that this standalone CLI path works with
subscription authentication.

## Reproduce startup

The opt-in integration test uses Grimoire's existing `CodexAppServerProcess` and
`CodexRpcTransport`. It waits for the readiness notification and fails on the asynchronous
error, rather than treating an RPC acknowledgement as a connected voice session.

```bash
GRIMOIRE_CODEX_VOICE_LIVE=1 npm run test -- --selectProjects integration --runInBand --runTestsByPath tests/integration/providers/codex/execution/CodexVoiceStartupLive.integration.test.ts
```

Optional environment variables:

- `GRIMOIRE_CODEX_CLI`: path to the installed CLI; defaults to `codex`.
- `GRIMOIRE_CODEX_VOICE_VERSION`: `v1`, `v2`, or `v3`; defaults to `v1`.

The test is skipped unless explicitly enabled. A successful start can open a billable
realtime session, which is stopped during cleanup. No microphone capture or audio
playback is attempted. Supplying an API key alone has not been verified to be sufficient:
model access, audio delivery, latency, and Obsidian integration remain untested.

The opt-in test remains a diagnostic for that earlier approach, not a dictation
acceptance test. No desktop-app tokens or undocumented authentication endpoints are
needed for the proposed dictation flow.

Banter's application connects to OpenClaw Gateway and separate speech servers; its
conversation orchestration is unnecessary for this dictation scope. See its
[architecture](https://github.com/arvindvenkataramani/banter/blob/main/docs/architecture/README.md).
