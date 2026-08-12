import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';

import type { ExecutionInteractionPresentationPort } from '@/app/runtime/ExecutionInteractionPresentationStore';

import type {
  ClaudeInteractionBridge,
  ClaudePreparedInteraction,
  ClaudeToolPermissionOptions,
} from './ClaudeExecutionBackend';

interface MappedResponse {
  readonly responseId: string;
  readonly label: string;
  readonly description?: string;
  readonly result: PermissionResult;
}

const MAX_TITLE_LENGTH = 512;
const MAX_DESCRIPTION_LENGTH = 8 * 1024;
const APPROVAL_TOOLS = new Set([
  'Bash',
  'BashOutput',
  'KillShell',
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
]);

/**
 * Maps Claude SDK tool-permission, question, and plan-exit callbacks into
 * bounded application interaction presentations without owning lifecycle state.
 */
export class ClaudeInteractionPresentationBridge implements ClaudeInteractionBridge {
  constructor(private readonly presentations: ExecutionInteractionPresentationPort) {}

  async prepare(input: {
    readonly toolName: string;
    readonly toolInput: Readonly<Record<string, unknown>>;
    readonly options: ClaudeToolPermissionOptions;
    readonly allowedTools?: readonly string[];
  }): Promise<ClaudePreparedInteraction> {
    const kind = classifyTool(input.toolName, input.options);
    if (kind === 'plan-decision') {
      return this.preparePlanDecision(input);
    }
    if (kind === 'question') {
      return this.prepareQuestion(input);
    }
    return this.prepareApproval(input);
  }

  private async prepareApproval(input: {
    readonly toolName: string;
    readonly toolInput: Readonly<Record<string, unknown>>;
    readonly options: ClaudeToolPermissionOptions;
    readonly allowedTools?: readonly string[];
  }): Promise<ClaudePreparedInteraction> {
    const title = requireTitle(input.options.title ?? `Approve ${input.toolName}`);
    const description = optionalDescription(
      input.options.description ?? describeToolInput(input.toolName, input.toolInput),
    );
    const mapped: MappedResponse[] = [
      {
        responseId: 'allow',
        label: 'Allow once',
        description: 'Allow this tool use',
        result: { behavior: 'allow', updatedInput: { ...input.toolInput } },
      },
      {
        responseId: 'deny',
        label: 'Deny',
        description: 'Block this tool use',
        result: { behavior: 'deny', message: 'Denied by user' },
      },
    ];
    return this.commit('approval', title, description, mapped);
  }

  private async prepareQuestion(input: {
    readonly toolName: string;
    readonly toolInput: Readonly<Record<string, unknown>>;
    readonly options: ClaudeToolPermissionOptions;
  }): Promise<ClaudePreparedInteraction> {
    const title = requireTitle(input.options.title ?? 'Provider question');
    const description = optionalDescription(input.options.description);
    const options = readQuestionOptions(input.toolInput);
    const mapped: MappedResponse[] = options.length > 0
      ? options.map((option, index) => ({
        responseId: `option-${index + 1}`,
        label: option,
        result: { behavior: 'allow', updatedInput: { ...input.toolInput, answer: option } },
      }))
      : [
        {
          responseId: 'respond',
          label: 'Respond',
          result: { behavior: 'allow', updatedInput: { ...input.toolInput, answer: '' } },
        },
        {
          responseId: 'deny',
          label: 'Decline',
          result: { behavior: 'deny', message: 'Declined by user' },
        },
      ];
    return this.commit('question', title, description, mapped);
  }

  private async preparePlanDecision(input: {
    readonly toolName: string;
    readonly toolInput: Readonly<Record<string, unknown>>;
    readonly options: ClaudeToolPermissionOptions;
  }): Promise<ClaudePreparedInteraction> {
    const title = requireTitle(input.options.title ?? 'Exit plan mode?');
    const description = optionalDescription(input.options.description);
    const mapped: MappedResponse[] = [
      {
        responseId: 'accept',
        label: 'Accept plan',
        description: 'Exit plan mode and proceed',
        result: { behavior: 'allow', updatedInput: { ...input.toolInput } },
      },
      {
        responseId: 'reject',
        label: 'Continue planning',
        description: 'Stay in plan mode',
        result: { behavior: 'deny', message: 'Continue planning' },
      },
    ];
    return this.commit('plan-decision', title, description, mapped);
  }

  private async commit(
    kind: 'approval' | 'question' | 'plan-decision',
    title: string,
    description: string | undefined,
    mapped: readonly MappedResponse[],
  ): Promise<ClaudePreparedInteraction> {
    const { presentationRef } = await this.presentations.store({
      kind,
      title,
      ...(description ? { description } : {}),
      options: mapped.map(option => ({
        responseId: option.responseId,
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })),
    });
    const byId = new Map(mapped.map(option => [option.responseId, option]));
    const providerResolvedResponseId = mapped[mapped.length - 1].responseId;
    return Object.freeze({
      kind,
      presentationRef,
      responseIds: Object.freeze(mapped.map(option => option.responseId)),
      providerResolvedResponseId,
      resolve: async (responseId: string): Promise<PermissionResult> => (
        byId.get(responseId)?.result ?? { behavior: 'deny', message: 'Cancelled' }
      ),
      cancel: async (): Promise<PermissionResult> => (
        byId.get(providerResolvedResponseId)?.result
          ?? { behavior: 'deny', message: 'Cancelled' }
      ),
    });
  }
}

function classifyTool(
  toolName: string,
  options: ClaudeToolPermissionOptions,
): 'approval' | 'question' | 'plan-decision' {
  if (/plan/i.test(options.title ?? '') || /exit.*plan|plan.*mode/i.test(options.description ?? '')) {
    return 'plan-decision';
  }
  if (/question|ask/i.test(toolName) || options.suggestions !== undefined) {
    return 'question';
  }
  return APPROVAL_TOOLS.has(toolName) ? 'approval' : 'approval';
}

function readQuestionOptions(toolInput: Readonly<Record<string, unknown>>): readonly string[] {
  const raw = toolInput.options;
  if (!Array.isArray(raw)) return [];
  const options: string[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      options.push(entry);
    } else if (entry !== null && typeof entry === 'object' && 'label' in entry) {
      const label = (entry as Record<string, unknown>).label;
      if (typeof label === 'string') options.push(label);
    }
  }
  return options;
}

function describeToolInput(toolName: string, input: Readonly<Record<string, unknown>>): string | undefined {
  if (toolName === 'Bash' && typeof input.command === 'string') {
    return input.command.trim() || undefined;
  }
  if ((toolName === 'Write' || toolName === 'Edit') && typeof input.file_path === 'string') {
    return input.file_path.trim() || undefined;
  }
  return undefined;
}

function requireTitle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Claude interaction title is empty.');
  if (trimmed.length > MAX_TITLE_LENGTH) throw new Error('Claude interaction title is too long.');
  return trimmed;
}

function optionalDescription(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) throw new Error('Claude interaction description is too long.');
  return trimmed;
}
