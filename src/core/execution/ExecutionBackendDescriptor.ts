import type { ProviderId } from '../types/provider';

/**
 * Identity of an executable resource, independent of any provider.
 *
 * Provider identity is association metadata, not the identity of everything the
 * application can execute: a local shell and a title-generation probe are runs
 * with owners and terminals like any other, and neither belongs to a provider.
 * Modelling that association as a tagged union — rather than assuming a
 * `providerId` everywhere — is what lets internal backends exist without a fake
 * provider to hang them on.
 */

declare const executionBackendIdBrand: unique symbol;
declare const internalExecutionServiceIdBrand: unique symbol;

export type ExecutionBackendId = string & {
  readonly [executionBackendIdBrand]: true;
};

/**
 * Branded, not a closed enum: internal services are validated by application
 * composition, so adding one does not mean editing a core union.
 */
export type InternalExecutionServiceId = string & {
  readonly [internalExecutionServiceIdBrand]: true;
};

export interface ExecutionBackendDescriptor {
  readonly backendId: ExecutionBackendId;
  readonly association:
    | { readonly kind: 'provider'; readonly providerId: ProviderId }
    | { readonly kind: 'internal'; readonly service: InternalExecutionServiceId };
}

/**
 * Creates a backend for a composed context.
 *
 * The abstraction deliberately says nothing about processes: an SDK stream, an
 * app-server daemon, an ACP subprocess, a stateless process, and a local shell
 * all fit through composition rather than inheritance.
 */
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
