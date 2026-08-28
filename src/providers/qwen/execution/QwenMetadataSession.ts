import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
} from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpNewSessionRequest } from '@/providers/acp/types';
import { QwenSessionConfigState } from '@/providers/qwen/execution/QwenSessionConfigState';

/** Where an isolated Qwen process is launched, and what it is launched for. */
export interface QwenMetadataLaunch {
  readonly startupRef: string;
  readonly cwd: string;
  readonly mcpServers: AcpNewSessionRequest['mcpServers'];
}

export interface QwenMetadataSessionPorts {
  readonly clientFactory: ManagedAcpClientFactory;
  /** The process to spawn, prepared for this question and no conversation. */
  readonly launch: () => Promise<QwenMetadataLaunch>;
  readonly settingsBag: () => Record<string, unknown>;
  readonly saveSettings: () => Promise<void>;
  readonly refreshSelectors: () => void;
}

/**
 * What Grimoire asks Qwen when nobody is having a conversation.
 *
 * The model catalog, the settings tab and the chat toolbar all want the same
 * answer — which models this CLI has — and `QwenWorkspaceServices` got it by
 * constructing a whole `QwenChatRuntime` and driving it as far as a session,
 * until this replaced it. Opening a session and reading its reply is the only
 * thing that runtime was doing for them.
 *
 * As short as Gemini's, for two of the same reasons and one of its own. One
 * reply is the whole answer — there is no second call to select a model and read
 * back the levels it offers, because this provider's levels are a fixed five it
 * names itself rather than something a session advertises. And there is no
 * command announcement to wait on **here**: Qwen does surface the commands a
 * session announces, unlike Gemini, but the tab holding that session is what
 * collects them, so a question asked in nobody's conversation has no reason to.
 *
 * Isolated by construction — no conversation is bound, no turn is prompted, and
 * the client is closed on every path including the ones that failed. It is not
 * isolated the way the OpenCode family's is: those point the CLI at an in-memory
 * database so a question cannot touch the vault's provider state. Qwen, like
 * Gemini, keeps no such state to be pointed away from.
 *
 * **It has never opened.** `qwen 0.21.15` refuses `session/new` with
 * "Authentication required" on the machine this was written on, so what this
 * stands on is the runtime it replaced driving the same CLI, not an
 * observation.
 */
export class QwenMetadataSession {
  constructor(private readonly ports: QwenMetadataSessionPorts) {}

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
      const config = new QwenSessionConfigState({
        settingsBag: () => this.ports.settingsBag(),
      });
      // The mode this reports is Qwen's own default, and this session has no
      // toolbar to push it at anyway. The state records it and stops — which is
      // what the legacy runtime did *not* do, and why opening a session used to
      // switch a vault off Plan and save it.
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
