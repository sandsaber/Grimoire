import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
} from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpNewSessionRequest, AcpSessionNotification } from '@/providers/acp/types';
import { GrokSessionConfigState } from '@/providers/grok/execution/GrokSessionConfigState';
import { decodeGrokModelId, resolveGrokBaseModelRawId } from '@/providers/grok/models';
import { getGrokProviderSettings } from '@/providers/grok/settings';

/** Where an isolated Grok process is launched, and what it is launched for. */
export interface GrokMetadataLaunch {
  readonly startupRef: string;
  readonly cwd: string;
  readonly mcpServers: AcpNewSessionRequest['mcpServers'];
}

export interface GrokMetadataSessionPorts {
  readonly clientFactory: ManagedAcpClientFactory;
  /** The process to spawn, prepared for this question and no conversation. */
  readonly launch: () => Promise<GrokMetadataLaunch>;
  readonly settingsBag: () => Record<string, unknown>;
  readonly saveSettings: () => Promise<void>;
  readonly refreshSelectors: () => void;
  readonly workspaceRoot: () => string;
  readonly cliPath: () => string;
}

/** One command a session offers, as the vault's own command surfaces read them. */
export interface GrokMetadataCommand {
  readonly name: string;
  readonly description?: string;
}

/** How long a session is given to announce its commands before it is closed. */
const COMMAND_ANNOUNCEMENT_MS = 250;

/**
 * What Grimoire asks Grok when nobody is having a conversation.
 *
 * Five surfaces need the same two answers — which models exist and what a model
 * can think at, and which commands a session offers — and each of them got them
 * by constructing a whole `GrokChatRuntime` and driving it as far as a session.
 * That is the only thing the legacy runtime was doing for them.
 *
 * Isolated by its own managed home, which is the same isolation the auxiliary
 * query runner already uses: a question asked from a settings surface must not
 * bind a session to a conversation or leave one in the chat home's session
 * store. The client is closed on every path, including the ones that failed.
 */
export class GrokMetadataSession {
  constructor(private readonly ports: GrokMetadataSessionPorts) {}

  /**
   * Opens a session, keeps what it reports, and closes it.
   *
   * With a model, it also selects that model first: the thinking levels a model
   * offers are reported in the reply to selecting it and nowhere else, which is
   * what the model-metadata warmups are actually for.
   */
  async discoverMetadata(options: { readonly model?: string } = {}): Promise<boolean> {
    const rawModelId = options.model ? decodeGrokModelId(options.model) : null;
    if (options.model && !rawModelId) {
      return false;
    }
    return this.withSession(async (client, sessionId, config, opened) => {
      await config.syncSessionModelState({
        configOptions: opened.configOptions ?? null,
        models: opened.models ?? null,
      });
      await config.syncSessionModeState({
        configOptions: opened.configOptions ?? null,
        modes: opened.modes ?? null,
      });
      if (!rawModelId) {
        return true;
      }
      const baseRawModelId = this.resolveWarmableModel(rawModelId);
      if (!baseRawModelId) {
        // A model the vault has never discovered is not one this session can be
        // asked about, and asking anyway is how a stale selection gets sent.
        return false;
      }
      await client.setModel({ modelId: baseRawModelId, sessionId });
      config.markApplied({ modelId: baseRawModelId });
      await config.syncSessionModelState({}, {
        currentRawModelId: baseRawModelId,
        // A question asked from a settings surface must not become the vault's
        // active selection: the user is looking at a list, not choosing from it.
        seedActiveSelection: false,
      });
      return true;
    });
  }

  /**
   * The slash commands a fresh session announces.
   *
   * ACP reports them as an update rather than as an answer, so there is nothing
   * to await but the announcement itself — bounded, because a session that
   * offers none says nothing at all and the caller is a UI that must not wait
   * on silence.
   */
  async listCommands(): Promise<readonly GrokMetadataCommand[]> {
    let announced: readonly GrokMetadataCommand[] = [];
    const collected = await this.withSession(async (_client, _sessionId, _config, _opened, updates) => {
      announced = await updates;
      return true;
    });
    return collected ? announced : [];
  }

