import type { StreamChunk } from '@/core/types';

import { isRecord } from '../runtime/CommandcodeStream';

const TOOL_NAMES: Record<string, string> = {
  read_file: 'Read', write_file: 'Write', edit_file: 'Edit', shell: 'Bash', shell_command: 'Bash',
  grep: 'Grep', glob: 'Glob', web_fetch: 'WebFetch', web_search: 'WebSearch',
};

export class CommandcodeContentPresenter {
  sessionId: string | undefined;

  constructor(private readonly contextWindow: () => number = () => 200_000) {}

  present(payload: unknown): readonly StreamChunk[] {
    if (!isRecord(payload)) return [];
    if (payload.type === 'session' && typeof payload.sessionId === 'string') {
      this.sessionId = payload.sessionId;
      return [];
    }
    if (payload.type === 'model_request_end' && isRecord(payload.usage)) {
      const input = payload.usage.inputTokens;
      const window = this.contextWindow();
      if (typeof input === 'number' && Number.isFinite(input) && input >= 0 && window > 0) {
        // inputTokens already includes cache reads in the observed CLI usage object.
        return [{ type: 'usage', sessionId: this.sessionId, usage: {
          model: typeof payload.model === 'string' ? payload.model : undefined,
          inputTokens: input, contextTokens: input, contextWindow: window,
          contextWindowIsAuthoritative: false, percentage: input / window * 100,
        } }];
      }
    }
    const id = typeof payload.toolCallId === 'string' ? payload.toolCallId : '';
    if (payload.type === 'tool_queued' && id && typeof payload.toolName === 'string') {
      return [{ type: 'tool_use', id, name: TOOL_NAMES[payload.toolName] ?? payload.toolName,
        input: isRecord(payload.input) ? payload.input : {} }];
    }
    if (payload.type === 'tool_completed' && id) {
      const content = Array.isArray(payload.result) ? payload.result
        .filter(isRecord).filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text).join('\n') : '';
      return [{ type: 'tool_result', id, content }];
    }
    if (payload.type === 'tool_errored' && id) {
      return [{ type: 'tool_result', id, content: typeof payload.error === 'string' ? payload.error : 'Tool failed.', isError: true }];
    }
    if (payload.type === 'tool_hook_blocked' && id) {
      return [{ type: 'tool_result', id,
        content: typeof payload.hookOutput === 'string' ? payload.hookOutput : 'Tool blocked by Command Code.',
        isError: true }];
    }
    if (payload.type === 'tool_denied' && id) {
      return [{ type: 'tool_result', id, content: 'Denied by Command Code permission rules.', isError: true }];
    }
    return [];
  }
}
