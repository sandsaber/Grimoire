declare const agentInstanceIdBrand: unique symbol;
declare const agentRunIdBrand: unique symbol;
declare const agentResultIdBrand: unique symbol;
declare const agentDispatchTokenBrand: unique symbol;
declare const nativeAgentAdoptionKeyBrand: unique symbol;

export type AgentInstanceId = string & { readonly [agentInstanceIdBrand]: true };
export type AgentRunId = string & { readonly [agentRunIdBrand]: true };
export type AgentResultId = string & { readonly [agentResultIdBrand]: true };
export type AgentDispatchToken = string & { readonly [agentDispatchTokenBrand]: true };
export type NativeAgentAdoptionKey = string & { readonly [nativeAgentAdoptionKeyBrand]: true };

export function agentInstanceId(value: string): AgentInstanceId {
  return requireOpaqueId(value, 'agi') as AgentInstanceId;
}

export function agentRunId(value: string): AgentRunId {
  return requireOpaqueId(value, 'agr') as AgentRunId;
}

export function agentResultId(value: string): AgentResultId {
  return requireOpaqueId(value, 'ares') as AgentResultId;
}

export function agentDispatchToken(value: string): AgentDispatchToken {
  return requireOpaqueId(value, 'adt') as AgentDispatchToken;
}

export function nativeAgentAdoptionKey(value: string): NativeAgentAdoptionKey {
  return requireOpaqueId(value, 'nad') as NativeAgentAdoptionKey;
}

export function adoptedAgentInstanceId(key: NativeAgentAdoptionKey): AgentInstanceId {
  return agentInstanceId(`agi-${key.slice('nad-'.length)}`);
}

function requireOpaqueId(value: string, prefix: string): string {
  if (!new RegExp(`^${prefix}-[0-9a-f]{32}$`).test(value)) {
    throw new Error(`${prefix} id must be an opaque 32-hex identifier.`);
  }
  return value;
}
