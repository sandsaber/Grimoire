import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
} from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpNewSessionRequest, AcpSessionNotification } from '@/providers/acp/types';
import { OpencodeSessionConfigState } from '@/providers/opencode/execution/OpencodeSessionConfigState';

/** Where an isolated OpenCode process is launched, and what it is launched for. */
export interface OpencodeMetadataLaunch {
  readonly startupRef: string;
  readonly cwd: string;
  readonly mcpServers: AcpNewSessionRequest['mcpServers'];
}

export interface OpencodeMetadataSessionPorts {
  readonly clientFactory: ManagedAcpClientFactory;
  /** The process to spawn, prepared for this question and no conversation. */
  readonly launch: () => Promise<OpencodeMetadataLaunch>;
  readonly settingsBag: () => Record<string, unknown>;
  readonly saveSettings: () => Promise<void>;
  readonly refreshSelectors: () => void;
}

/** One command a session offers, as the vault's own command surfaces read them. */
export interface OpencodeMetadataCommand {
  readonly name: string;
  readonly description?: string;
}

/** How long a session is given to announce its commands before it is closed. */
const COMMAND_ANNOUNCEMENT_MS = 250;

/**
 * What Grimoire asks OpenCode when nobody is having a conversation.
 *
 * Four surfaces need the same two answers — which models exist, and which
 * commands a session offers — and each of them used to get them by constructing
 * a whole `OpencodeChatRuntime` and driving it as far as a session. That is the
 * only thing the legacy runtime was doing for them: opening a session and
 * reading its reply.
 *
 * Isolated by construction. The launch it asks for points OpenCode at an
 * in-memory database, so nothing here binds a session to a conversation, writes
 * to the vault's OpenCode state, or leaves a process behind — the client is
 * closed on every path, including the ones that failed.
 */
export class OpencodeMetadataSession {
  constructor(private readonly ports: OpencodeMetadataSessionPorts) {}

  /**
   * Opens a session, keeps what it reports, and closes it.
   *
   * With a model, it also sets that model first: the thinking levels a model
   * offers are reported in the reply to selecting it and nowhere else, which is
   * what the model-metadata warmups are actually for.
   */
  async discoverMetadata(options: { readonly rawModelId?: string } = {}): Promise<boolean> {
    return this.withSession(async (client, sessionId, config, opened) => {
      await config.syncSessionModelState({
        configOptions: opened.configOptions ?? null,
        models: opened.models ?? null,
      });
      await config.syncSessionModeState({
        configOptions: opened.configOptions ?? null,
        // The default agent a new session reports is OpenCode's, not the
        // user's pick, and this session has no toolbar to push it at anyway.
        emitPermissionSync: false,
        modes: opened.modes ?? null,
      });
      if (options.rawModelId) {
        const applied = await client.setConfigOption({
          configId: 'model',
          sessionId,
          type: 'select',
          value: options.rawModelId,
        });
        await config.syncSessionModelState(
          { configOptions: applied.configOptions },
          {
            currentRawModelId: options.rawModelId,
            // A question asked from a settings surface must not become the
            // vault's active selection: the user is looking at a list, not
            // choosing from it.
            seedActiveSelection: false,
          },
        );
      }
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
  async listCommands(): Promise<readonly OpencodeMetadataCommand[]> {
    let announced: readonly OpencodeMetadataCommand[] = [];
    const collected = await this.withSession(async (client, _sessionId, _config, _opened, updates) => {
      announced = await updates;
      return true;
    });
    return collected ? announced : [];
  }

  private async withSession(
    read: (
      client: ManagedAcpClient,
      sessionId: string,
      config: OpencodeSessionConfigState,
      opened: Awaited<ReturnType<ManagedAcpClient['newSession']>>,
      commands: Promise<readonly OpencodeMetadataCommand[]>,
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

  private createConfigState(): OpencodeSessionConfigState {
    return new OpencodeSessionConfigState({
      settingsBag: () => this.ports.settingsBag(),
      saveSettings: () => this.ports.saveSettings(),
      refreshSelectors: () => this.ports.refreshSelectors(),
      // No conversation, no toolbar: a session opened to answer a question has
      // no mode for the user to be told about.
      syncPermissionMode: () => undefined,
    });
  }
}

/**
 * The announcement, listened for from before the session exists and only
 * waited on once it does.
 *
 * Two separate moments, and a live run proved why one is not enough. The
 * listener has to be installed before `session/new`, because the announcement
 * follows it immediately and a subscription made afterwards misses it. The
 * countdown has to start after, because launching a cold process and
 * initializing it takes seconds — a window opened at subscription time expires
 * before the session is even created, and every command list comes back empty.
 */
function collectAnnouncedCommands(client: ManagedAcpClient): {
  readonly commands: Promise<readonly OpencodeMetadataCommand[]>;
  readonly arm: () => void;
} {
  let settle: ((commands: readonly OpencodeMetadataCommand[]) => void) | undefined;
  let timer: number | undefined;
  const commands = new Promise<readonly OpencodeMetadataCommand[]>(resolve => {
    settle = resolve;
  });
  const finish = (announced: readonly OpencodeMetadataCommand[]): void => {
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
