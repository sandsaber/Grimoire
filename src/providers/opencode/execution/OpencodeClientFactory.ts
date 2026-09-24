import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  type ManagedAcpLaunchInvocation,
  type ManagedAcpLaunchResolver,
  NodeManagedAcpProcessLauncher,
} from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import {
  AcpManagedClientAdapterFactory,
  type AcpManagedClientAdapterOptions,
  type AcpManagedOwnedProcess,
} from '@/providers/acp/execution/AcpManagedClientAdapter';
import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
  ManagedAcpClientFactoryInput,
} from '@/providers/acp/execution/ManagedAcpClient';
import { isRecord } from '@/utils/records';

import { OpencodeV2Client } from './OpencodeV2Client';

/** V1 uses ACP; V2 owns a private server so discovery can await its ready catalog. */
export class OpencodeClientFactory implements ManagedAcpClientFactory {
  private readonly launchers = new Set<NodeManagedAcpProcessLauncher>();

  constructor(
    private readonly options: Omit<AcpManagedClientAdapterOptions, 'processLauncher'>,
    private readonly resolver: ManagedAcpLaunchResolver,
  ) {}

  async create(input: ManagedAcpClientFactoryInput): Promise<ManagedAcpClient> {
    const invocation = await this.resolver.resolve(input.startupRef);
    const probeLauncher = this.launcher({ ...invocation, arguments: ['--version'] });
    const probe = await probeLauncher.launch(input.startupRef, input.signal);
    let version: string;
    let probeStopped = false;
    try {
      version = await readStartupLine(probe, input.signal);
    } finally {
      probeStopped = await probe.terminate() === 'confirmed';
      if (probeStopped) this.launchers.delete(probeLauncher);
    }
    if (!probeStopped) throw new Error('OpenCode version probe termination was not confirmed.');
    const parsed = /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
    if (!parsed) throw new Error('Cannot determine the installed OpenCode version.');
    if (Number(parsed[1]) < 2) {
      const launcher = this.launcher(invocation);
      const client = await new AcpManagedClientAdapterFactory({
        ...this.options,
        processLauncher: launcher,
      }).create(input);
      return this.track(client, launcher);
    }

    if (parsed[1] !== '2') throw new Error('This OpenCode version is not supported. Use OpenCode 1.x or 2.x.');
    const configText = invocation.environment.OPENCODE_CONFIG
      ? await readFile(invocation.environment.OPENCODE_CONFIG, 'utf8')
      : invocation.environment.OPENCODE_CONFIG_CONTENT ?? '{}';
    const config = parseConfig(configText, 'managed');
    const requiredAgents = typeof config.default_agent === 'string' && config.default_agent.startsWith('grimoire-aux-')
      ? [config.default_agent] : ['grimoire-full-access', 'grimoire-safe'];
    const inlineConfig = scopedV2Config(config, invocation.environment.OPENCODE_CONFIG_CONTENT, requiredAgents);
    const password = randomBytes(32).toString('base64url');
    const launcher = this.launcher({
      ...invocation,
      arguments: ['serve', '--stdio', '--hostname', '127.0.0.1', '--port', '0'],
      environment: { ...invocation.environment, OPENCODE_PASSWORD: password, OPENCODE_CONFIG_CONTENT: inlineConfig },
    });
    const process = await launcher.launch(input.startupRef, input.signal);
    try {
      const address = parseConfig(await readStartupLine(process, input.signal), 'server startup');
      if (typeof address.url !== 'string') throw new Error('OpenCode V2 did not report its server address.');
      const url = new URL(address.url);
      if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)) {
        throw new Error('OpenCode V2 must listen on a local loopback address.');
      }
      const client = new OpencodeV2Client({
        process,
        url: url.toString(),
        password,
        cwd: invocation.cwd,
        requiredAgents,
        requestPermission: input.requestPermission,
        signal: input.signal,
      });
      return this.track(client, launcher);
    } catch (error) {
      await process.terminate();
      throw error;
    }
  }

  async dispose(): Promise<'confirmed' | 'unconfirmed'> {
    const outcomes = await Promise.all([...this.launchers].map(launcher => launcher.dispose()));
    return outcomes.every(outcome => outcome === 'confirmed') ? 'confirmed' : 'unconfirmed';
  }

  private launcher(invocation: ManagedAcpLaunchInvocation): NodeManagedAcpProcessLauncher {
    const launcher = new NodeManagedAcpProcessLauncher({ resolve: async () => invocation });
    this.launchers.add(launcher);
    return launcher;
  }

  private track(client: ManagedAcpClient, launcher: NodeManagedAcpProcessLauncher): ManagedAcpClient {
    const close = client.close.bind(client);
    client.close = async () => {
      const outcome = await close();
      if (outcome === 'confirmed') this.launchers.delete(launcher);
      return outcome;
    };
    return client;
  }
}

