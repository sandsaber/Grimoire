import type {
  AgentPermissionRequest,
  EffectiveAgentPolicy,
  PermissionBoundary,
} from './AgentContracts';

export interface AgentPolicyInputs {
  readonly provider: PermissionBoundary;
  readonly workspace: PermissionBoundary;
  readonly root: PermissionBoundary;
  readonly parent?: PermissionBoundary;
  readonly definition: AgentPermissionRequest;
}

export function resolveEffectiveAgentPolicy(inputs: AgentPolicyInputs): EffectiveAgentPolicy {
  const boundaries = [inputs.provider, inputs.workspace, inputs.root, inputs.parent]
    .filter((entry): entry is PermissionBoundary => entry !== undefined)
    .map(normalizeBoundary);
  const request = normalizeRequest(inputs.definition);
  const granted: string[] = [];
  const approvable: string[] = [];
  const denied: string[] = [];

  for (const permission of request.requested) {
    if (boundaries.every(boundary => boundary.granted.has(permission))) {
      granted.push(permission);
      continue;
    }
    if (request.approvable.has(permission)
      && boundaries.every(boundary => boundary.ceiling.has(permission))) {
      approvable.push(permission);
      continue;
    }
    denied.push(permission);
  }

  return Object.freeze({
    granted: Object.freeze(granted),
    approvable: Object.freeze(approvable),
    denied: Object.freeze(denied),
  });
}

export function approveAgentPermission(
  policy: EffectiveAgentPolicy,
  permission: string,
): EffectiveAgentPolicy {
  requirePermission(permission);
  if (!policy.approvable.includes(permission)) {
    throw new Error(`Permission "${permission}" is outside the approvable allowance.`);
  }
  return Object.freeze({
    granted: Object.freeze(sortUnique([...policy.granted, permission])),
    approvable: Object.freeze(policy.approvable.filter(entry => entry !== permission)),
    denied: Object.freeze([...policy.denied]),
  });
}

function normalizeBoundary(boundary: PermissionBoundary): {
  granted: ReadonlySet<string>;
  ceiling: ReadonlySet<string>;
} {
  const granted = sortUnique(boundary.granted);
  const approvable = sortUnique(boundary.approvable);
  ensureDisjoint(granted, approvable, 'Permission boundary');
  return {
    granted: new Set(granted),
    ceiling: new Set([...granted, ...approvable]),
  };
}

function normalizeRequest(request: AgentPermissionRequest): {
  requested: readonly string[];
  approvable: ReadonlySet<string>;
} {
  const requested = sortUnique(request.requested);
  const approvable = sortUnique(request.approvable);
  if (approvable.some(permission => !requested.includes(permission))) {
    throw new Error('Definition approvable permissions must be requested.');
  }
  return { requested, approvable: new Set(approvable) };
}

function sortUnique(values: readonly string[]): string[] {
  const normalized = values.map(value => {
    requirePermission(value);
    return value;
  }).sort();
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Permissions must not contain duplicates.');
  }
  return normalized;
}

function ensureDisjoint(
  left: readonly string[],
  right: readonly string[],
  label: string,
): void {
  const leftSet = new Set(left);
  if (right.some(entry => leftSet.has(entry))) {
    throw new Error(`${label} granted and approvable permissions must be disjoint.`);
  }
}

function requirePermission(value: string): void {
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(value)) {
    throw new Error('Permission must be a constrained lowercase identifier.');
  }
}
