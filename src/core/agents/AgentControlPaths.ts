import { GRIMOIRE_CONTROL_PATH } from '../execution/ExecutionControlPaths';

/**
 * Vault paths for the agent domain's durable records.
 *
 * **Its own module for the reason `ExecutionControlPaths` is its own module**,
 * one level further down: that file is reachable from `src/main.ts` through the
 * kernel, so declaring these there put four dead string literals into every
 * shipped bundle before anything could read them. It was written there first,
 * and the comment on that module — warning about exactly this, one level up —
 * is what caught it.
 *
 * **Five, not eight.** The harvest these come from declared three more for work
 * graphs, and M5 bans those outright: a graph, its scheduler and its synthesis
 * runs are post-migration scope, built when a real dependent workflow exists. A
 * path is the cheapest thing to add and the hardest to remove once a vault in
 * the field has written under it, so the banned three are not declared at all.
 */

export const AGENT_INSTANCES_PATH = `${GRIMOIRE_CONTROL_PATH}/agent-instances`;
export const AGENT_RUNS_PATH = `${GRIMOIRE_CONTROL_PATH}/agent-runs`;
export const AGENT_DISPATCH_INTENTS_PATH = `${GRIMOIRE_CONTROL_PATH}/agent-dispatch-intents`;
export const AGENT_RESULTS_PATH = `${GRIMOIRE_CONTROL_PATH}/agent-results`;
/** Where a multi-record agent change records its intent before applying it. */
export const AGENT_TRANSACTIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/agent-transactions`;