/** V2 runs tools natively, so preserve the ACP delegate's workspace boundary in its policy. */
export function scopedV2Config(
  artifact: Record<string, unknown>,
  inlineText: string | undefined,
  requiredAgents: readonly string[],
): string {
  const inline = inlineText ? parseConfig(inlineText, 'inline') : {};
  const source = isRecord(artifact.agent) ? artifact.agent : {};
  const managed: Record<string, Record<string, unknown>> = {};
  for (const id of new Set([...requiredAgents, 'plan'])) {
    const agent = source[id];
    if (!isRecord(agent)) continue;
    managed[id] = {
      ...agent,
      ...(id !== 'grimoire-full-access' ? {
        permission: { ...(isRecord(agent.permission) ? agent.permission : {}), external_directory: 'deny' },
      } : {}),
    };
  }
  if (isRecord(inline.agents)) {
    const agents = { ...inline.agents };
    for (const [id, agent] of Object.entries(managed)) {
      const permissions = Object.entries(isRecord(agent.permission) ? agent.permission : {}).flatMap(([key, value]) => {
        const action = ({ bash: 'shell', write: 'edit', task: 'subagent' } as Record<string, string>)[key] ?? key;
        const rules = typeof value === 'string' ? { '*': value } : isRecord(value) ? value : {};
        return Object.entries(rules).map(([resource, effect]) => ({ action, resource, effect }));
      });
      agents[id] = { ...(isRecord(agents[id]) ? agents[id] : {}),
        ...(typeof agent.mode === 'string' ? { mode: agent.mode } : {}), system: agent.prompt, permissions };
    }
    return JSON.stringify({ ...inline, agents });
  }
  return JSON.stringify({ ...inline, agent: { ...(isRecord(inline.agent) ? inline.agent : {}), ...managed } });
}

function parseConfig(text: string, source: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (isRecord(value)) return value;
  } catch {
    // Do not echo configuration text: it may contain provider credentials.
  }
  throw new Error(`OpenCode ${source} configuration must be a JSON object.`);
}

function readStartupLine(process: AcpManagedOwnedProcess, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    let unsubscribe = (): void => {};
    const finish = (error?: Error, line?: string): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      process.input.removeListener('data', onData);
      signal.removeEventListener('abort', onAbort);
      unsubscribe();
      if (error) reject(error);
      else resolve(line ?? buffer);
    };
    const onData = (chunk: Buffer | string): void => {
      buffer += chunk.toString();
      if (buffer.length > 8_192) finish(new Error('OpenCode startup response is too large.'));
      else if (buffer.includes('\n')) finish(undefined, buffer.slice(0, buffer.indexOf('\n')));
    };
    const onAbort = (): void => finish(new Error('OpenCode startup aborted.'));
    const timer = window.setTimeout(() => finish(new Error('OpenCode startup timed out.')), 15_000);
    unsubscribe = process.onClose(error => finish(error ?? (buffer ? undefined : new Error('OpenCode exited during startup.'))));
    if (settled) { unsubscribe(); return; }
    process.input.on('data', onData);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}
