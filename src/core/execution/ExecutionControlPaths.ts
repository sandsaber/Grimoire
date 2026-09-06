import { GRIMOIRE_STORAGE_PATH } from '../bootstrap/StoragePaths';

/**
 * Vault paths for the durable execution control store.
 *
 * Decided in `docs/provider-execution-persistence-decisions.md` (D1), created
 * at the first provider flip, and inert to the legacy runtime path so a shipped
 * flip can be reverted safely (D6).
 *
 * They live here rather than in `StoragePaths` for a reason worth keeping: that
 * module is reachable from `src/main.ts`, so declaring the paths there put their
 * string literals into the shipped bundle even though nothing read them. The
 * kernel is meant to be absent from releases until its first flip, and
 * `tests/unit/architecture/darkBundle.test.ts` now asserts that against the
 * built bundle instead of trusting a build to be unchanged.
 */

export const GRIMOIRE_CONTROL_PATH = `${GRIMOIRE_STORAGE_PATH}/control`;
export const TRANSACTION_INTENTS_PATH = `${GRIMOIRE_CONTROL_PATH}/transaction-intents`;
export const EXECUTION_SESSIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/execution-sessions`;
export const EXECUTION_RUNS_PATH = `${GRIMOIRE_CONTROL_PATH}/execution-runs`;
export const EXECUTION_INTERACTIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/interactions`;
export const EXECUTION_RECONCILIATIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/reconciliations`;
export const SETTINGS_TRANSITIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/settings-transitions`;
export const SHUTDOWN_CHECKPOINTS_PATH = `${GRIMOIRE_CONTROL_PATH}/shutdown-checkpoints`;

