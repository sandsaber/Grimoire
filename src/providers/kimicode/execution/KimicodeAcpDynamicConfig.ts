import { extractAcpSessionThoughtLevelState } from '@/providers/acp/AcpSessionConfig';
import type { AcpSessionConfigOption } from '@/providers/acp/types';

import type { KimicodeExecutionDynamicApplier } from './KimicodeExecutionBackend';

export interface KimicodeAcpDynamicConfig {
  readonly modeId?: string;
  readonly modelId?: string;
  readonly effort?: {
    readonly configId: string;
    readonly value: string;
  };
  /**
   * The thinking level a turn wants, when nothing yet knows what to set it
   * through.
   *
   * A tab's first turn is composed before its session exists, so the config id
   * the level is set under — which the session names — is not known. The level
   * is carried on its own and resolved here against the options the session
   * answered with, rather than dropped for the first turn of every tab.
   */
  readonly effortValue?: string;
}

export interface KimicodeAcpDynamicConfigResolver {
  resolve(dynamicRef: string): Promise<KimicodeAcpDynamicConfig>;
}

/** Provider-owned config ordering layered over the protocol-generic ACP kernel. */
export class KimicodeAcpDynamicConfigApplier implements KimicodeExecutionDynamicApplier {
  constructor(private readonly resolver: KimicodeAcpDynamicConfigResolver) {}

  async apply(input: Parameters<KimicodeExecutionDynamicApplier['apply']>[0]): Promise<void> {
    if (!input.dynamicRef) return;
    const config = await this.resolver.resolve(input.dynamicRef);
    const effort = config.effort ?? this.resolveEffort(config.effortValue, input.sessionConfigOptions);
    throwIfAborted(input.signal);
    if (config.modeId?.trim()) {
      await input.client.setConfigOption({
        configId: 'mode',
        sessionId: input.sessionId,
        type: 'select',
        value: config.modeId.trim(),
      });
    }
    throwIfAborted(input.signal);
    if (config.modelId?.trim()) {
      await input.client.setConfigOption({
        configId: 'model',
        sessionId: input.sessionId,
        type: 'select',
        value: config.modelId.trim(),
      });
    }
    throwIfAborted(input.signal);
    if (effort?.configId.trim() && effort.value.trim()) {
      await input.client.setConfigOption({
        configId: effort.configId.trim(),
        sessionId: input.sessionId,
        type: 'select',
        value: effort.value.trim(),
      });
    }
  }

  /**
   * The config id a level is set under, read from what the session reported.
   *
   * Only for a level the turn could not resolve one for itself, and only when
   * the session actually offers it.
   *
   * **Whether Kimi Code offers one is not known here.** Its wire recording never
   * opened a session — the CLI answered `session/new` with "Authentication
   * required" — so nothing has ever seen its config options. What is known is
   * `KimicodeChatRuntime`: it reads a thought-level config id off whatever the
   * session reports and sets a level through it when there is one. That is the
   * behaviour this keeps, and it is right either way, which is the point of
   * asking the session rather than assuming — setting a level the agent does
   * not have is an error where dropping it is a default.
   */
  private resolveEffort(
    value: string | undefined,
    configOptions: readonly AcpSessionConfigOption[] | undefined,
  ): { readonly configId: string; readonly value: string } | undefined {
    if (!value?.trim() || !configOptions?.length) return undefined;
    const level = extractAcpSessionThoughtLevelState({ configOptions: [...configOptions] });
    if (!level.configId || !level.availableLevels.some(entry => entry.id === value.trim())) {
      return undefined;
    }
    return { configId: level.configId, value: value.trim() };
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Kimi Code dynamic configuration aborted.');
}
