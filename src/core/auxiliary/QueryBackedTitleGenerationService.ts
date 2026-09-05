import {
  buildTitleGenerationPrompt,
  buildTitleGenerationSystemPrompt,
  parseTitleGenerationResponse,
} from '../prompt/titleGeneration';
import type {
  TitleGenerationCallback,
  TitleGenerationResult,
  TitleGenerationService,
} from '../providers/types';
import type { AuxQueryRunner } from './AuxQueryRunner';

interface ActiveGeneration {
  abortController: AbortController;
  runner: AuxQueryRunner;
}

export interface QueryBackedTitleGenerationServiceOptions {
  createRunner: () => AuxQueryRunner;
  resolveModel?: () => string | undefined;
}

export class QueryBackedTitleGenerationService implements TitleGenerationService {
  private readonly activeGenerations = new Map<string, ActiveGeneration>();

  constructor(private readonly options: QueryBackedTitleGenerationServiceOptions) {}

  async generateTitle(
    conversationId: string,
    userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    const existing = this.activeGenerations.get(conversationId);
    if (existing) {
      existing.abortController.abort();
      existing.runner.reset();
    }

    const abortController = new AbortController();
    const runner = this.options.createRunner();
    const generation = { abortController, runner };
    this.activeGenerations.set(conversationId, generation);

    try {
      const text = await runner.query({
        abortController,
        model: this.options.resolveModel?.(),
        systemPrompt: buildTitleGenerationSystemPrompt(),
      }, buildTitleGenerationPrompt(userMessage));
      const title = parseTitleGenerationResponse(text);
      await this.safeCallback(
        callback,
        conversationId,
        title
          ? { success: true, title }
          : { success: false, error: 'Failed to parse title from response' },
      );
    } catch (error) {
      await this.safeCallback(callback, conversationId, {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      runner.reset();
      if (this.activeGenerations.get(conversationId) === generation) {
        this.activeGenerations.delete(conversationId);
      }
    }
  }

  cancel(): void {
    for (const active of this.activeGenerations.values()) {
      active.abortController.abort();
      active.runner.reset();
    }
    this.activeGenerations.clear();
  }

  private async safeCallback(
    callback: TitleGenerationCallback,
    conversationId: string,
    result: TitleGenerationResult,
  ): Promise<void> {
    try {
      await callback(conversationId, result);
    } catch {
      // Ignore callback failures to match existing service behavior.
    }
  }
}
