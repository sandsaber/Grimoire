import type { ProviderId } from '../types/provider';

declare const executionBackendIdBrand: unique symbol;
declare const internalExecutionServiceIdBrand: unique symbol;

export type ExecutionBackendId = string & {
  readonly [executionBackendIdBrand]: true;
};

export type InternalExecutionServiceId = string & {
  readonly [internalExecutionServiceIdBrand]: true;
};

export interface ExecutionBackendDescriptor {
  readonly backendId: ExecutionBackendId;
  readonly association:
    | { readonly kind: 'provider'; readonly providerId: ProviderId }
    | { readonly kind: 'internal'; readonly service: InternalExecutionServiceId };
}

export interface ExecutionBackendFactory<TContext = unknown, TBackend = unknown> {
  readonly descriptor: ExecutionBackendDescriptor;
  create(context: TContext): Promise<TBackend>;
}

export function executionBackendId(value: string): ExecutionBackendId {
  return requireIdentifier(value, 'Execution backend id') as ExecutionBackendId;
}

export function internalExecutionServiceId(value: string): InternalExecutionServiceId {
  return requireIdentifier(value, 'Internal execution service id') as InternalExecutionServiceId;
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}
