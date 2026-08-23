import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
} from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpNewSessionRequest } from '@/providers/acp/types';
import { GeminiSessionConfigState } from '@/providers/gemini/execution/GeminiSessionConfigState';

/** Where an isolated Gemini process is launched, and what it is launched for. */
export interface GeminiMetadataLaunch {
  readonly startupRef: string;
  readonly cwd: string;
  readonly mcpServers: AcpNewSessionRequest['mcpServers'];
}

export interface GeminiMetadataSessionPorts {
  readonly clientFactory: ManagedAcpClientFactory;
  /** The process to spawn, prepared for this question and no conversation. */
  readonly launch: () => Promise<GeminiMetadataLaunch>;
  readonly settingsBag: () => Record<string, unknown>;
  readonly saveSettings: () => Promise<void>;
  readonly refreshSelectors: () => void;
}

/**
 * What Grimoire asks Gemini when nobody is having a conversation.
 *
 * The model catalog, the settings tab and the chat toolbar all want the same
 * answer — which models this CLI has — and `GeminiWorkspaceServices` gets it
 * today by constructing a whole `GeminiChatRuntime` and driving it as far as a
 * session. Opening a session and reading its reply is the only thing that
 * runtime was doing for them.
 *
 * The shortest metadata session of the five, and the recording is why. Gemini
 * answers `session/new` with `models` **and** `modes` at once and no config
 * options at all, so one reply is the whole answer: there is no second call to
 * select a model and read back the thinking levels it offers, because this
 * provider has none, and no announcement to wait on, because its commands are
 * the vault's rather than the session's.
 *
 * Isolated by construction — no conversation is bound, no turn is prompted, and
 * the client is closed on every path including the ones that failed. It is not
 * isolated the way the OpenCode family's is: those point the CLI at an
 * in-memory database so a question cannot touch the vault's provider state.
 * Gemini keeps no such state to be pointed away from.
 */
export class GeminiMetadataSession {
  constructor(private readonly ports: GeminiMetadataSessionPorts) {}

  /**
   * Opens a session, keeps the models and modes it reports, and closes it.
   *
   * Answers whether anything was learned, which is what the model catalog
   * reports as "the list changed" — it compared the stored catalogue before and
   * after for the same reason.
   */
  async discoverMetadata(): Promise<boolean> {
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
      await client.initialize();
      const opened = await client.newSession({
        cwd: launch.cwd,
        mcpServers: [...launch.mcpServers],
      });
      const config = new GeminiSessionConfigState({
        settingsBag: () => this.ports.settingsBag(),
      });
      // The mode this reports is Gemini's own default, and this session has no
      // toolbar to push it at anyway — which is why the state records it and
      // stops there, and why no `emitPermissionSync: false` flag is needed to
      // stop it going further.
      const changed = config.syncSessionDiscovery({
        configOptions: opened.configOptions ?? null,
        models: opened.models ?? null,
        modes: opened.modes ?? null,
      });
      if (changed) {
        await this.ports.saveSettings();
        this.ports.refreshSelectors();
      }
      return changed;
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
}
