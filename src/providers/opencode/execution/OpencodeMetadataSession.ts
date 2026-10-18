import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
  ManagedAcpClientFactoryInput,
} from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpNewSessionRequest, AcpNewSessionResponse, AcpSessionConfigOption, AcpSessionNotification } from '@/providers/acp/types';
import { OpencodeSessionConfigState } from '@/providers/opencode/execution/OpencodeSessionConfigState';

/** Where an isolated OpenCode process is launched, and what it is launched for. */
export interface OpencodeMetadataLaunch {
  readonly startupRef: string;
  readonly cwd: string;
  readonly mcpServers: AcpNewSessionRequest['mcpServers'];
}

export interface OpencodeMetadataSessionPorts {
  readonly clientFactory: OpencodeMetadataClientFactory;
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

export interface OpencodeMetadata {
  readonly state: Omit<AcpNewSessionResponse, 'sessionId'>;
  readonly modelConfigOptions?: AcpSessionConfigOption[];
  readonly commands: readonly OpencodeMetadataCommand[];
}

export interface OpencodeMetadataClient extends ManagedAcpClient {
  readMetadata?(rawModelId?: string): Promise<OpencodeMetadata>;
}

export interface OpencodeMetadataClientFactory extends ManagedAcpClientFactory {
  createMetadata?(input: ManagedAcpClientFactoryInput): Promise<OpencodeMetadataClient>;
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
 * V2 reads metadata directly, using the native database for credentials without
 * creating a session. V1 opens an in-memory ACP session. Both close their owned
 * process on success and failure.
 */
export class OpencodeMetadataSession {
  constructor(private readonly ports: OpencodeMetadataSessionPorts) {}

  /** Reads the catalog and, when requested, a model's reasoning options. */
  async discoverMetadata(options: { readonly rawModelId?: string } = {}): Promise<boolean> {
    const metadata = await this.readMetadata(options);
    if (!metadata) return false;
    const config = this.createConfigState();
    try {
      await config.syncSessionModelState({
        configOptions: metadata.state.configOptions ?? null,
        models: metadata.state.models ?? null,
      });
      await config.syncSessionModeState({
        configOptions: metadata.state.configOptions ?? null,
        // Discovery must not change the user's permission mode.
        emitPermissionSync: false,
        modes: metadata.state.modes ?? null,
      });
      if (options.rawModelId && metadata.modelConfigOptions) {
        await config.syncSessionModelState(
          { configOptions: metadata.modelConfigOptions },
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
    } catch {
      return false;
    }
  }

  /** Reads native V2 commands or waits briefly for a V1 ACP announcement. */
  async listCommands(): Promise<readonly OpencodeMetadataCommand[]> {
    return (await this.readMetadata({ commands: true }))?.commands ?? [];
  }

  private async readMetadata(options: { rawModelId?: string; commands?: boolean }): Promise<OpencodeMetadata | undefined> {
    const launch = await this.ports.launch();
    const abort = new AbortController();
    let client: OpencodeMetadataClient | undefined;
    try {
      const input: ManagedAcpClientFactoryInput = {
        startupRef: launch.startupRef,
        signal: abort.signal,
        // Nothing here runs a tool, so nothing here may be asked to allow one.
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
      };
      client = await (this.ports.clientFactory.createMetadata?.(input)
        ?? this.ports.clientFactory.create(input));
      await client.initialize();
      if (client.readMetadata) return await client.readMetadata(options.rawModelId);

      const announcement = collectAnnouncedCommands(client);
      const opened = await client.newSession({
        cwd: launch.cwd,
        mcpServers: [...launch.mcpServers],
      });
      // The session exists, so the announcement is either already in or is
      // about to be; from here the wait is bounded.
      announcement.arm();
      const applied = options.rawModelId ? await client.setConfigOption({
        configId: 'model', sessionId: opened.sessionId, type: 'select', value: options.rawModelId,
      }) : undefined;
      return {
        state: opened,
        modelConfigOptions: applied?.configOptions,
        commands: options.commands ? await announcement.commands : [],
      };
    } catch {
      // Every caller is opportunistic: a metadata session that could not open
      // is a question left unanswered, not a failure to report. The first real
      // turn asks it again.
      return undefined;
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
