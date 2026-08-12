import type { ExecutionInteractionPresentationPort } from '@/app/runtime/ExecutionInteractionPresentationStore';

import type {
  CommandExecutionApprovalDecision,
  CommandExecutionApprovalResponse,
  FileChangeApprovalDecision,
  FileChangeApprovalResponse,
  GrantedPermissionProfile,
  PermissionGrantScope,
  PermissionsApprovalRequest,
  PermissionsApprovalResponse,
  UserInputQuestion,
  UserInputResponse,
} from '../runtime/codexAppServerTypes';
import type {
  CodexInteractionBridge,
  CodexPreparedInteraction,
} from './CodexExecutionBackend';

interface MappedApprovalOption {
  readonly responseId: string;
  readonly label: string;
  readonly description?: string;
  readonly decision: () => CommandExecutionApprovalDecision | FileChangeApprovalDecision;
}

interface MappedPermissionOption {
  readonly responseId: string;
  readonly label: string;
  readonly description?: string;
  readonly profile?: GrantedPermissionProfile;
  readonly scope?: PermissionGrantScope;
}

interface MappedQuestionOption {
  readonly responseId: string;
  readonly label: string;
  readonly description?: string;
  readonly questionId: string;
  readonly answer: string;
}

type ServerRequestMethod =
  | 'item/commandExecution/requestApproval'
  | 'item/fileChange/requestApproval'
  | 'item/permissions/requestApproval'
  | 'item/tool/requestUserInput';

const APPROVAL_METHODS: ReadonlySet<ServerRequestMethod> = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
]);

const MAX_TITLE_LENGTH = 512;
const MAX_DESCRIPTION_LENGTH = 8 * 1024;

/**
 * Maps Codex app-server approval and user-input requests into bounded
 * application interaction presentations without owning lifecycle state.
 */
export class CodexInteractionPresentationBridge implements CodexInteractionBridge {
  constructor(private readonly presentations: ExecutionInteractionPresentationPort) {}

  async prepare(input: {
    readonly method: string;
    readonly params: unknown;
  }): Promise<CodexPreparedInteraction> {
    if (input.method === 'item/tool/requestUserInput') {
      return this.prepareUserInput(input.params);
    }
    if (APPROVAL_METHODS.has(input.method as ServerRequestMethod)) {
      return this.prepareApproval(input.method as ServerRequestMethod, input.params);
    }
    throw new Error(`Codex interaction method "${input.method}" is unsupported.`);
  }

  private async prepareApproval(method: ServerRequestMethod, params: unknown): Promise<CodexPreparedInteraction> {
    if (method === 'item/permissions/requestApproval') {
      return this.preparePermissionsApproval(params);
    }
    if (method === 'item/commandExecution/requestApproval') {
      return this.prepareCommandApproval(params);
    }
    return this.prepareFileChangeApproval(params);
  }

  private async prepareCommandApproval(params: unknown): Promise<CodexPreparedInteraction> {
    const request = readRecord(params);
    const title = requireTitle(
      request?.command ? `Run command: ${stringField(request, 'command')}` : 'Approve command execution',
    );
    const description = optionalDescription(stringField(request, 'reason'));
    const available = arrayField(request, 'availableDecisions');
    const mapped = available.length > 0
      ? mapCommandDecisions(available)
      : defaultCommandDecisions();
    return this.commitApproval(title, description, mapped, responseId => ({
      decision: mapped.find(option => option.responseId === responseId)?.decision() ?? 'cancel',
    }));
  }

  private async prepareFileChangeApproval(params: unknown): Promise<CodexPreparedInteraction> {
    const request = readRecord(params);
    const title = requireTitle('Approve file change');
    const description = optionalDescription(stringField(request, 'reason'));
    const mapped: MappedApprovalOption[] = [
      mappedApproval('accept', 'Accept', 'Allow this file change', 'accept'),
      mappedApproval('accept-for-session', 'Accept for session', 'Allow for the rest of the session', 'acceptForSession'),
      mappedApproval('decline', 'Decline', 'Decline this file change', 'decline'),
    ];
    return this.commitApproval(title, description, mapped, responseId => ({
      decision: mapped.find(option => option.responseId === responseId)?.decision() ?? 'cancel',
    }));
  }

