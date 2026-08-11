const PROHIBITED_KEYS = new Set([
  'prompt',
  'systemprompt',
  'hiddenreasoning',
  'reasoning',
  'thinking',
  'environment',
  'env',
  'environmentvariables',
  'environmentdigestinput',
  'stdout',
  'stderr',
  'shelloutput',
  'rawpayload',
  'rawproviderpayload',
  'rawprotocolpayload',
  'requestbody',
  'responsebody',
  'apikey',
  'secret',
  'secretvalue',
]);

export class ControlRecordPayloadError extends Error {
  constructor(readonly payloadPath: string) {
    super(`Control record contains prohibited payload at "${payloadPath}".`);
    this.name = 'ControlRecordPayloadError';
  }
}

export function validateControlRecordPayload(value: unknown): void {
  visit(value, '$', new Set<object>());
}

function visit(value: unknown, path: string, ancestors: Set<object>): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (ancestors.has(value)) {
    throw new Error(`Control record contains a cycle at "${path}".`);
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, `${path}[${index}]`, ancestors));
  } else {
    for (const [key, entry] of Object.entries(value)) {
      const normalizedKey = key.replace(/[-_]/g, '').toLowerCase();
      if (PROHIBITED_KEYS.has(normalizedKey)) {
        throw new ControlRecordPayloadError(`${path}.${key}`);
      }
      visit(entry, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}
