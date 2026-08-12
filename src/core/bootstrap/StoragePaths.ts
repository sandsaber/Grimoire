export const GRIMOIRE_STORAGE_PATH = '.grimoire';

export const GRIMOIRE_SETTINGS_PATH = `${GRIMOIRE_STORAGE_PATH}/grimoire-settings.json`;
export const GRIMOIRE_CONTROL_PATH = `${GRIMOIRE_STORAGE_PATH}/control`;
export const CONVERSATION_RECORDS_PATH = `${GRIMOIRE_CONTROL_PATH}/conversations`;
export const TRANSACTION_INTENTS_PATH = `${GRIMOIRE_CONTROL_PATH}/transaction-intents`;
export const PROVIDER_SETTINGS_TRANSACTION_INTENTS_PATH =
  `${TRANSACTION_INTENTS_PATH}/provider-settings`;
export const PROVIDER_SETTINGS_STAGING_PATH = `${GRIMOIRE_STORAGE_PATH}/settings-transactions`;
export const EXECUTION_SESSIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/execution-sessions`;
export const EXECUTION_RUNS_PATH = `${GRIMOIRE_CONTROL_PATH}/execution-runs`;
export const EXECUTION_INTERACTIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/interactions`;
export const EXECUTION_RECONCILIATIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/reconciliations`;
export const SETTINGS_TRANSITIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/settings-transitions`;
export const SHUTDOWN_CHECKPOINTS_PATH = `${GRIMOIRE_CONTROL_PATH}/shutdown-checkpoints`;
export const AGENT_INSTANCES_PATH = `${GRIMOIRE_CONTROL_PATH}/agent-instances`;
export const AGENT_RUNS_PATH = `${GRIMOIRE_CONTROL_PATH}/agent-runs`;
export const AGENT_DISPATCH_INTENTS_PATH = `${GRIMOIRE_CONTROL_PATH}/agent-dispatch-intents`;
export const AGENT_RESULTS_PATH = `${GRIMOIRE_CONTROL_PATH}/agent-results`;
export const AGENT_TRANSACTIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/agent-transactions`;
export const WORK_GRAPH_REVISIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/work-graph-revisions`;
export const WORK_GRAPH_HEADS_PATH = `${GRIMOIRE_CONTROL_PATH}/work-graph-heads`;
export const WORK_GRAPH_EXECUTIONS_PATH = `${GRIMOIRE_CONTROL_PATH}/work-graph-executions`;

export const LEGACY_SESSIONS_PATH = '.claude/sessions';
export const SESSIONS_PATH = `${GRIMOIRE_STORAGE_PATH}/sessions`;
