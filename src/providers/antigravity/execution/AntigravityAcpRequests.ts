import { createHash } from 'node:crypto';

import type { ManagedAcpLaunchInvocation } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import type { ManagedAcpClient } from '@/providers/acp/execution/ManagedAcpClient';
import type { ManagedAcpExecutionDynamicApplier, ManagedAcpExecutionInvocation } from '@/providers/acp/execution/ManagedAcpExecutionBackend';
import type { AcpContentBlock, AcpNewSessionResponse } from '@/providers/acp/types';

import { buildAntigravityProcessLaunch } from '../runtime/AntigravityProcessLaunch';
import type { AntigravityRequestStore } from './AntigravityRequestStore';

export interface AntigravityAcpEnvironment {
  readonly command: string;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly permissionMode: string;
}

/** In-memory launch and turn configuration references; never a second transcript. */
export class AntigravityAcpRequests {
  private readonly sessions = new WeakMap<ManagedAcpClient, Map<string, AcpNewSessionResponse>>();
  private readonly invocations = new Map<string, {
    readonly launch: ManagedAcpLaunchInvocation;
    model: string | null;
    session?: AcpNewSessionResponse;
    readonly mode: string;
  }>();

  constructor(
    private readonly requests: AntigravityRequestStore,
    private readonly environment: () => AntigravityAcpEnvironment,
    private readonly expandSkill: (prompt: string) => Promise<string>,
  ) {}

  async resolve(requestRef: string): Promise<ManagedAcpExecutionInvocation> {
    const request = this.requests.resolve(requestRef);
    const environment = this.environment();
    const arguments_ = environment.permissionMode === 'full_access'
      ? ['acp', '--dangerously-skip-permissions'] : ['acp'];
    const launch = buildAntigravityProcessLaunch(environment.command, arguments_, environment.environment);
    const prompt: AcpContentBlock[] = [{
      type: 'text', text: await this.expandSkill(request.acpPrompt ?? request.prompt),
    }];
    this.invocations.set(requestRef, {
      launch: {
        executable: launch.command,
        arguments: launch.args,
        cwd: environment.cwd,
        environment: Object.fromEntries(Object.entries(environment.environment)
          .filter((entry): entry is [string, string] => entry[1] !== undefined)),
      },
      model: request.model,
      mode: environment.permissionMode,
    });
    for (const image of request.images ?? []) {
      prompt.push({ type: 'image', data: image.data, mimeType: image.mediaType });
    }
    return {
      startupRef: requestRef,
      restartFingerprint: createHash('sha256').update(JSON.stringify({
        command: environment.command, cwd: environment.cwd, environment: environment.environment,
        fullAccess: environment.permissionMode === 'full_access',
      })).digest('hex'),
      cwd: environment.cwd,
      prompt,
      mcpServers: [],
      dynamicRef: requestRef,
    };
  }

  async resolveLaunch(startupRef: string): Promise<ManagedAcpLaunchInvocation> {
    const invocation = this.invocations.get(startupRef);
    if (!invocation) throw new Error('Unknown Antigravity ACP startup reference.');
    return invocation.launch;
  }

  async configure(input: Parameters<ManagedAcpExecutionDynamicApplier['apply']>[0]): Promise<void> {
    if (!input.dynamicRef) return;
    const dynamic = this.invocations.get(input.dynamicRef);
    if (!dynamic) throw new Error('Unknown Antigravity ACP configuration reference.');
    const session = this.sessions.get(input.client)?.get(input.sessionId) ?? dynamic.session;
    if (session) dynamic.session = session;
    const options = input.sessionConfigOptions ?? session?.configOptions ?? [];
    const modes = input.sessionModes ?? session?.modes;
    if (dynamic.model) {
      const offered = session?.models?.availableModels ?? [];
      const matching = offered.find(model => (model.modelId ?? model.id) === dynamic.model
        || model.name === dynamic.model);
      const modelId = matching?.modelId ?? matching?.id ?? dynamic.model;
      dynamic.model = modelId;
      // AGY's config model values select a family; set_model selects the full
      // native model id, including the effort tier named by `agy models`.
      await input.client.setModel({ sessionId: input.sessionId, modelId });
    }
    if (input.signal.aborted) throw new Error('Antigravity ACP configuration cancelled.');
    // accept-edits auto-approves only edits. Full access uses the native launch
    // flag, while the session mode is reset to default after leaving Plan.
    const mode = dynamic.mode === 'plan' ? 'plan' : 'default';
    const option = options.find(candidate => candidate.id === 'mode' && candidate.type === 'select');
    if (option?.type === 'select') {
      const available = option.options.flatMap(entry => 'options' in entry ? entry.options : [entry]);
      if (!available.some(entry => entry.value === mode)) {
        throw new Error(`Antigravity ACP does not offer ${mode} mode.`);
      }
      await input.client.setConfigOption({ sessionId: input.sessionId, configId: 'mode', type: 'select', value: mode });
    } else if (modes?.availableModes.some(entry => entry.id === mode)) {
      await input.client.setMode({ sessionId: input.sessionId, modeId: mode });
    } else if (mode === 'default') {
      // session/load may omit discovery; a successful native setter verifies
      // Safe policy instead of inheriting an unobservable previous mode.
      await input.client.setMode({ sessionId: input.sessionId, modeId: mode });
    } else {
      throw new Error(`Antigravity ACP does not offer ${mode} mode.`);
    }
  }

  release(requestRef: string): void {
    this.invocations.delete(requestRef);
  }

  forgetClient(client: ManagedAcpClient): void {
    this.sessions.delete(client);
  }

  rememberSession(client: ManagedAcpClient, session: AcpNewSessionResponse): void {
    let sessions = this.sessions.get(client);
    if (!sessions) {
      sessions = new Map();
      this.sessions.set(client, sessions);
    }
    sessions.set(session.sessionId, session);
  }

  dispose(): void {
    this.invocations.clear();
  }
}