  /** The base model this vault knows about, or nothing to ask about. */
  private resolveWarmableModel(rawModelId: string): string | null {
    const discoveredModels = getGrokProviderSettings(this.ports.settingsBag()).discoveredModels;
    const baseRawModelId = resolveGrokBaseModelRawId(rawModelId, discoveredModels);
    if (!baseRawModelId) {
      return null;
    }
    const availableModelIds = new Set(discoveredModels.map(model => model.rawId));
    return availableModelIds.size > 0 && !availableModelIds.has(baseRawModelId)
      ? null
      : baseRawModelId;
  }

  private async withSession(
    read: (
      client: ManagedAcpClient,
      sessionId: string,
      config: GrokSessionConfigState,
      opened: Awaited<ReturnType<ManagedAcpClient['newSession']>>,
      commands: Promise<readonly GrokMetadataCommand[]>,
    ) => Promise<boolean>,
  ): Promise<boolean> {
    const launch = await this.ports.launch();
    const abort = new AbortController();
    let client: ManagedAcpClient | undefined;
    try {
      client = await this.ports.clientFactory.create({
        startupRef: launch.startupRef,
        signal: abort.signal,
        // Nothing here runs a tool, so nothing here may be asked to allow one.
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
      });
      const announcement = collectAnnouncedCommands(client);
      await client.initialize();
      const opened = await client.newSession({
        cwd: launch.cwd,
        mcpServers: [...launch.mcpServers],
      });
      // The session exists, so the announcement is either already in or is
      // about to be; from here the wait is bounded.
      announcement.arm();
      return await read(
        client,
        opened.sessionId,
        this.createConfigState(),
        opened,
        announcement.commands,
      );
    } catch {
      // Every caller is opportunistic: a metadata session that could not open
      // is a question left unanswered, not a failure to report. The first real
      // turn asks it again.
      return false;
    } finally {
      abort.abort();
      if (client) {
        await client.close().catch(() => undefined);
      }
    }
  }

  private createConfigState(): GrokSessionConfigState {
    return new GrokSessionConfigState({
      settingsBag: () => this.ports.settingsBag(),
      saveSettings: () => this.ports.saveSettings(),
      refreshSelectors: () => this.ports.refreshSelectors(),
      workspaceRoot: () => this.ports.workspaceRoot(),
      cliPath: () => this.ports.cliPath(),
      // A question nobody asked for is not worth a debug record of its own; the
      // chat path already logs what a session reported.
      recordDebug: () => undefined,
    });
  }
}

/**
 * The announcement, listened for from before the session exists and only
 * waited on once it does.
 *
 * Two separate moments, and OpenCode's live run proved why one is not enough.
 * The listener has to be installed before `session/new`, because the
 * announcement follows it immediately and a subscription made afterwards misses
 * it. The countdown has to start after, because launching a cold process and
 * initializing it takes seconds — a window opened at subscription time expires
 * before the session is even created, and every command list comes back empty.
 */
function collectAnnouncedCommands(client: ManagedAcpClient): {
  readonly commands: Promise<readonly GrokMetadataCommand[]>;
  readonly arm: () => void;
} {
  let settle: ((commands: readonly GrokMetadataCommand[]) => void) | undefined;
  let timer: number | undefined;
  const commands = new Promise<readonly GrokMetadataCommand[]>(resolve => {
    settle = resolve;
  });
  const finish = (announced: readonly GrokMetadataCommand[]): void => {
    if (!settle) {
      return;
    }
    const resolve = settle;
    settle = undefined;
    unsubscribe();
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
    resolve(announced);
  };
  const unsubscribe = client.onSessionNotification((notification: AcpSessionNotification) => {
    if (notification.update.sessionUpdate !== 'available_commands_update') {
      return;
    }
    finish(notification.update.availableCommands.map(command => ({
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
    })));
  });
  return {
    commands,
    arm: () => {
      if (settle && timer === undefined) {
        timer = window.setTimeout(() => finish([]), COMMAND_ANNOUNCEMENT_MS);
      }
    },
  };
}