  private async preparePermissionsApproval(params: unknown): Promise<CodexPreparedInteraction> {
    const request = readRecord(params) as Partial<PermissionsApprovalRequest> | null;
    const title = requireTitle('Approve additional permissions');
    const description = optionalDescription(typeof request?.reason === 'string' ? request.reason : undefined);
    const requested = request?.permissions ?? null;
    const granted: GrantedPermissionProfile = {
      ...(requested?.fileSystem ? { fileSystem: requested.fileSystem } : {}),
      ...(requested?.network ? { network: requested.network } : {}),
    };
    const mapped: MappedPermissionOption[] = [
      {
        responseId: 'grant-turn',
        label: 'Allow once',
        description: 'Grant for this turn',
        profile: granted,
        scope: 'turn',
      },
      {
        responseId: 'grant-session',
        label: 'Allow for session',
        description: 'Grant for the rest of the session',
        profile: granted,
        scope: 'session',
      },
      {
        responseId: 'decline',
        label: 'Decline',
        description: 'Do not grant',
      },
    ];
    const { presentationRef } = await this.presentations.store({
      kind: 'approval',
      title,
      ...(description ? { description } : {}),
      options: mapped.map(option => ({
        responseId: option.responseId,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
    });
    const responseIds = Object.freeze(mapped.map(option => option.responseId));
    return Object.freeze({
      presentationRef,
      responseIds,
      providerResolvedResponseId: 'decline',
      resolve: async (responseId: string): Promise<PermissionsApprovalResponse> => {
        const option = mapped.find(candidate => candidate.responseId === responseId);
        if (!option) return { permissions: {} };
        return {
          permissions: option.profile ?? {},
          ...(option.scope ? { scope: option.scope } : {}),
        };
      },
      cancel: async (): Promise<PermissionsApprovalResponse> => ({ permissions: {} }),
    });
  }

  private async prepareUserInput(params: unknown): Promise<CodexPreparedInteraction> {
    const request = readRecord(params);
    const questions = arrayField(request, 'questions');
    if (questions.length === 0) {
      throw new Error('Codex user input request has no questions.');
    }
    const first = readRecord(questions[0]) as Partial<UserInputQuestion> | null;
    if (!first?.id) {
      throw new Error('Codex user input question is invalid.');
    }
    const title = requireTitle(first.header ?? first.question ?? 'Provider question');
    const description = optionalDescription(first.question);
    const mapped = mapQuestionOptions(first);
    if (mapped.length === 0) {
      mapped.push({ responseId: 'free-text', label: 'Respond', questionId: first.id, answer: '' });
    }
    const { presentationRef } = await this.presentations.store({
      kind: 'question',
      title,
      ...(description ? { description } : {}),
      options: mapped.map(option => ({
        responseId: option.responseId,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
    });
    const responseIds = Object.freeze(mapped.map(option => option.responseId));
    return Object.freeze({
      presentationRef,
      responseIds,
      providerResolvedResponseId: responseIds[0],
      resolve: async (responseId: string): Promise<UserInputResponse> => {
        const option = mapped.find(candidate => candidate.responseId === responseId);
        const questionId = option?.questionId ?? first.id!;
        const answer = option?.answer ?? '';
        return { answers: { [questionId]: { answers: [answer] } } };
      },
      cancel: async (): Promise<UserInputResponse> => ({ answers: {} }),
    });
  }

  private async commitApproval(
    title: string,
    description: string | undefined,
    mapped: readonly MappedApprovalOption[],
    resolveResponse: (responseId: string) => CommandExecutionApprovalResponse | FileChangeApprovalResponse,
  ): Promise<CodexPreparedInteraction> {
    const options = mapped.map(option => ({
      responseId: option.responseId,
      label: option.label,
      ...(option.description ? { description: option.description } : {}),
    }));
    if (!options.some(option => option.responseId === 'cancel')) {
      options.push({ responseId: 'cancel', label: 'Cancel' });
    }
    const { presentationRef } = await this.presentations.store({
      kind: 'approval',
      title,
      ...(description ? { description } : {}),
      options,
    });
    const responseIds = Object.freeze(options.map(option => option.responseId));
    return Object.freeze({
      presentationRef,
      responseIds,
      providerResolvedResponseId: 'cancel',
      resolve: async (responseId: string) => resolveResponse(responseId),
      cancel: async () => resolveResponse('cancel'),
    });
  }
}

function mapCommandDecisions(
  available: readonly unknown[],
): MappedApprovalOption[] {
  const mapped: MappedApprovalOption[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < available.length; index += 1) {
    const decision = available[index];
    const label = commandDecisionLabel(decision);
    const responseId = commandDecisionResponseId(decision, index);
    if (seen.has(responseId)) continue;
    seen.add(responseId);
    mapped.push(mappedApproval(
      responseId,
      label,
      undefined,
      decision as CommandExecutionApprovalDecision,
    ));
  }
  return mapped;
}

function defaultCommandDecisions(): MappedApprovalOption[] {
  return [
    mappedApproval('accept', 'Accept', 'Allow this command', 'accept'),
    mappedApproval('accept-for-session', 'Accept for session', 'Allow for the session', 'acceptForSession'),
    mappedApproval('decline', 'Decline', 'Decline this command', 'decline'),
  ];
}

function mappedApproval(
  responseId: string,
  label: string,
  description: string | undefined,
  decision: CommandExecutionApprovalDecision | FileChangeApprovalDecision,
): MappedApprovalOption {
  return Object.freeze({
    responseId,
    label,
    ...(description ? { description } : {}),
    decision: () => decision,
  });
}

function commandDecisionLabel(decision: unknown): string {
  if (decision === 'accept') return 'Accept';
  if (decision === 'acceptForSession') return 'Accept for session';
  if (decision === 'decline') return 'Decline';
  if (decision === 'cancel') return 'Cancel';
  if (typeof decision === 'object' && decision !== null) {
    if ('acceptWithExecpolicyAmendment' in decision) return 'Accept with policy';
    if ('applyNetworkPolicyAmendment' in decision) return 'Accept with network policy';
  }
  return 'Approve';
}

function commandDecisionResponseId(decision: unknown, index: number): string {
  if (decision === 'accept') return 'accept';
  if (decision === 'acceptForSession') return 'accept-for-session';
  if (decision === 'decline') return 'decline';
  if (decision === 'cancel') return 'cancel';
  return `decision-${index + 1}`;
}

function mapQuestionOptions(question: Partial<UserInputQuestion> | null): MappedQuestionOption[] {
  const options = question?.options;
  if (!Array.isArray(options)) return [];
  const mapped: MappedQuestionOption[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < options.length; index += 1) {
    const option = readRecord(options[index]);
    const label = stringField(option, 'label') ?? `Option ${index + 1}`;
    const description = stringField(option, 'description');
    const answer = label;
    const responseId = `option-${index + 1}`;
    if (seen.has(responseId)) continue;
    seen.add(responseId);
    mapped.push(Object.freeze({
      responseId,
      label,
      ...(description ? { description } : {}),
      questionId: question?.id ?? '',
      answer,
    }));
  }
  return mapped;
}

function requireTitle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Codex interaction title is empty.');
  if (trimmed.length > MAX_TITLE_LENGTH) throw new Error('Codex interaction title is too long.');
  return trimmed;
}

function optionalDescription(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) throw new Error('Codex interaction description is too long.');
  return trimmed;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(record: Record<string, unknown> | null, field: string): string | undefined {
  if (!record) return undefined;
  const value = record[field];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function arrayField(record: Record<string, unknown> | null, field: string): readonly unknown[] {
  if (!record) return [];
  const value = record[field];
  return Array.isArray(value) ? value : [];
}
