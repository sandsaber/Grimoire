import { createHash } from 'node:crypto';

import type { ManagedAcpLaunchInvocation } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import type { AcpContentBlock } from '@/providers/acp/types';

import type { PiAcpDynamicConfig } from './PiAcpDynamicConfig';
import type { PiExecutionInvocation } from './PiExecutionBackend';

export const PI_ACP_ARGUMENTS: readonly string[] = Object.freeze([]);

export interface PiExecutionRequest {
  readonly prompt: readonly AcpContentBlock[];
  readonly dynamic?: PiAcpDynamicConfig;
  readonly messageId?: string;
}

export interface PiInvocationEnvironment {
  readonly executable: string;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly launchKey: string;
}

const DEFAULT_LIMIT = 64;

export class PiExecutionRequests {
  private readonly pending = new Map<string, PiExecutionRequest>();
  private readonly startups = new Map<string, ManagedAcpLaunchInvocation>();
  private readonly dynamics = new Map<string, PiAcpDynamicConfig>();

  constructor(
    private readonly nextReference: () => string,
    private readonly environment: () => Promise<PiInvocationEnvironment>,
    private readonly limit: number = DEFAULT_LIMIT,
  ) {}

  reference(request: PiExecutionRequest): string {
    evict(this.pending, this.limit);
    const reference = this.nextReference();
    this.pending.set(reference, request);
    return reference;
  }

  async resolve(requestRef: string): Promise<PiExecutionInvocation> {
    const request = this.take(requestRef);
    const environment = await this.environment();
    evict(this.startups, this.limit);
    const startupRef = this.nextReference();
    this.startups.set(startupRef, {
      executable: environment.executable,
      arguments: [...PI_ACP_ARGUMENTS],
      cwd: environment.cwd,
      environment: { ...environment.environment },
    });
    let dynamicRef: string | undefined;
    if (request.dynamic) {
      evict(this.dynamics, this.limit);
      dynamicRef = this.nextReference();
      this.dynamics.set(dynamicRef, request.dynamic);
    }
    return {
      startupRef,
      restartFingerprint: fingerprint(environment.launchKey),
      cwd: environment.cwd,
      prompt: [...request.prompt],
      mcpServers: [],
      ...(request.messageId ? { messageId: request.messageId } : {}),
      ...(dynamicRef ? { dynamicRef } : {}),
    };
  }

  referenceLaunch(launch: ManagedAcpLaunchInvocation): string {
    evict(this.startups, this.limit);
    const startupRef = this.nextReference();
    this.startups.set(startupRef, launch);
    return startupRef;
  }

  async resolveLaunch(startupRef: string): Promise<ManagedAcpLaunchInvocation> {
    const launch = this.startups.get(startupRef);
    if (!launch) {
      throw new Error('Unknown Pi startup reference.');
    }
    return launch;
  }

  async resolveDynamic(dynamicRef: string): Promise<PiAcpDynamicConfig> {
    const dynamic = this.dynamics.get(dynamicRef);
    if (!dynamic) {
      throw new Error('Unknown Pi dynamic configuration reference.');
    }
    return dynamic;
  }

  dispose(): void {
    this.pending.clear();
    this.startups.clear();
    this.dynamics.clear();
  }

  private take(requestRef: string): PiExecutionRequest {
    const request = this.pending.get(requestRef);
    if (!request) {
      throw new Error('Unknown Pi request reference.');
    }
    this.pending.delete(requestRef);
    return request;
  }
}

function fingerprint(launchKey: string): string {
  return createHash('sha256').update(launchKey).digest('hex');
}

function evict(store: Map<string, unknown>, limit: number): void {
  while (store.size >= limit) {
    const oldest = store.keys().next();
    if (oldest.done) {
      return;
    }
    store.delete(oldest.value);
  }
}
