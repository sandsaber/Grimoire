/**
 * What one Antigravity print request needs, carried across the kernel.
 *
 * The kernel treats `requestRef` as an opaque string and never looks inside,
 * so this is the provider's own encoding of it. Only what the turn decided
 * lives here — prompt and model. Everything ambient at dispatch time (the
 * resolved CLI path, the vault directory, the environment, the permission
 * mode) is read when the run is resolved, not frozen when it was queued.
 */
export interface AntigravityRequest {
  readonly prompt: string;
  readonly model: string | null;
}

interface EncodedAntigravityRequest {
  readonly schemaVersion: 1;
  readonly prompt: string;
  readonly model: string | null;
}

export function encodeAntigravityRequestRef(request: AntigravityRequest): string {
  const encoded: EncodedAntigravityRequest = {
    schemaVersion: 1,
    prompt: request.prompt,
    model: request.model,
  };
  return JSON.stringify(encoded);
}

/**
 * Throws on anything it does not recognize.
 *
 * The backend turns a rejected resolve into `invalidated` /
 * `pre-dispatch-rejected` — the turn never reached the provider — which is the
 * honest terminal for a reference this build cannot read.
 */
export function decodeAntigravityRequestRef(requestRef: string): AntigravityRequest {
  const parsed: unknown = JSON.parse(requestRef);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Antigravity request reference is not an object.');
  }
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new Error('Antigravity request reference has an unsupported schema version.');
  }
  if (typeof record.prompt !== 'string') {
    throw new Error('Antigravity request reference has no prompt.');
  }
  if (record.model !== null && typeof record.model !== 'string') {
    throw new Error('Antigravity request reference has an invalid model.');
  }
  return { prompt: record.prompt, model: record.model };
}
