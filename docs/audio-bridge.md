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
OS permission prompts, real speech, native microphone-to-composer and macOS/Windows
acceptance remain open. Native Obsidian file-producer acceptance is recorded below. The branch is not a published plugin release.

Final gates: 656 unit suites / 9991 tests, typecheck, lint and release
build/load/view-open checks pass. Live acceptance keeps one Audio GUI PID and
one model load, with exact draft/caret checks, no submit/keyboard events and
recovery after cancellation. The preview bundle is generated under
`dist/grimoire`; disposable QA metadata and screenshots remain untracked.

## Native Obsidian installation and acceptance, 2026-11-08

The requested preview was installed in the registered TestVault plugin directory.
A private full plugin backup and deployed-byte backup were saved under
`.build/obsidian-install-20261108/`. Only main.js, manifest.json and styles.css
were atomically replaced; all three match the accepted release bundle. Existing
plugin data.json remained byte-identical. The installed plugin version is 2.0.13.

The installed Obsidian 1.15.0 application then loaded those exact deployed bytes
in a separate empty QA vault/profile. Its official CLI opened the actual
Grimoire view and exercised the production bridge/controller against real Audio
and the approved synthetic WAV. Exact native textarea/caret insertion, accepted
job cancellation, concurrent-edit preservation, tab-switch suppression, recovery,
zero keyboard/submit events, the same Audio GUI PID and one model load all pass.
Native first-open QA found and corrected a composer containment defect: a long
release-notes card could shrink the tab below its toolbar height. The notice now
yields height and scrolls only its list while preserving the composer minimum.

The file producer is injected only into the in-memory QA session and restored
afterward; product microphone capture has no file-input override. The native
Chromium sandbox stays enabled. Host libraries/application files are read-only;
normal home/profile and vault contents are not mounted into the test. No sound
devices or external routes exist. The original approved cache is unchanged.
The empty QA vault explicitly trusts only our deployed Grimoire code. Obsidian
reloads its renderer when Restricted Mode is switched off, so the harness waits
for readiness before issuing further commands. This changes no trust setting in
the working vault.

The native acceptance waits for the sidebar animation, then checks actual
`elementFromPoint` hits at the center and inset corners of microphone and Send,
and also checks Cancel during an admitted job. Geometry alone missed clipping
by a parent container. The stronger check failed on the pre-fix deployed bundle;
it passes after the containment fix. Screenshots are taken only after clearing
the test draft.

Linux developers can reproduce with the installed app/CLI and explicit approved
inputs (Python and Xvfb are QA tools, not plugin runtime requirements):

```sh
python3 tests/integration/features/chat/audio/obsidian_native_smoke.py \
  --obsidian /absolute/path/to/obsidian \
  --asar /absolute/path/to/obsidian-1.15.0.asar \
  --xvfb /absolute/path/to/Xvfb \
  --base /absolute/path/to/approved/ggml-base.bin \
  --wav /absolute/path/to/approved/synthetic.wav \
  --plugin /absolute/path/to/vault/.obsidian/plugins/grimoire \
  --work "$PWD/.build/native-obsidian-check"
```

The JS acceptance refuses any vault except the owned /qa/vault with its explicit
marker. The launcher also refuses child mode outside its disposable namespace.
It never launches the normal working vault. The actual installed user window
was not accessible to the agent; an already open window needs a plugin/window
reload to pick up the replaced files. Physical microphone capture remains open.
