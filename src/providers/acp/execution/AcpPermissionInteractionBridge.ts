import type {
  AcpRequestPermissionRequest,
  AcpRequestPermissionResponse,
} from '../types';

export interface AcpPermissionPresentationPort {
  store(input: {
    readonly kind: 'approval';
    readonly title: string;
    readonly options: readonly {
      readonly responseId: string;
      readonly label: string;
      readonly description?: string;
    }[];
  }): Promise<{ readonly presentationRef: string }>;
}

export interface PreparedAcpPermissionInteraction {
  readonly kind: 'approval';
  readonly presentationRef: string;
  readonly responseIds: readonly string[];
  readonly providerResolvedResponseId: string;
  resolve(responseId: string): Promise<AcpRequestPermissionResponse>;
  cancel(): Promise<AcpRequestPermissionResponse>;
}

interface MappedPermissionOption {
  readonly responseId: string;
  readonly nativeOptionId: string;
  readonly label: string;
  readonly rejection: boolean;
}

/** Maps arbitrary ACP option identifiers into bounded application responses. */
export class AcpPermissionInteractionBridge {
  constructor(private readonly presentations: AcpPermissionPresentationPort) {}

  async prepare(
    request: AcpRequestPermissionRequest,
  ): Promise<PreparedAcpPermissionInteraction> {
    const mapped = mapOptions(request);
    const rejection = mapped.find(option => option.rejection);
    const providerResolvedResponseId = rejection?.responseId ?? 'cancel';
    const presentationOptions = mapped.map(option => ({
      responseId: option.responseId,
      label: option.label,
    }));
    if (!rejection) {
      presentationOptions.push({ responseId: providerResolvedResponseId, label: 'Cancel' });
    }
    const { presentationRef } = await this.presentations.store({
      kind: 'approval',
      title: requireTitle(request.toolCall.title),
      options: presentationOptions,
    });
    const byResponseId = new Map(mapped.map(option => [option.responseId, option]));
    const prepared: PreparedAcpPermissionInteraction = {
      kind: 'approval',
      presentationRef,
      responseIds: Object.freeze(presentationOptions.map(option => option.responseId)),
      providerResolvedResponseId,
      resolve: async (responseId: string): Promise<AcpRequestPermissionResponse> => {
        const option = byResponseId.get(responseId);
        if (!option) return cancelled();
        return {
          outcome: {
            optionId: option.nativeOptionId,
            outcome: 'selected',
          },
        };
      },
      cancel: async () => cancelled(),
    };
    return Object.freeze(prepared);
  }
}

function mapOptions(request: AcpRequestPermissionRequest): MappedPermissionOption[] {
  if (!Array.isArray(request.options)
    || Object.getPrototypeOf(request.options) !== Array.prototype
    || request.options.length === 0) {
    throw new Error('ACP permission request must declare response options.');
  }
  if (request.options.length > 64) {
    throw new Error('ACP permission request has too many response options.');
  }
  const nativeIds = new Set<string>();
  const mapped: MappedPermissionOption[] = [];
  for (let index = 0; index < request.options.length; index += 1) {
    const option = request.options[index];
    if (!option
      || typeof option.optionId !== 'string'
      || !boundedUtf8(option.optionId, 4_096)
      || nativeIds.has(option.optionId)) {
      throw new Error('ACP permission request contains invalid native option ids.');
    }
    nativeIds.add(option.optionId);
    if (typeof option.name !== 'string' || !boundedUtf8(option.name, 512)) {
      throw new Error('ACP permission request contains an invalid option label.');
    }
    if (!isPermissionOptionKind(option.kind)) {
      throw new Error('ACP permission request contains an invalid option kind.');
    }
    const label = option.name.trim();
    if (!label) throw new Error('ACP permission request contains an invalid option label.');
    mapped.push(Object.freeze({
      responseId: `option-${index + 1}`,
      nativeOptionId: option.optionId,
      label,
      rejection: option.kind === 'reject_once' || option.kind === 'reject_always',
    }));
  }
  return mapped;
}

function requireTitle(value: string | null | undefined): string {
  if (value !== null && value !== undefined && !boundedUtf8(value, 512)) {
    throw new Error('ACP permission request title is invalid.');
  }
  const title = value?.trim();
  return title || 'Provider permission request';
}

function boundedUtf8(value: string, maxBytes: number): boolean {
  return value.length > 0
    && value.length <= maxBytes
    && new TextEncoder().encode(value).byteLength <= maxBytes;
}

function isPermissionOptionKind(value: unknown): value is
  'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' {
  return value === 'allow_once'
    || value === 'allow_always'
    || value === 'reject_once'
    || value === 'reject_always';
}

function cancelled(): AcpRequestPermissionResponse {
  return { outcome: { outcome: 'cancelled' } };
}
