import type { WorkNodeDispatchFactory, WorkRecoveryPorts } from '../../core/work/WorkCoordinator';
import type { ApplicationRuntime } from './ApplicationRuntime';
import type { ApplicationRuntimeComposition } from './ApplicationRuntimeComposition';
import { createApplicationRuntime } from './ApplicationRuntimeFactory';

export interface ApplicationRuntimePluginLifecycleOptions {
  readonly composition: ApplicationRuntimeComposition;
  readonly workDispatchFactory?: WorkNodeDispatchFactory;
  readonly workRecoveryPorts?: WorkRecoveryPorts;
}

export interface ApplicationRuntimePluginLifecycle {
  readonly runtime: ApplicationRuntime;
  readonly composition: ApplicationRuntimeComposition;
  start(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * Bridges the Obsidian Plugin lifecycle to the ApplicationRuntime.
 * The plugin constructs this in onload(), starts it, and shuts it down in
 * onunload(). Views access the runtime through the returned instance.
 */
export function createApplicationRuntimePluginLifecycle(
  options: ApplicationRuntimePluginLifecycleOptions,
): ApplicationRuntimePluginLifecycle {
  const runtime = createApplicationRuntime({
    composition: options.composition,
    workDispatchFactory: options.workDispatchFactory,
    workRecoveryPorts: options.workRecoveryPorts,
  });
  let startTask: Promise<void> | undefined;
  let shutdownTask: Promise<void> | undefined;
  return Object.freeze({
    runtime,
    composition: options.composition,
    start: async () => {
      if (shutdownTask) await shutdownTask.catch(() => undefined);
      startTask ??= runtime.start();
      try {
        await startTask;
      } finally {
        startTask = undefined;
      }
    },
    shutdown: async () => {
      if (startTask) await startTask.catch(() => undefined);
      shutdownTask ??= runtime.shutdown();
      try {
        await shutdownTask;
      } finally {
        shutdownTask = undefined;
      }
    },
  });
}
