import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type { QwenEffortLevel } from '@/providers/qwen/settings';

import type { QwenExecutionDynamicApplier } from './QwenExecutionBackend';

export interface QwenAcpDynamicConfig {
  readonly modelId?: string;
  readonly modeId?: string;
  readonly effortLevel?: QwenEffortLevel;
}

export interface QwenAcpDynamicConfigResolver {
  resolve(dynamicRef: string): Promise<QwenAcpDynamicConfig>;
}

interface AppliedConfig {
  effortLevel?: QwenEffortLevel;
  modeId?: string;
  modelId?: string;
}

/** Applies Qwen's native model, mode, and slash-command effort controls in wire order. */
export class QwenAcpDynamicConfigApplier implements QwenExecutionDynamicApplier {
  private readonly appliedByClient = new WeakMap<ManagedAcpClient, Map<string, AppliedConfig>>();

  constructor(private readonly resolver: QwenAcpDynamicConfigResolver) {}

  async apply(input: Parameters<QwenExecutionDynamicApplier['apply']>[0]): Promise<void> {
    if (!input.dynamicRef) return;
    const requested = await this.resolver.resolve(input.dynamicRef);
    const applied = this.sessionState(input.client, input.sessionId);

    throwIfAborted(input.signal);
    const modelId = requested.modelId?.trim();
    if (modelId && modelId !== applied.modelId) {
      if (!input.client.setModel) throw new Error('Qwen ACP model selection is unavailable.');
      await input.client.setModel({ modelId, sessionId: input.sessionId });
      applied.modelId = modelId;
    }

    throwIfAborted(input.signal);
    const modeId = requested.modeId?.trim();
    if (modeId && modeId !== applied.modeId) {
      if (!input.client.setMode) throw new Error('Qwen ACP mode selection is unavailable.');
      await input.client.setMode({ modeId, sessionId: input.sessionId });
      applied.modeId = modeId;
    }

    throwIfAborted(input.signal);
    const effortLevel = requested.effortLevel;
    if (effortLevel && effortLevel !== applied.effortLevel) {
      const controlOutput: string[] = [];
      let controlBytes = 0;
      const unsubscribe = input.client.onSessionNotification(notification => {
        const update = notification.update;
        if (notification.sessionId !== input.sessionId
          || update.sessionUpdate !== 'agent_message_chunk'
          || update.content.type !== 'text'
          || controlBytes >= MAX_CONTROL_OUTPUT_BYTES) return;
        const remaining = MAX_CONTROL_OUTPUT_BYTES - controlBytes;
        const chunk = truncateUtf8(update.content.text, remaining);
        controlOutput.push(chunk);
        controlBytes += Buffer.byteLength(chunk, 'utf8');
      });
      let response: Awaited<ReturnType<ManagedAcpClient['prompt']>>;
      try {
        response = await input.client.prompt({
          prompt: [{ text: `/effort ${effortLevel}`, type: 'text' }],
          sessionId: input.sessionId,
        });
      } finally {
        unsubscribe();
      }
      if (/cancel|error|fail/i.test(response.stopReason)
        || /(unknown reasoning effort|configuration not available|settings service not available|\berror\b|\bfailed\b)/i
          .test(controlOutput.join(''))) {
        throw new Error('Qwen ACP effort selection was rejected.');
      }
      applied.effortLevel = effortLevel;
    }
  }

  private sessionState(client: ManagedAcpClient, sessionId: string): AppliedConfig {
    let sessions = this.appliedByClient.get(client);
    if (!sessions) {
      sessions = new Map();
      this.appliedByClient.set(client, sessions);
    }
    let state = sessions.get(sessionId);
    if (!state) {
      state = {};
      sessions.set(sessionId, state);
    }
    return state;
  }
}

const MAX_CONTROL_OUTPUT_BYTES = 4 * 1024;

function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) return value;
  let end = Math.min(value.length, maximumBytes);
  while (end > 0 && Buffer.byteLength(value.slice(0, end), 'utf8') > maximumBytes) end -= 1;
  return value.slice(0, end);
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error('Qwen dynamic configuration aborted.');
}
