declare const workGraphIdBrand: unique symbol;
declare const workGraphRevisionIdBrand: unique symbol;
declare const workGraphExecutionIdBrand: unique symbol;
declare const workNodeIdBrand: unique symbol;

export type WorkGraphId = string & { readonly [workGraphIdBrand]: true };
export type WorkGraphRevisionId = string & { readonly [workGraphRevisionIdBrand]: true };
export type WorkGraphExecutionId = string & { readonly [workGraphExecutionIdBrand]: true };
export type WorkNodeId = string & { readonly [workNodeIdBrand]: true };

export function workGraphId(value: string): WorkGraphId {
  return requireOpaqueId(value, 'wg') as WorkGraphId;
}

export function workGraphRevisionId(value: string): WorkGraphRevisionId {
  return requireOpaqueId(value, 'wgr') as WorkGraphRevisionId;
}

export function workGraphExecutionId(value: string): WorkGraphExecutionId {
  return requireOpaqueId(value, 'wge') as WorkGraphExecutionId;
}

export function workNodeId(value: string): WorkNodeId {
  return requireOpaqueId(value, 'wn') as WorkNodeId;
}

function requireOpaqueId(value: string, prefix: string): string {
  if (!new RegExp(`^${prefix}-[0-9a-f]{32}$`).test(value)) {
    throw new Error(`${prefix} id must be an opaque 32-hex identifier.`);
  }
  return value;
}
