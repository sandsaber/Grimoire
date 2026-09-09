import type {
  ManagedAcpClient,
  ManagedAcpClientFactory,
} from '@/providers/acp/execution/ManagedAcpClient';
import type { AcpNewSessionRequest } from '@/providers/acp/types';
import { DevinSessionConfigState } from '@/providers/devin/execution/DevinSessionConfigState';

/** Where an isolated Devin process is launched, and what it is launched for. */
export interface DevinMetadataLaunch {
  readonly startupRef: string;
  readonly cwd: string;
  readonly mcpServers: AcpNewSessionRequest['mcpServers'];
}

export interface DevinMetadataSessionPorts {
  readonly clientFactory: ManagedAcpClientFactory;
  /** The process to spawn, prepared for this question and no conversation. */
  readonly launch: () => Promise<DevinMetadataLaunch>;
  readonly settingsBag: () => Record<string, unknown>;
  readonly saveSettings: () => Promise<void>;
  readonly refreshSelectors: () => void;
}

/**
 * What Grimoire asks Devin when nobody is having a conversation.
 *
 * The model catalog and the settings tab want the same answer — which models
 * this account has over ACP — and one reply to `session/new` is the whole of
 * it. **Not `devin models list`**: that command lists what the account could
 * be configured to use, while the ACP session offers only what it will take
 * (recorded: forty-six families from the command, one model from the session,
 * and `-32002 Model not found` for the rest). The session is the source.
 *
 * Isolated by construction — no conversation is bound, no turn is prompted,
 * and the client is closed on every path including the ones that failed.
 */
export class DevinMetadataSession {
  constructor(private readonly ports: DevinMetadataSessionPorts) {}

  /** Opens a session, keeps the models and modes it reports, and closes it. */
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
      const config = new DevinSessionConfigState({
        settingsBag: () => this.ports.settingsBag(),
      });
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
      // A metadata session that could not open is a question left unanswered,
      // not a failure to report. The first real turn asks it again.
      return false;
    } finally {
      abort.abort();
      if (client) {
        await client.close().catch(() => undefined);
      }
    }
  }
}
