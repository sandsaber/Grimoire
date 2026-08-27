import type { StreamChunk } from '../../../core/types';

export interface TurnFeedbackMetricsSnapshot {
  turnDurationMs: number;
  firstActivityMs: number | null;
  firstFeedbackMs: number | null;
  longestFeedbackSilenceMs: number;
  progressUpdates: number;
  textUpdates: number;
  toolUses: number;
}

/**
 * Captures display-quality timing without retaining prompts, responses, tool input,
 * file paths, or any other user content.
 */
export class TurnFeedbackMetrics {
  private readonly startedAt: number;
  private firstActivityAt: number | null = null;
  private firstFeedbackAt: number | null = null;
  private lastFeedbackAt: number | null = null;
  private longestFeedbackSilenceMs = 0;
  private progressUpdates = 0;
  private textUpdates = 0;
  private toolUses = 0;

  constructor(startedAt: number) {
    this.startedAt = startedAt;
  }

  /**
   * Records assistant text that reached the column without a chunk to carry it.
   *
   * The projection path draws prose through `appendText` rather than through
   * `handleStreamChunk`, so a turn made entirely of it would otherwise report
   * no activity, no feedback and a silence as long as the turn — a diagnostic
   * saying the provider produced nothing, on every successful turn.
   */
  observeText(text: string, observedAt: number): void {
    this.observe({ type: 'text', content: text }, observedAt);
  }

  observe(chunk: StreamChunk, observedAt: number): void {
    if (this.isActivity(chunk) && this.firstActivityAt === null) {
      this.firstActivityAt = observedAt;
    }

    if (chunk.type === 'progress') this.progressUpdates += 1;
    if (chunk.type === 'text' && chunk.content.trim()) this.textUpdates += 1;
    if (chunk.type === 'tool_use') this.toolUses += 1;

    if (!this.isUserFacingFeedback(chunk)) return;
    if (this.firstFeedbackAt === null) this.firstFeedbackAt = observedAt;
    const previousFeedbackAt = this.lastFeedbackAt ?? this.startedAt;
    this.longestFeedbackSilenceMs = Math.max(
      this.longestFeedbackSilenceMs,
      observedAt - previousFeedbackAt,
    );
    this.lastFeedbackAt = observedAt;
  }

  finish(finishedAt: number): TurnFeedbackMetricsSnapshot {
    const lastFeedbackAt = this.lastFeedbackAt ?? this.startedAt;
    const longestFeedbackSilenceMs = Math.max(
      this.longestFeedbackSilenceMs,
      finishedAt - lastFeedbackAt,
    );

    return {
      turnDurationMs: Math.max(0, Math.round(finishedAt - this.startedAt)),
      firstActivityMs: this.toLatency(this.firstActivityAt),
      firstFeedbackMs: this.toLatency(this.firstFeedbackAt),
      longestFeedbackSilenceMs: Math.max(0, Math.round(longestFeedbackSilenceMs)),
      progressUpdates: this.progressUpdates,
      textUpdates: this.textUpdates,
      toolUses: this.toolUses,
    };
  }

  private toLatency(timestamp: number | null): number | null {
    return timestamp === null ? null : Math.max(0, Math.round(timestamp - this.startedAt));
  }

  private isActivity(chunk: StreamChunk): boolean {
    switch (chunk.type) {
      case 'progress':
      case 'tool_use':
      case 'thinking':
      case 'notice':
      case 'error':
      case 'status':
        return true;
      case 'text':
        return chunk.content.trim().length > 0;
      default:
        return false;
    }
  }

  private isUserFacingFeedback(chunk: StreamChunk): boolean {
    switch (chunk.type) {
      case 'progress':
      case 'notice':
      case 'error':
      case 'status':
        return true;
      case 'text':
        return chunk.content.trim().length > 0;
      default:
        return false;
    }
  }
}
