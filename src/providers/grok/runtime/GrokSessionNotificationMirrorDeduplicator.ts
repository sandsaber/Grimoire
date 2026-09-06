import type { GrokSessionNotificationSource } from './GrokSessionNotifications';

interface MirrorCandidate {
  fingerprint: string;
  sources: Set<GrokSessionNotificationSource>;
}

/**
 * Suppresses adjacent copies of the same update mirrored across Grok
 * notification methods.
 *
 * Adjacent only, and deliberately: some releases send the same update on both
 * channels back to back, and one candidate is enough to catch that. A mirror
 * that arrives *late* — with other updates between the copies — would slip
 * through, and the answer then is a fingerprint window rather than a single
 * candidate. The trigger for building one is evidence, not suspicion: a
 * duplicated sentence in a transcript where the two copies are not adjacent on
 * the wire. Until that is seen, a window would be a cache sized by guesswork.
 */
export class GrokSessionNotificationMirrorDeduplicator {
  private candidate: MirrorCandidate | null = null;

  shouldProcess(notification: unknown, source: GrokSessionNotificationSource): boolean {
    const fingerprint = this.createFingerprint(notification);
    if (!fingerprint) {
      this.candidate = null;
      return true;
    }

    if (this.candidate?.fingerprint !== fingerprint) {
      this.candidate = { fingerprint, sources: new Set([source]) };
      return true;
    }

    if (!this.candidate.sources.has(source)) {
      this.candidate.sources.add(source);
      return false;
    }

    // Identical consecutive chunks from one method may be legitimate streamed text.
    this.candidate = { fingerprint, sources: new Set([source]) };
    return true;
  }

  reset(): void {
    this.candidate = null;
  }

  private createFingerprint(notification: unknown): string | null {
    try {
      return JSON.stringify(notification) ?? null;
    } catch {
      return null;
    }
  }
}
