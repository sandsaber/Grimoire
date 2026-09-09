/**
 * Devin's session modes, as `session/new` lists them: `accept-edits` (Code,
 * the default), `smart`, `ask`, `plan`, and `bypass`. Recorded in
 * `tests/fixtures/provider-traces/wire/devin-wire.json`.
 *
 * Grimoire's Safe mode is `accept-edits` on purpose. Devin has no mode that
 * asks before every edit: `accept-edits` auto-approves file writes and asks
 * only for shell commands. What makes it safe here is that every write goes
 * through the client's `fs/write_text_file`, which is where
 * `AcpWorkspaceFileSystem` asks the tab — so the approval Devin skips is the
 * one Grimoire gives.
 *
 * ponytail: known ceiling. Devin classifies some shell commands as read-only
 * by name and runs them without asking — `echo no > file` is one (observed
 * 2026-09-09), `printf no > file` asks. Told no on a write, the agent wrote the
 * file with `echo` through its own shell. `DEVIN_PERMISSION_MODE=auto` does
 * not change that, and `ask` runs no tools at all. The upgrade path is ACP
 * terminal delegation — `AcpClientConnection` already accepts a `terminal`
 * delegate — so Grimoire runs the command and asks first; no provider drives it
 * yet. Until then, Plan is the read-only session.
 */
export const DEVIN_SAFE_MODE_ID = 'accept-edits';
export const DEVIN_FULL_ACCESS_MODE_ID = 'bypass';
export const DEVIN_PLAN_MODE_ID = 'plan';

export function mapGrimoireModeToDevin(mode: string | null | undefined): string {
  switch (mode) {
    case 'full_access':
    case 'yolo':
      return DEVIN_FULL_ACCESS_MODE_ID;
    case 'plan':
      return DEVIN_PLAN_MODE_ID;
    default:
      return DEVIN_SAFE_MODE_ID;
  }
}

export function mapDevinModeToGrimoire(mode: string | null | undefined): 'normal' | 'full_access' | 'plan' {
  switch (mode) {
    case DEVIN_FULL_ACCESS_MODE_ID: return 'full_access';
    case DEVIN_PLAN_MODE_ID: return 'plan';
    default: return 'normal';
  }
}
