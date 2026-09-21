import { extractAcpSessionModelState, extractAcpSessionThoughtLevelState } from '@/providers/acp/AcpSessionConfig';

import type { PiExecutionDynamicApplier } from './PiExecutionBackend';

export interface PiAcpDynamicConfig {
  readonly modelId?: string;
  readonly thinking?: string;
}

export class PiAcpDynamicConfigApplier implements PiExecutionDynamicApplier {
  constructor(private readonly resolve: (ref: string) => Promise<PiAcpDynamicConfig>) {}

  async apply(input: Parameters<PiExecutionDynamicApplier['apply']>[0]): Promise<void> {
    if (!input.dynamicRef) return;
    const config = await this.resolve(input.dynamicRef);
    input.signal.throwIfAborted();
    if (config.modelId) {
      const response = await input.client.setConfigOption({ sessionId: input.sessionId,
        configId: 'model', type: 'select', value: config.modelId });
      if (extractAcpSessionModelState(response).currentModelId !== config.modelId) {
        throw new Error('Pi did not apply the selected model.');
      }
      input.presentContent?.({ kind: 'session-config', session: { ...response, sessionId: input.sessionId } });
    }
    input.signal.throwIfAborted();
    if (config.thinking) {
      const response = await input.client.setConfigOption({ sessionId: input.sessionId,
        configId: 'thought_level', type: 'select', value: config.thinking });
      if (extractAcpSessionThoughtLevelState(response).currentLevel !== config.thinking) {
        throw new Error('Pi did not apply the selected thinking level.');
      }
      input.presentContent?.({ kind: 'session-config', session: { ...response, sessionId: input.sessionId } });
    }
    input.signal.throwIfAborted();
  }
}
