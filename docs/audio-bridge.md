# Grimoire Audio dictation

Grimoire can use the separately installed Grimoire Audio desktop app through its
v1 local JSON-lines bridge. The chat provider does not record or transcribe.
This initial integration explicitly requests Local recognition.

## Use

1. Install Grimoire Audio and prepare a local model in that app.
2. Leave **General → Grimoire Audio executable** empty for discovery, or select
   the native executable. CachyOS normally discovers `/usr/bin/grimoire-audio`.
3. Place an empty caret in the chat draft and click its microphone button.
4. Preparing remains visible until Audio reports actual capture. Stop ends
   capture and waits for recognition; Cancel or Escape discards the pending result.
5. Final text is inserted at the original caret. Review it and send normally.

Selecting text, editing or moving the caret, switching/closing a tab, changing
conversation or starting a chat turn invalidates the binding. Late results are
discarded. Dictation never submits a message, synthesizes Enter or uses clipboard
paste. A missing Audio installation/model or a Busy response leaves ordinary chat
available. No provider change or model download is performed by this client.

## Lifecycle and transport

The application transport spawns the resolved native executable with `--bridge`,
piped stdio and `shell: false`. Audio owns the resident model/capture. Grimoire
opens one connection per dictation, correlates safe increasing request IDs, and
closes it on completion, cancellation, tab teardown or unload. EOF cancels only
that connection's unfinished job; Grimoire never kills the shared Audio app.
Broken connections are not reconnected/replayed.

Frames are bounded to 64 KiB and decoded as strict UTF-8. Unknown identities,
invalid envelopes, missing acceptance, remote results and oversized responses
fail closed. Native stderr/messages are not transcript sources or routine logs.
Only final local text reaches the draft, after an immediate check of its original
context, entire value, collapsed caret, editability and connection to the DOM.
An input event informs existing composer controllers; no send action is invoked.

The path setting contains one executable, not a command line. Windows requires
a native `.exe`; macOS also checks the Audio Prototype application bundle.
Actual native acceptance in this slice is CachyOS only.

## Verification, 2026-11-08

Focused tests cover Unicode/newline insertion, caret/suffix preservation,
initialization cancellation, late results, edit-and-restore, changed context,
protected/disposed targets, framing, explicit local consent, Busy, EOF, malformed
responses and actual-listening/recognition transitions. Tab tests and the full
unit suite cover the wiring and existing chat behavior.

The opt-in integration test runs against the actual installed Audio 0.0.2 ELF
using the previously approved synthetic WAV and cached base. A normal Audio GUI
is used, not an alternate model owner. Its real bridge response reaches the
production dictation controller and a DOM textarea with exact original text/caret
checks. An accepted file job is cancelled; its result is suppressed, and another
file request succeeds with the same GUI PID/model load count. Only boolean/count
metadata is retained. Tests have no sound devices, external routes or normal
profile/vault writes. The test supplies file transcription in place of capture;
there is no file-as-microphone switch in the product UI.

Run with the repository-supported Node version and explicit environment:

```sh
GRIMOIRE_AUDIO_ACCEPTANCE=1 \
GRIMOIRE_AUDIO_WAV=/absolute/path/to/approved/synthetic.wav \
GRIMOIRE_AUDIO_EXPECTED_PID=123 \
npm run test -- --selectProjects integration --runInBand \
  --runTestsByPath tests/integration/features/chat/audio/audioBridge.integration.test.ts
```

Start a separately owned Audio GUI with an isolated profile and cached approved
model first. The expected PID must refer to that GUI. This test is opt-in and
never starts capture; ordinary integration runs skip it.

Browser visual QA uses the production controls with an explicitly simulated
recognition session, actual installed Obsidian app.css and built plugin CSS.
Dark/light and narrow composer states were checked against the Nordic drawing.
This is not a live Obsidian recording demonstration. Full microphone Start/Stop,
OS permission prompts, real speech, native Obsidian end-to-end and macOS/Windows
acceptance remain open. The branch is not a published plugin release.

Final gates: 656 unit suites / 9991 tests, typecheck, lint and release
build/load/view-open checks pass. Live acceptance keeps one Audio GUI PID and
one model load, with exact draft/caret checks, no submit/keyboard events and
recovery after cancellation. The preview bundle is generated under
`dist/grimoire`; disposable QA metadata and screenshots remain untracked.
