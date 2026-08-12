import { randomBytes } from 'node:crypto';

import {
  type ExecutionSessionId,
  executionSessionId,
  type InteractionId,
  interactionId,
  type LifecycleLeaseId,
  lifecycleLeaseId,
  type RunId,
  runId,
  type SessionInstanceId,
  sessionInstanceId,
} from '../../core/execution/ExecutionIds';

export type OpaqueEntropySource = () => string;

/** One source for application-owned opaque identities; provider-native IDs never use it. */
export class ApplicationIdentityFactory {
  constructor(
    private readonly entropy: OpaqueEntropySource = () => randomBytes(16).toString('hex'),
  ) {}

  nextExecutionSessionId(): ExecutionSessionId {
    return executionSessionId(this.next('es'));
  }

  nextSessionInstanceId(): SessionInstanceId {
    return sessionInstanceId(this.next('si'));
  }

  nextRunId(): RunId {
    return runId(this.next('run'));
  }

  nextInteractionId(): InteractionId {
    return interactionId(this.next('ix'));
  }

  nextLeaseId(): LifecycleLeaseId {
    return lifecycleLeaseId(this.next('lease'));
  }

  nextRequestRef(): string {
    return this.next('req');
  }

  nextTransactionId(): string {
    return this.next('tx');
  }

  nextShutdownCheckpointId(): string {
    return this.next('sd');
  }

  nextCommandId(): string {
    return this.next('cmd');
  }

  private next(prefix: string): string {
    const entropy = this.entropy();
    if (!/^[0-9a-f]{32}$/.test(entropy)) {
      throw new Error('Application identity entropy must contain exactly 32 lowercase hex digits.');
    }
    return `${prefix}-${entropy}`;
  }
}
