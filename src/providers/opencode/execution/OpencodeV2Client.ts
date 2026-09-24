import {
  type AgentInfo,
  type FormInfo1,
  isSessionNotFoundError,
  type ModelInfo,
  OpenCode,
  type OpenCodeClient,
  type OpenCodeEvent,
  type SessionInfo,
} from '@opencode/client';

import { createNodeFetch } from '@/core/mcp/McpTester';
import { JsonRpcErrorResponse } from '@/providers/acp/AcpJsonRpcTransport';
import type { AcpManagedOwnedProcess } from '@/providers/acp/execution/AcpManagedClientAdapter';
import type { ManagedAcpClient, ManagedAcpClientFactoryInput } from '@/providers/acp/execution/ManagedAcpClient';
import type {
  AcpContentBlock,
  AcpMcpServer,
  AcpPromptResponse,
  AcpSessionConfigOption,
  AcpSessionNotification,
} from '@/providers/acp/types';
import { isRecord } from '@/utils/records';

import { normalizeOpencodeToolInput } from '../normalization/opencodeToolNormalization';
import { opencodeFormAnswers, opencodeFormQuestions, type OpencodeQuestionResponse } from './OpencodeQuestions';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

export interface OpencodeV2ClientOptions {
  readonly process: AcpManagedOwnedProcess;
  readonly url: string;
  readonly password: string;
  readonly cwd: string;
  readonly requiredAgents: readonly string[];
  readonly requestPermission: ManagedAcpClientFactoryInput['requestPermission'];
  readonly signal: AbortSignal;
}

/** Provider-owned V2 HTTP transport, projected into the existing managed session contract. */
export class OpencodeV2Client implements ManagedAcpClient {
  private readonly api: OpenCodeClient;
  private readonly lifetime = new AbortController();
  private readonly connected = deferred<void>();
  private readonly notifications = new Set<(event: AcpSessionNotification) => void>();
  private readonly lost = new Set<(error?: Error) => void>();
  private readonly turns = new Map<string, Deferred<AcpPromptResponse>>();
  private readonly usage = new Map<string, NonNullable<AcpPromptResponse['usage']>>();
  private readonly turnErrors = new Map<string, Error>();
  private readonly sessions = new Map<string, SessionInfo>();
  private readonly tools = new Map<string, { sessionId: string; name: string; input: Record<string, unknown> }>();
  private readonly permissions = new Map<string, string>();
  private readonly forms = new Map<string, string>();
  private readonly emitted = new Map<string, string>();
  private agents: AgentInfo[] = [];
  private models: ModelInfo[] = [];
  private commands: Array<{ name: string; description?: string }> = [];
  private closed = false;
  private closeTask?: Promise<'confirmed' | 'unconfirmed'>;

  constructor(private readonly options: OpencodeV2ClientOptions) {
    this.api = OpenCode.make({
      baseUrl: options.url,
      fetch: createNodeFetch(),
      headers: { Authorization: `Basic ${Buffer.from(`opencode:${options.password}`).toString('base64')}` },
    });
    options.process.onClose(error => {
      if (!this.closed) this.fail(error ?? new Error('OpenCode V2 server disconnected.'));
    });
    options.signal.addEventListener('abort', () => { void this.close(); }, { once: true });
    if (options.signal.aborted) void this.close();
  }

  async initialize(): Promise<void> {
    void this.readEvents().catch(error => this.fail(asError(error)));
    await this.connected.promise;
    const location = { directory: this.options.cwd };
    const deadline = Date.now() + 15_000;
    do {
      this.agents = (await this.api.agent.list({ location }, this.requestOptions())).data
        .filter(agent => agent.mode !== 'subagent' && !agent.hidden);
      if (this.haveRequiredAgents()) {
        this.models = (await this.api.model.list({ location }, this.requestOptions())).data.filter(model => model.enabled);
        if (this.models.length > 0) break;
      }
      await new Promise(resolve => window.setTimeout(resolve, 100));
    } while (!this.closed && Date.now() < deadline);
    if (!this.haveRequiredAgents()) {
      throw new Error('OpenCode V2 did not finish loading the Grimoire permission modes.');
    }
    if (this.models.length === 0) throw new Error('OpenCode V2 did not load any enabled models. Check its provider configuration.');
    this.commands = (await this.api.command.list({ location }, this.requestOptions())).data;
  }

