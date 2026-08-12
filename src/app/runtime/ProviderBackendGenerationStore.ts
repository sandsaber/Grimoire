import type { ProviderId } from '../../core/types/provider';

/**
 * Tracks the active backend generation for each provider. Generations start
 * at 1 and advance only through settings transitions. The bootstrap reads the
 * initial generation before backend construction; the settings coordinator
 * advances it after a successful transition.
 */
export class ProviderBackendGenerationStore {
  private readonly generations = new Map<ProviderId, number>();

  getGeneration(providerId: ProviderId): number {
    return this.generations.get(providerId) ?? 1;
  }

  setGeneration(providerId: ProviderId, generation: number): void {
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new Error(`Provider "${providerId}" generation must be a positive safe integer.`);
    }
    this.generations.set(providerId, generation);
  }

  advanceGeneration(providerId: ProviderId): number {
    const next = this.getGeneration(providerId) + 1;
    this.setGeneration(providerId, next);
    return next;
  }
}
