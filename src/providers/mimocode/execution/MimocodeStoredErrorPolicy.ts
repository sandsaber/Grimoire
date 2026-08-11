import {
  loadLatestMimocodeSessionError,
  type MimocodeSessionError,
} from '../history/MimocodeSessionErrorStore';
import { resolveMimocodeUnsupportedModelFallback } from '../models';
import type {
  MimocodeEmptyResultOutcome,
  MimocodeEmptyResultPolicy,
} from './MimocodeExecutionBackend';

export interface MimocodeFallbackSelectionPort {
  apply(input: {
    readonly rawModelId: string;
    readonly requestRef: string;
    readonly signal: AbortSignal;
  }): Promise<void>;
}

export interface MimocodeSessionErrorReader {
  load(input: {
    readonly sessionId: string;
    readonly databasePath?: string;
    readonly sinceEpochMs: number;
    readonly parentMessageId?: string;
  }): Promise<MimocodeSessionError | null>;
}

export class MimocodeStoredErrorPolicy implements MimocodeEmptyResultPolicy {
  constructor(
    private readonly fallbackSelection: MimocodeFallbackSelectionPort,
    private readonly errorReader: MimocodeSessionErrorReader = mimocodeSessionErrorReader,
  ) {}

  async resolve(
    input: Parameters<MimocodeEmptyResultPolicy['resolve']>[0],
  ): Promise<MimocodeEmptyResultOutcome> {
    const storedError = await this.errorReader.load({
      sessionId: input.nativeSessionRef,
      ...(input.databasePath ? { databasePath: input.databasePath } : {}),
      sinceEpochMs: input.startedAt,
      ...(input.nativeRunRef ? { parentMessageId: input.nativeRunRef } : {}),
    });
    if (!storedError) return { kind: 'no-provider-error' };

    const reportedModel = storedError.message.match(/not supported model\s+([^\s]+)/i)?.[1];
    const fallbackRawModelId = reportedModel
      ? resolveMimocodeUnsupportedModelFallback(reportedModel, input.availableRawModelIds)
      : null;
    if (!fallbackRawModelId || input.signal.aborted) return { kind: 'provider-failure' };

    try {
      await this.fallbackSelection.apply({
        rawModelId: fallbackRawModelId,
        requestRef: input.requestRef,
        signal: input.signal,
      });
    } catch {
      return { kind: 'provider-failure' };
    }
    return input.signal.aborted
      ? { kind: 'provider-failure' }
      : { kind: 'fallback-applied', fallbackRawModelId };
  }
}

export const mimocodeSessionErrorReader: MimocodeSessionErrorReader = Object.freeze({
  load: (input: Parameters<MimocodeSessionErrorReader['load']>[0]) => loadLatestMimocodeSessionError(
    input.sessionId,
    { databasePath: input.databasePath },
    input.sinceEpochMs,
    input.parentMessageId,
  ),
});
