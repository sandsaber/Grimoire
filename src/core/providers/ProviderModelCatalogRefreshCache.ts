import { seedFingerprintMatches } from './catalogFingerprint';

/**
 * What became of a catalog refresh.
 *
 * The contract used to be a bare `boolean` that documented nothing, so ten
 * implementations each invented a meaning — most of them "the list changed" —
 * and no caller read it. The settings buttons had to guess success from the
 * *persisted* list instead, which still holds the previous values when a
 * refresh fails: a refresh against a logged-out CLI reported "12 models".
 *
 * Three states, because success and failure are not the whole question. A
 * refresh that was never asked is not a refresh that failed, and a provider
 * that answered with the same list it gave last time did not fail either.
 */
export type ProviderCatalogRefreshOutcome = 'refreshed' | 'skipped' | 'failed';

export interface ProviderModelCatalogRefreshRequest {
  fingerprint: string;
  force?: boolean;
  hasCachedModels: boolean;
  load: () => Promise<ProviderCatalogRefreshOutcome>;
}

interface PendingRefresh {
  fingerprint: string;
  promise: Promise<ProviderCatalogRefreshOutcome>;
}

/**
 * Keeps provider model catalogs from repeating an expensive CLI warmup.
 *
 * A catalog that already holds models is settled: it is rediscovered only when
 * its fingerprint (CLI path, environment) changes or a caller forces it. Model
 * lists do not change on a timer, but the picker that triggers refreshes opens
 * all the time, and every rediscovery boots a CLI - for some providers a
 * billable session. The TTL only paces retries after an attempt that found
 * nothing, so a missing or unauthenticated CLI is not re-spawned on every
 * dropdown open either.
 *
 * A seed speaks for a catalog this cache did not watch being discovered. Since
 * a settled catalog never expires, a CLI or environment swapped while the
 * plugin was not running would be adopted by the seed rather than detected,
 * pinning the previous configuration's models for good. Callers that persist a
 * digest of the key their list was discovered under pass it to `seed` and
 * `applyDeferredSeed`, which turns that assumption into a check. Callers that
 * record nothing keep the old behaviour rather than paying a CLI spawn to
 * migrate.
 */
export class ProviderModelCatalogRefreshCache {
  private freshFingerprint: string | null = null;
  private lastSuccessfulRefreshAt = 0;
  private pending: PendingRefresh | null = null;
  private refreshGeneration = 0;
  private deferredSeed: (() => string) | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Marks a persisted catalog fresh under `fingerprint`.
   *
   * `recordedFingerprint` is the digest the catalog was discovered under, when
   * the caller persists one. A digest that no longer describes `fingerprint`
   * leaves the cache untouched and the catalog is rediscovered.
   */
  seed(fingerprint: string, recordedFingerprint?: string): boolean {
    if (!seedFingerprintMatches(recordedFingerprint, fingerprint)) {
      return false;
    }

    this.refreshGeneration += 1;
    this.freshFingerprint = fingerprint;
    this.lastSuccessfulRefreshAt = this.now();
    return true;
  }

  /**
   * Holds a seed back until the first refresh, for a catalog whose fingerprint
   * cannot be computed yet.
   *
   * Provider workspace services are built *inside*
   * the workspace manager's initialization, and the manager only assigns
   * `this.services[providerId]` after that promise resolves, so a catalog under
   * construction still sees `getCliResolver` as null and
   * `getResolvedProviderCliPath` returns null. Seeding under that unresolved
   * path files the seed under a key no later lookup ever uses, and the CLI
   * warmup the seed exists to prevent runs on every plugin load regardless.
   */
  seedOnFirstRefresh(buildSeedFingerprint: () => string): void {
    this.deferredSeed = buildSeedFingerprint;
  }

  /**
   * Consumes a held-back seed, applying it only when nothing but the resolved
   * CLI path changed since construction. A real configuration change in that
   * window must still reach discovery, so the seed is dropped instead of being
   * filed under the new fingerprint.
   */
  applyDeferredSeed(
    fingerprint: string,
    hasCachedModels: boolean,
    recordedFingerprint?: string,
  ): boolean {
    const buildSeedFingerprint = this.deferredSeed;
    if (!buildSeedFingerprint) {
      return false;
    }

    this.deferredSeed = null;
    if (!hasCachedModels || buildSeedFingerprint() !== fingerprint) {
      return false;
    }

    return this.seed(fingerprint, recordedFingerprint);
  }

  isFresh(fingerprint: string, hasCachedModels: boolean): boolean {
    if (fingerprint !== this.freshFingerprint || this.lastSuccessfulRefreshAt === 0) {
      return false;
    }

    return hasCachedModels || this.now() - this.lastSuccessfulRefreshAt < this.ttlMs;
  }

  refresh(request: ProviderModelCatalogRefreshRequest): Promise<ProviderCatalogRefreshOutcome> {
    if (!request.force && this.isFresh(request.fingerprint, request.hasCachedModels)) {
      return Promise.resolve('skipped');
    }
    if (this.pending?.fingerprint === request.fingerprint) {
      return this.pending.promise;
    }

    const generation = this.refreshGeneration + 1;
    this.refreshGeneration = generation;
    // The fingerprint is marked fresh whatever the load answered, which is the
    // pacing this cache exists for: an attempt that found nothing must not be
    // repeated on the next dropdown open, since it costs a CLI spawn either way.
    const promise = request.load().then((outcome) => {
      if (generation === this.refreshGeneration) {
        this.freshFingerprint = request.fingerprint;
        this.lastSuccessfulRefreshAt = this.now();
      }
      return outcome;
    }).finally(() => {
      if (this.pending?.promise === promise) {
        this.pending = null;
      }
    });
    this.pending = { fingerprint: request.fingerprint, promise };
    return promise;
  }
}
