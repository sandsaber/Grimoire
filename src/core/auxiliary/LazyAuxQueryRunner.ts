import type { AuxQueryConfig, AuxQueryRunner } from './AuxQueryRunner';

/**
 * An `AuxQueryRunner` that is not built until something asks it a question.
 *
 * The services that hold one are built when a tab initializes or a modal opens,
 * and a runner backed by the execution kernel has to reach the provider's
 * composition to exist. That composition is constructed at plugin load, so
 * reaching for it in a constructor makes the service depend on an ordering it
 * has no way to see — and the provider runners these replaced had no such
 * dependency, because they touched the plugin only when a query ran.
 *
 * Keeping that timing is the point: a service that can be constructed at any
 * moment and only fails when it is actually used fails where the failure can be
 * reported.
 */
export class LazyAuxQueryRunner implements AuxQueryRunner {
  private runner: AuxQueryRunner | undefined;

  constructor(private readonly create: () => AuxQueryRunner) {}

  query(config: AuxQueryConfig, prompt: string): Promise<string> {
    this.runner ??= this.create();
    return this.runner.query(config, prompt);
  }

  /** Nothing to reset when nothing has run: building one to end it would be absurd. */
  reset(): void {
    this.runner?.reset();
  }
}
