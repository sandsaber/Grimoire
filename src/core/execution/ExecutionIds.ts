declare const executionSessionIdBrand: unique symbol;
declare const sessionInstanceIdBrand: unique symbol;
declare const runIdBrand: unique symbol;
declare const interactionIdBrand: unique symbol;
declare const lifecycleLeaseIdBrand: unique symbol;

export type ExecutionSessionId = string & {
  readonly [executionSessionIdBrand]: true;
};

export type SessionInstanceId = string & {
  readonly [sessionInstanceIdBrand]: true;
};

export type RunId = string & {
  readonly [runIdBrand]: true;
};

export type InteractionId = string & {
  readonly [interactionIdBrand]: true;
};

export type LifecycleLeaseId = string & {
  readonly [lifecycleLeaseIdBrand]: true;
};

export function executionSessionId(value: string): ExecutionSessionId {
  return requireOpaqueId(value, 'es') as ExecutionSessionId;
}

export function sessionInstanceId(value: string): SessionInstanceId {
  return requireOpaqueId(value, 'si') as SessionInstanceId;
}

export function runId(value: string): RunId {
  return requireOpaqueId(value, 'run') as RunId;
}

export function interactionId(value: string): InteractionId {
  return requireOpaqueId(value, 'ix') as InteractionId;
}

export function lifecycleLeaseId(value: string): LifecycleLeaseId {
  return requireOpaqueId(value, 'lease') as LifecycleLeaseId;
}

function requireOpaqueId(value: string, prefix: string): string {
  if (!new RegExp(`^${prefix}-[0-9a-f]{32}$`).test(value)) {
    throw new Error(`${prefix} id must be an opaque 32-hex identifier.`);
  }
  return value;
}