  async newSession(request: Parameters<ManagedAcpClient['newSession']>[0]) {
    await this.applyMcp(request.cwd, request.mcpServers);
    const model = (await this.api.model.default({ location: { directory: request.cwd } }, this.requestOptions())).data;
    const session = await this.api.session.create({
      location: { directory: request.cwd },
      ...(model ? { model: { providerID: model.providerID, id: model.id } } : {}),
    }, this.requestOptions());
    return this.opened(session);
  }

  async loadSession(request: Parameters<ManagedAcpClient['loadSession']>[0]) {
    try {
      const session = await this.api.session.get({ sessionID: request.sessionId }, this.requestOptions());
      await this.applyMcp(session.location.directory, request.mcpServers);
      return this.opened(session);
    } catch (error) {
      if (isSessionNotFoundError(error)) {
        throw new JsonRpcErrorResponse('session/load', -32002, `Session not found: ${request.sessionId}`);
      }
      throw error;
    }
  }

  async listSessions(request: Parameters<NonNullable<ManagedAcpClient['listSessions']>>[0] = {}) {
    const result = await this.api.session.list({
      ...(request?.cwd ? { directory: request.cwd } : {}),
      ...(request?.cursor ? { cursor: request.cursor } : {}),
      limit: 100,
    }, this.requestOptions());
    return {
      sessions: result.data.map(session => ({
        sessionId: session.id, cwd: session.location.directory,
        ...(session.title ? { title: session.title } : {}),
        updatedAt: new Date(session.time.updated).toISOString(),
      })),
      nextCursor: result.cursor.next,
    };
  }

  async setConfigOption(request: Parameters<ManagedAcpClient['setConfigOption']>[0]) {
    const session = this.requireSession(request.sessionId);
    if (request.configId === 'mode') {
      if (!this.agents.some(agent => agent.id === request.value)) throw new Error('Requested OpenCode mode is unavailable.');
      await this.api.session.switchAgent({ sessionID: session.id, agent: String(request.value) }, this.requestOptions());
      session.agent = String(request.value);
    } else if (request.configId === 'model') {
      const model = this.models.find(candidate => `${candidate.providerID}/${candidate.id}` === request.value);
      if (!model) throw new Error('Requested OpenCode model is unavailable.');
      const selection = { providerID: model.providerID, id: model.id };
      await this.api.session.switchModel({ sessionID: session.id, model: selection }, this.requestOptions());
      session.model = selection;
    } else if (request.configId === 'effort' && session.model) {
      const model = this.currentModel(session);
      if (request.value !== 'default' && !model?.variants.some(variant => variant.id === request.value)) throw new Error('Requested OpenCode effort is unavailable.');
      const selection = { providerID: session.model.providerID, id: session.model.id,
        ...(request.value !== 'default' ? { variant: String(request.value) } : {}) };
      await this.api.session.switchModel({ sessionID: session.id, model: selection }, this.requestOptions());
      session.model = selection;
    } else {
      throw new Error(`Unsupported OpenCode configuration option: ${request.configId}`);
    }
    return { configOptions: this.configOptions(session) };
  }

  async setMode(request: Parameters<ManagedAcpClient['setMode']>[0]) {
    await this.setConfigOption({ sessionId: request.sessionId, configId: 'mode', value: request.modeId, type: 'select' });
    return {};
  }

  async setModel(request: Parameters<ManagedAcpClient['setModel']>[0]) {
    return this.setConfigOption({ sessionId: request.sessionId, configId: 'model', value: request.modelId, type: 'select' });
  }

  async prompt(request: Parameters<ManagedAcpClient['prompt']>[0]): Promise<AcpPromptResponse> {
    const session = this.requireSession(request.sessionId);
    if (this.turns.has(session.id)) throw new Error('OpenCode session already has an active turn.');
    const turn = deferred<AcpPromptResponse>();
    this.turns.set(session.id, turn);
    const text = request.prompt.filter((part): part is Extract<AcpContentBlock, { type: 'text' }> => part.type === 'text')
      .map(part => part.text).join('\n');
    const files = request.prompt.flatMap(part => {
      if (part.type === 'image') return [{ uri: `data:${part.mimeType};base64,${part.data}` }];
      if (part.type === 'resource_link') return [{ uri: part.uri }];
      return [];
    });
    try {
      const command = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
      if (command?.[1] === 'compact') {
        await this.api.session.compact({ sessionID: session.id }, this.requestOptions());
      } else if (command && this.commands.some(entry => entry.name === command[1])) {
        await this.post(`/api/session/${encodeURIComponent(session.id)}/command`, { name: command[1], text: command[2] ?? '', files });
      } else {
        await this.api.session.prompt({ sessionID: session.id, text, files }, this.requestOptions());
      }
      return await turn.promise;
    } finally {
      this.turns.delete(session.id);
      this.usage.delete(session.id);
      this.turnErrors.delete(session.id);
      for (const [id, tool] of this.tools) if (tool.sessionId === session.id) this.tools.delete(id);
      for (const [id, owner] of this.permissions) if (owner === session.id) this.permissions.delete(id);
      for (const [id, owner] of this.forms) if (owner === session.id) this.forms.delete(id);
      for (const key of this.emitted.keys()) if (key.startsWith(`${session.id}:`)) this.emitted.delete(key);
    }
  }

