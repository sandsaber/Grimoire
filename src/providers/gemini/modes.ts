/**
 * The two vocabularies a Gemini session has to be described in.
 *
 * Grimoire's toolbar offers three values — `normal`, `full_access`, `plan` —
 * and Gemini CLI's session offers four of its own. The recorded session
 * (`tests/fixtures/provider-traces/wire/gemini-wire.json`, `gemini 0.55.1`)
 * answers `session/new` with exactly these, in this order:
 *
 * - `default` — "Prompts for approval"
 * - `autoEdit` — "Auto-approves edit tools"
 * - `yolo` — "Auto-approves all tools"
 * - `plan` — "Read-only mode"
 *
 * Neither set is a superset of the other, which is why a translation exists
 * rather than a pass-through: sending Grimoire's `full_access` as a `modeId`
 * is a mode the agent does not have, and storing the agent's `autoEdit` as a
 * permission mode is a value the toolbar cannot render.
 */

/** Gemini's own default, which a session reports itself as opening in. */
export const GEMINI_DEFAULT_MODE_ID = 'default';
export const GEMINI_AUTO_EDIT_MODE_ID = 'autoEdit';
export const GEMINI_YOLO_MODE_ID = 'yolo';
export const GEMINI_PLAN_MODE_ID = 'plan';

/**
 * What to send as `modeId`, from whatever the vault holds.
 *
 * Accepts the agent's own ids too, so a mode that arrived from the session and
 * was stored survives the round trip unchanged. Anything unrecognised becomes
 * `default`, which is the mode that asks before it acts — the safe way to be
 * wrong about a permission.
 */
export function mapGrimoireModeToGemini(mode: string | null | undefined): string {
  switch (mode) {
    case 'full_access':
    case GEMINI_YOLO_MODE_ID:
      return GEMINI_YOLO_MODE_ID;
    case 'plan':
      return GEMINI_PLAN_MODE_ID;
    case GEMINI_AUTO_EDIT_MODE_ID:
      return GEMINI_AUTO_EDIT_MODE_ID;
    case 'normal':
    case GEMINI_DEFAULT_MODE_ID:
    default:
      return GEMINI_DEFAULT_MODE_ID;
  }
}

/**
 * What the toolbar shows, from whatever the session reported.
 *
 * `autoEdit` maps to `normal` rather than to `full_access`: it auto-approves
 * edits and still asks before a command, so calling it Auto-approve would tell
 * the user they had given away more than they have.
 */
export function mapGeminiModeToGrimoire(
  mode: string | null | undefined,
): 'normal' | 'full_access' | 'plan' {
  switch (mode) {
    case GEMINI_YOLO_MODE_ID:
      return 'full_access';
    case GEMINI_PLAN_MODE_ID:
      return 'plan';
    default:
      return 'normal';
  }
}
