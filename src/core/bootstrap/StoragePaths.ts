export const GRIMOIRE_STORAGE_PATH = '.grimoire';

export const GRIMOIRE_SETTINGS_PATH = `${GRIMOIRE_STORAGE_PATH}/grimoire-settings.json`;

/**
 * Grimoire-owned durable control store for the execution lifecycle.
 *
 * Decided in `docs/provider-execution-persistence-decisions.md` (D1) and
 * created at the first M2 flip, when the kernel enters production. The paths
 * exist here from M1 so the dark kernel can be written and tested against them;
 * nothing writes to the vault until that flip. Control records are inert to the
 * old runtime path, which is what makes reverting a shipped flip safe (D6).
 */
export const GRIMOIRE_CONTROL_PATH = `${GRIMOIRE_STORAGE_PATH}/control`;
export const TRANSACTION_INTENTS_PATH = `${GRIMOIRE_CONTROL_PATH}/transaction-intents`;
export const EXECUTION_SESSIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/execution-sessions`;
export const EXECUTION_RUNS_PATH = `${GRIMOIRE_CONTROL_PATH}/execution-runs`;
export const EXECUTION_INTERACTIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/interactions`;
export const EXECUTION_RECONCILIATIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/reconciliations`;
export const SETTINGS_TRANSITIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/settings-transitions`;
export const SHUTDOWN_CHECKPOINTS_PATH = `${GRIMOIRE_CONTROL_PATH}/shutdown-checkpoints`;

export const LEGACY_SESSIONS_PATH = '.claude/sessions';
export const SESSIONS_PATH = `${GRIMOIRE_STORAGE_PATH}/sessions`;
