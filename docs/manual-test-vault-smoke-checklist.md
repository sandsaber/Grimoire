# Manual Test-Vault Smoke Checklist

This document describes the manual smoke tests to run in the Obsidian test vault
after building and installing the Grimoire plugin. The test vault is configured
at `/Users/mimakarov/HomeBrew/GrimorieTestObsidian`.

## Prerequisites

```bash
npm run build:release
```

This copies `main.js`, `manifest.json`, `styles.css`, and `CHANGELOG.md` to
`<vault>/.obsidian/plugins/grimoire/`. Verify with:

```bash
shasum -a 256 <vault>/.obsidian/plugins/grimoire/main.js
shasum -a 256 main.js
```

The checksums must match.

## Smoke Tests

### 1. Plugin loads without errors

1. Open Obsidian with the test vault
2. Open Settings → Community plugins
3. Verify Grimoire is listed and enabled
4. Check the developer console (Ctrl+Shift+I) for errors
5. **Expected:** No errors in console; Grimoire sidebar icon appears

### 2. Chat view opens

1. Click the Grimoire sidebar icon (or run "Grimoire: Open chat" command)
2. **Expected:** Chat view opens with an input textarea and message container
3. The view should show an empty conversation state

### 3. Message submission

1. Type "Hello" in the input textarea
2. Press Enter
3. **Expected:** The message is submitted through the ApplicationRuntime
4. Check console: no "Runtime is not ready" notice should appear if the runtime started successfully

### 4. Provider resolution

1. Open Settings → Grimoire
2. **Expected:** Provider settings tabs are visible (Claude, Codex, OpenCode, etc.)
3. Each provider should show its display name from the catalog
4. Enable/disable toggles should work through catalog settings decode/encode

### 5. Settings persistence

1. Toggle a provider's enabled state
2. Close and reopen Settings
3. **Expected:** The toggle state persists (settings are decoded/encoded through catalog modules)

### 6. History (if conversations exist)

1. Click the history button (if visible)
2. **Expected:** Previously created conversations appear in the history list
3. Selecting a conversation should load its projection

### 7. Restart recovery

1. With a conversation active, close Obsidian
2. Reopen Obsidian
3. Open Grimoire
4. **Expected:** The runtime starts; conversations load from persistent storage

## Automated Equivalents

The following automated tests cover the same paths:

| Manual test | Automated test |
|---|---|
| Plugin loads | `ApplicationRuntimeSmokeTest > starts the runtime and loads all nine provider backends` |
| Chat view opens | `ApplicationRuntimeSmokeTest > creates a conversation and loads its projection` |
| Provider resolution | `ApplicationRuntimeSmokeTest > resolves provider display names through the catalog` |
| Backend resolution | `ApplicationRuntimeSmokeTest > resolves provider backend IDs through the catalog` |
| Projection updates | `ApplicationRuntimeSmokeTest > attaches a projection listener and receives updates` |
| Restart recovery | `ApplicationRuntimeSmokeTest > shuts down cleanly after accepting commands` |

## Known Limitations

- The projection-backed view is a minimal implementation: it renders messages
  as text divs without the full styling, tool calls, or agent work cards. The
  complete ChatProjectionRenderer will be wired in a follow-up.
- History browsing depends on the full GrimoireView UI, which was rewritten
  during the cutover. The history button and dropdown are not yet reconnected.
  Legacy conversations are migrated to the revisioned repository on startup
  by ApplicationRuntimeMigration, but the history UI is not yet wired.
- Provider/model selection UI is not yet available in the new view; the view
  defaults to the first catalog provider (Claude). Provider backends are
  wired with concrete Node process launchers (Antigravity transport, managed
  ACP launcher, Codex app-server, Claude SDK query factory).
- Inline edit returns "requires a connected provider session" because the
  inline edit service has not been migrated to the new execution platform.