  cancel(sessionId: string): void {
    void this.api.session.interrupt({ sessionID: sessionId }, this.requestOptions())
      .catch(error => this.fail(asError(error)));
  }

  onSessionNotification(listener: (event: AcpSessionNotification) => void) {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  onConnectionLost(listener: (error?: Error) => void) {
    this.lost.add(listener);
    return () => this.lost.delete(listener);
  }

  close(): Promise<'confirmed' | 'unconfirmed'> {
    if (this.closeTask) return this.closeTask;
    this.closed = true;
    this.connected.reject(new Error('OpenCode V2 startup cancelled.'));
    this.lifetime.abort();
    for (const turn of this.turns.values()) turn.resolve({ stopReason: 'cancelled' });
    this.closeTask = this.options.process.terminate();
    void this.closeTask.then(outcome => {
      if (outcome === 'unconfirmed') this.closeTask = undefined;
    });
    return this.closeTask;
  }

  private requestOptions() { return { signal: this.lifetime.signal }; }

  private haveRequiredAgents(): boolean {
    if (!this.options.requiredAgents.every(id => this.agents.some(agent => agent.id === id))) return false;
    const scoped = this.options.requiredAgents.filter(id => id !== 'grimoire-full-access');
    if (this.options.requiredAgents.includes('grimoire-full-access')) scoped.push('plan');
    return scoped.every(id => {
      const rules = this.agents.find(agent => agent.id === id)?.permissions ?? [];
      let confined = false;
      for (const rule of rules) {
        if (rule.action !== 'external_directory' && !rule.action.includes('*')) continue;
        if (rule.effect === 'deny' && rule.resource === '*') confined = true;
        else if (rule.effect !== 'deny') confined = false;
      }
      return confined;
    });
  }

  private requireSession(id: string): SessionInfo {
    const session = this.sessions.get(id);
    if (!session) throw new Error('OpenCode session is not open.');
    return session;
  }

  private currentModel(session: SessionInfo) {
    return this.models.find(model => model.providerID === session.model?.providerID && model.id === session.model?.id);
  }

  private opened(session: SessionInfo) {
    this.sessions.set(session.id, session);
    this.emit(session.id, { sessionUpdate: 'available_commands_update', availableCommands: this.commands.map(command => ({ ...command, description: command.description ?? '' })) });
    return { sessionId: session.id, configOptions: this.configOptions(session) };
  }

  private configOptions(session: SessionInfo): AcpSessionConfigOption[] {
    const model = this.currentModel(session);
    return [
      { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: session.agent ?? 'build',
        options: this.agents.map(agent => ({ value: agent.id, name: agent.name })) },
      { id: 'model', name: 'Model', category: 'model', type: 'select',
        currentValue: session.model ? `${session.model.providerID}/${session.model.id}` : '',
        options: this.models.map(entry => ({ value: `${entry.providerID}/${entry.id}`, name: entry.name })) },
      ...(model?.variants.length ? [{ id: 'effort', name: 'Effort', category: 'thought_level', type: 'select' as const,
        currentValue: session.model?.variant ?? 'default',
        options: [...new Set(['default', ...model.variants.map(variant => variant.id)])].map(id => ({ value: id, name: id })) }] : []),
    ];
  }

  private async applyMcp(cwd: string, servers: AcpMcpServer[]) {
    for (const server of servers) {
      if (server.type === 'sse') throw new Error('OpenCode V2 does not support SSE MCP servers.');
      const config = server.type === 'http'
        ? { type: 'remote' as const, url: server.url, headers: Object.fromEntries((server.headers ?? []).map(header => [header.name, header.value])), oauth: false as const }
        : { type: 'local' as const, command: [server.command, ...server.args], environment: Object.fromEntries((server.env ?? []).map(entry => [entry.name, entry.value])) };
      await this.api.mcp.add({ server: server.name, location: { directory: cwd }, config }, this.requestOptions());
    }
  }

  private async readEvents(): Promise<void> {
    for await (const event of this.api.event.subscribe(this.requestOptions())) {
      if (this.closed) return;
      this.handleEvent(event);
    }
    if (!this.closed) throw new Error('OpenCode V2 event stream ended.');
  }

  private handleEvent(event: OpenCodeEvent): void {
    if (event.type === 'server.connected') { this.connected.resolve(); return; }
    if (event.type === 'form.created' && this.turns.has(event.data.form.sessionID)) {
      void this.replyForm(event.data.form).catch(error => this.fail(asError(error)));
      return;
    }
    const data = event.data;
    if (!('sessionID' in data) || typeof data.sessionID !== 'string') return;
    const sessionId = data.sessionID;
    const session = this.sessions.get(sessionId);
    if (session && event.type === 'session.agent.selected') {
      session.agent = event.data.agent;
      this.emit(sessionId, { sessionUpdate: 'current_mode_update', currentModeId: event.data.agent });
      return;
    }
    if (session && event.type === 'session.model.selected') {
      session.model = event.data.model;
      this.emit(sessionId, { sessionUpdate: 'config_option_update', configOptions: this.configOptions(session) });
      return;
    }
    if (!this.turns.has(sessionId)) return;
    switch (event.type) {
      case 'session.text.delta':
      case 'session.reasoning.delta':
      case 'session.text.ended':
      case 'session.reasoning.ended': {
        const content = event.data;
        const thinking = event.type.startsWith('session.reasoning.');
        const key = `${sessionId}:${content.assistantMessageID}:${thinking}:${content.ordinal}`;
        const previous = this.emitted.get(key) ?? '';
        const text = 'delta' in content ? content.delta : content.text.startsWith(previous) ? content.text.slice(previous.length) : '';
        this.emitted.set(key, previous + text);
        if (text) this.emit(sessionId, { sessionUpdate: thinking ? 'agent_thought_chunk' : 'agent_message_chunk',
          messageId: content.assistantMessageID, content: { type: 'text', text } });
        break;
      }
      case 'session.tool.input.started':
        this.tools.set(event.data.id, { sessionId, name: event.data.name, input: {} });
        this.emit(sessionId, { sessionUpdate: 'tool_call', toolCallId: event.data.id, title: event.data.name, status: 'pending' });
        break;
      case 'session.tool.input.ended': {
        const tool = this.tools.get(event.data.id);
        if (!tool) break;
        try {
          const input: unknown = JSON.parse(event.data.text);
          if (isRecord(input)) tool.input = input;
        } catch { /* The server validates tool arguments; a malformed partial input grants nothing. */ }
        this.emit(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: event.data.id, rawInput: tool.input, status: 'pending' });
        break;
      }
      case 'session.tool.called': {
        const tool = this.tools.get(event.data.id);
        if (tool) tool.input = event.data.input;
        this.emit(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: event.data.id, rawInput: event.data.input, status: 'in_progress' });
        break;
      }
      case 'session.tool.success':
      case 'session.tool.failed': {
        const failed = event.type === 'session.tool.failed';
        const text = 'error' in event.data ? event.data.error.message ?? event.data.error.type
          : event.data.content.filter(content => content.type === 'text').map(content => content.text).join('\n');
        this.emit(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: event.data.id,
          status: failed ? 'failed' : 'completed', rawOutput: { output: text, metadata: event.data.metadata },
          content: [{ type: 'content', content: { type: 'text', text } }] });
        break;
      }
      case 'permission.asked':
        void this.replyPermission(event).catch(error => this.fail(asError(error)));
        break;
      case 'session.step.ended': {
        const tokens = event.data.tokens;
        const size = this.currentModel(this.requireSession(sessionId))?.limit.context;
        if (tokens) this.usage.set(sessionId, {
          totalTokens: tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write,
          inputTokens: tokens.input, outputTokens: tokens.output, thoughtTokens: tokens.reasoning,
          cachedReadTokens: tokens.cache.read, cachedWriteTokens: tokens.cache.write,
        });
        if (tokens && size) this.emit(sessionId, { sessionUpdate: 'usage_update', size,
          used: tokens.input + tokens.cache.read + tokens.cache.write + tokens.output,
          ...(event.data.cost ? { cost: { amount: event.data.cost, currency: 'USD' } } : {}) });
        break;
      }
      case 'session.execution.succeeded':
        this.finishTurn(sessionId, { stopReason: 'end_turn', usage: this.usage.get(sessionId) });
        break;
      case 'session.execution.interrupted':
        this.finishTurn(sessionId, { stopReason: 'cancelled' });
        break;
      case 'session.execution.failed':
        this.finishTurn(sessionId, event.data.error.type === 'aborted' ? { stopReason: 'cancelled' }
          : new JsonRpcErrorResponse('session/prompt', -32603, event.data.error.message ?? event.data.error.type));
        break;
    }
  }

  private finishTurn(sessionId: string, result: AcpPromptResponse | Error): void {
    const error = this.turnErrors.get(sessionId) ?? (result instanceof Error ? result : undefined);
    if (error) this.turns.get(sessionId)?.reject(error);
    else this.turns.get(sessionId)?.resolve(result as AcpPromptResponse);
  }

  private async replyPermission(event: Extract<OpenCodeEvent, { type: 'permission.asked' }>) {
    const request = event.data;
    const turn = this.turns.get(request.sessionID);
    if (this.permissions.has(request.id)) return;
    this.permissions.set(request.id, request.sessionID);
    const tool = request.source?.type === 'tool' ? this.tools.get(request.source.id) : undefined;
    const response = await this.options.requestPermission({
      sessionId: request.sessionID,
      toolCall: {
        toolCallId: request.source?.id ?? request.id,
        title: request.action === 'shell' ? 'bash' : request.action,
        rawInput: Object.keys(tool?.input ?? {}).length ? normalizeOpencodeToolInput(tool?.name, tool!.input)
          : request.action === 'shell' ? { command: request.resources.join('\n') } : { file_path: request.resources[0] },
      },
      options: [
        { optionId: 'once', kind: 'allow_once', name: 'Allow once' },
        { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
        { optionId: 'reject', kind: 'reject_once', name: 'Deny' },
      ],
    });
    if (this.closed || this.turns.get(request.sessionID) !== turn) return;
    const selected = response.outcome.outcome === 'selected' ? response.outcome.optionId : 'reject';
    const decision = selected === 'once' || selected === 'always' ? selected : 'reject';
    await this.post(`/api/session/${encodeURIComponent(request.sessionID)}/permission/${encodeURIComponent(request.id)}/reply`, { decision });
  }

  private async replyForm(form: FormInfo1): Promise<void> {
    if (this.forms.has(form.id)) return;
    this.forms.set(form.id, form.sessionID);
    const turn = this.turns.get(form.sessionID);
    const questions = opencodeFormQuestions(form);
    if (!questions) {
      this.turnErrors.set(form.sessionID, new JsonRpcErrorResponse('session/prompt', -32603,
        'OpenCode requested an external or conditional form. Complete this interaction in the OpenCode CLI.'));
      await this.api.form.cancel({ sessionID: form.sessionID, formID: form.id }, this.requestOptions());
      await this.api.session.interrupt({ sessionID: form.sessionID }, this.requestOptions());
      return;
    }
    const response = await this.options.requestPermission({
      sessionId: form.sessionID,
      toolCall: { toolCallId: form.id, title: 'grimoire-question', rawInput: { grimoireForm: true, questions } },
      options: [{ optionId: 'answered', kind: 'allow_once', name: 'Answer' }, { optionId: 'cancel', kind: 'reject_once', name: 'Cancel' }],
    }) as OpencodeQuestionResponse;
    if (this.closed || this.turns.get(form.sessionID) !== turn) return;
    const answer = response.outcome.outcome === 'selected' && response.answers
      ? opencodeFormAnswers(form, response.answers) : null;
    if (!answer) await this.api.form.cancel({ sessionID: form.sessionID, formID: form.id }, this.requestOptions());
    else await this.api.form.reply({ sessionID: form.sessionID, formID: form.id, answer }, this.requestOptions());
  }

  // These two payload names changed after client 2.0.0. Keep the verified V2.0.16
  // wire shape while the SDK dependency remains within the repository's age gate.
  private async post(path: string, body: Record<string, unknown>): Promise<void> {
    const response = await createNodeFetch()(new URL(path, this.options.url), {
      method: 'POST', signal: this.lifetime.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(`opencode:${this.options.password}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`OpenCode V2 request failed (${response.status}).`);
    await response.text();
  }

  private emit(sessionId: string, update: AcpSessionNotification['update']) {
    for (const listener of this.notifications) listener({ sessionId, update });
  }

  private fail(error: Error) {
    if (this.closed) return;
    this.connected.reject(error);
    for (const turn of this.turns.values()) turn.reject(error);
    for (const listener of this.lost) listener(error);
    void this.close();
  }
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function asError(error: unknown): Error { return error instanceof Error ? error : new Error(String(error)); }
