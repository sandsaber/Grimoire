import { JsonRpcErrorResponse } from '@/providers/acp';
import type { ManagedAcpExecutionDynamicApplier } from '@/providers/acp/execution/ManagedAcpExecutionBackend';
import type { AcpSessionConfigOption } from '@/providers/acp/types';
import { resolveGrokAcpModeId } from '@/providers/grok/modes';

/** What one Grok turn asks its session to be set to, once the session exists. */
export interface GrokAcpDynamicConfig {
  readonly modeId?: string;
  readonly modelId?: string;
}

export interface GrokAcpDynamicConfigResolver {
  resolve(dynamicRef: string): Promise<GrokAcpDynamicConfig>;
}

/**
 * Grok's own ordering, over the protocol-generic ACP kernel.
 *
 * Where OpenCode sets everything through `session/set_config_option`, Grok has
 * dedicated methods and does not always have them: a release that carries its
 * policy on the command line answers `-32601 method not found` for the mode,
 * and the fall-back is the config option the session advertised. An agent that
 * refuses the value itself answers `-32602`, which is not a failure of the turn
 * — it is the agent saying it has no such mode, and the turn proceeds on the
 * one it has.
 *
 * The reasoning effort and the permission policy are absent on purpose: Grok
 * takes both as process arguments, so they belong to the launch key and a
 * change to either restarts the process rather than reconfiguring a session.
 */
export class GrokAcpDynamicConfigApplier implements ManagedAcpExecutionDynamicApplier {
  constructor(private readonly resolver: GrokAcpDynamicConfigResolver) {}

  async apply(input: Parameters<ManagedAcpExecutionDynamicApplier['apply']>[0]): Promise<void> {
    if (!input.dynamicRef) return;
    const config = await this.resolver.resolve(input.dynamicRef);
    throwIfAborted(input.signal);
    if (config.modelId?.trim()) {
      await input.client.setModel({ modelId: config.modelId.trim(), sessionId: input.sessionId });
    }
    throwIfAborted(input.signal);
    const modeId = this.resolveModeId(input, config.modeId?.trim());
    if (modeId) {
      await this.applyMode(input, modeId);
    }
  }

  /**
   * The mode this session will accept, from the one the vault asked for.
   *
   * A turn is composed in Grimoire's own vocabulary — `grimoire-full-access`,
   * `grimoire-safe` — and those are not Grok's ids: sending one comes back as
   * `-32602 Invalid params` and aborts the turn before the prompt, which is
   * issue #52. Translated here because this is the only moment both the wish
   * and what the session named are known; a session that named nothing is a
   * release carrying its policy on the command line, and the launch already did.
   */
  private resolveModeId(
    input: Parameters<ManagedAcpExecutionDynamicApplier['apply']>[0],
    selectedModeId: string | undefined,
  ): string | null {
    if (!selectedModeId) {
      return null;
    }
    const advertised = [
      ...(input.sessionModes?.availableModes ?? []).map(mode => mode.id),
      ...modeOptionValues(input.sessionConfigOptions),
    ].filter(id => typeof id === 'string' && id.trim());
    const currentModeId = input.sessionModes?.currentModeId
      ?? currentModeOptionValue(input.sessionConfigOptions)
      ?? null;
    if (advertised.length === 0 && !currentModeId) {
      return null;
    }
    const target = resolveGrokAcpModeId(
      selectedModeId,
      currentModeId,
      [...new Set([...advertised, ...(currentModeId ? [currentModeId] : [])])],
    );
    // A set that changes nothing is a round trip the turn waits for.
    return target && target !== currentModeId ? target : null;
  }

  private async applyMode(
    input: Parameters<ManagedAcpExecutionDynamicApplier['apply']>[0],
    modeId: string,
  ): Promise<void> {
    try {
      await input.client.setMode({ modeId, sessionId: input.sessionId });
      return;
    } catch (error) {
      if (isUnsupportedMode(error)) {
        // The agent has no such mode. Not a failed turn: it runs on the mode it
        // does have, which is what the launch policy already decided.
        return;
      }
      if (!isMethodNotFound(error)) {
        throw error;
      }
    }
    const configId = modeConfigId(input.sessionConfigOptions);
    if (!configId) {
      // No dedicated method and no advertised option: this release takes its
      // policy on the command line, and the launch already carried it.
      return;
    }
    try {
      await input.client.setConfigOption({
        configId,
        sessionId: input.sessionId,
        type: 'select',
        value: modeId,
      });
    } catch (error) {
      if (!isUnsupportedMode(error)) {
        throw error;
      }
    }
  }
}

/** A mode option is a select, and only a select lists what it accepts. */
function modeSelectOption(
  configOptions: readonly AcpSessionConfigOption[] | undefined,
): Extract<AcpSessionConfigOption, { type: 'select' }> | null {
  const option = configOptions?.find(candidate => candidate.category === 'mode');
  return option?.type === 'select' ? option : null;
}

/** Flattened, because a select may present its values in groups. */
function modeOptionValues(
  configOptions: readonly AcpSessionConfigOption[] | undefined,
): string[] {
  return (modeSelectOption(configOptions)?.options ?? []).flatMap(entry => (
    'group' in entry ? entry.options.map(option => option.value) : [entry.value]
  ));
}

function currentModeOptionValue(
  configOptions: readonly AcpSessionConfigOption[] | undefined,
): string | null {
  return modeSelectOption(configOptions)?.currentValue ?? null;
}

function modeConfigId(
  configOptions: readonly AcpSessionConfigOption[] | undefined,
): string | undefined {
  return configOptions?.find(option => option.category === 'mode')?.id;
}

function isMethodNotFound(error: unknown): boolean {
  return error instanceof JsonRpcErrorResponse && error.code === -32601;
}

function isUnsupportedMode(error: unknown): boolean {
  return error instanceof JsonRpcErrorResponse && error.code === -32602;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Grok dynamic configuration aborted.');
}
