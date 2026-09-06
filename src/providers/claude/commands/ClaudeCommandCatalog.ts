import type { DebugLogEvent } from '../../../core/debug/DebugLogService';
import type {
  ProviderCommandCatalog,
} from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import type { ProviderCatalogRefreshOutcome } from '../../../core/providers/ProviderModelCatalogRefreshCache';
import type { SlashCommand } from '../../../core/types';
import { isSkill } from '../../../utils/slashCommand';
import { CLAUDE_EMPTY_DISCOVERY_RETRY_MS } from '../cli/claudeCatalogCache';
import type { SkillStorage } from '../storage/SkillStorage';
import type { SlashCommandStorage } from '../storage/SlashCommandStorage';
import type { RuntimeCommandCacheStore } from './ClaudeRuntimeCommandCacheStore';

function slashCommandToEntry(cmd: SlashCommand): ProviderCommandEntry {
  const skill = isSkill(cmd);
  return {
    id: cmd.id,
    providerId: 'claude',
    kind: skill ? 'skill' : 'command',
    name: cmd.name,
    description: cmd.description,
    content: cmd.content,
    argumentHint: cmd.argumentHint,
    allowedTools: cmd.allowedTools,
    model: cmd.model,
    disableModelInvocation: cmd.disableModelInvocation,
    userInvocable: cmd.userInvocable,
    context: cmd.context,
    agent: cmd.agent,
    hooks: cmd.hooks,
    scope: cmd.source === 'sdk' ? 'runtime' : 'vault',
    source: cmd.source ?? 'user',
    isEditable: cmd.source !== 'sdk',
    isDeletable: cmd.source !== 'sdk',
    displayPrefix: '/',
    insertPrefix: '/',
  };
}

function entryToSlashCommand(entry: ProviderCommandEntry): SlashCommand {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    content: entry.content,
    argumentHint: entry.argumentHint,
    allowedTools: entry.allowedTools,
    model: entry.model,
    disableModelInvocation: entry.disableModelInvocation,
    userInvocable: entry.userInvocable,
    context: entry.context,
    agent: entry.agent,
    hooks: entry.hooks,
    source: entry.source,
    kind: entry.kind,
  };
}

// SDK built-in skills that have no meaning inside Grimoire
const BUILTIN_HIDDEN_COMMANDS = new Set([
  'context', 'cost', 'debug', 'extra-usage', 'heapdump', 'init',
  'insights', 'loop', 'schedule', 'security-review', 'simplify', 'update-config',
]);


export type CommandProbe = () => Promise<SlashCommand[]>;

export interface RuntimeCommandCatalogDeps {
  cache?: RuntimeCommandCacheStore;
  recordEvent?: (event: DebugLogEvent) => void;
}

export class ClaudeCommandCatalog implements ProviderCommandCatalog {
  private sdkCommands: SlashCommand[] = [];
  private probePromise: Promise<void> | null = null;
  // A list restored from the cache is a snapshot: it can miss a skill created
  // since it was written, so it is merged with the vault before display. A list
  // from a live session is authoritative and is shown as-is.
  private sdkCommandsFromCache = false;
  // In memory on purpose: a probe that found nothing must be retried after the
  // user installs or logs into the CLI, and persisting the attempt would keep
  // the dropdown empty across a restart that was meant to fix it.
  private emptyProbeAtByFingerprint = new Map<string, number>();

  constructor(
    private commandStorage: SlashCommandStorage,
    private skillStorage: SkillStorage,
    private probe?: CommandProbe,
    private deps: RuntimeCommandCatalogDeps = {},
  ) {}

  setRuntimeCommands(commands: SlashCommand[]): void {
    this.sdkCommands = commands;
    this.sdkCommandsFromCache = false;
    // An empty list is a reset, not a discovery: TabManager clears the catalog
    // for a blank tab that skips warmup. Keeping the cache means the next
    // dropdown open is served from it instead of paying for a probe.
    if (commands.length > 0) {
      void this.writeCache(commands, this.safeFingerprint());
    }
  }

  async listDropdownEntries(context: { includeBuiltIns: boolean }): Promise<ProviderCommandEntry[]> {
    void context;
    // SDK commands already include vault commands/skills (the SDK scans
    // .claude/commands/ and .claude/skills/ internally). No file scan needed.
    // A probe starts a full Claude Code session and bills against the plan
    // window, so a list persisted under the same configuration is reused first
    // and the probe only runs when there is nothing to reuse.
    // One digest for the whole call: computing it stats the CLI binary and
    // re-normalizes the persisted settings, and this runs on every keystroke
    // that reopens the dropdown.
    const fingerprint = this.sdkCommands.length === 0 ? this.safeFingerprint() : '';
    if (this.sdkCommands.length === 0) {
      this.hydrateFromCache(fingerprint);
    }
    if (this.sdkCommands.length === 0 && this.probe) {
      await this.ensureProbed(fingerprint);
    }
    const runtimeEntries = this.sdkCommands
      .filter(cmd => !BUILTIN_HIDDEN_COMMANDS.has(cmd.name.toLowerCase()))
      .map(slashCommandToEntry);
    if (runtimeEntries.length === 0) {
      return this.listVaultEntries();
    }
    if (!this.sdkCommandsFromCache) {
      return runtimeEntries;
    }
    return this.mergeWithVaultEntries(runtimeEntries);
  }

  /** Restores a list persisted under the current configuration. Never probes. */
  private hydrateFromCache(fingerprint: string): void {
    const cache = this.deps.cache;
    if (!cache) return;
    try {
      const record = cache.read();
      if (!record || record.commands.length === 0) return;
      if (record.fingerprint !== fingerprint) return;
      this.sdkCommands = record.commands;
      this.sdkCommandsFromCache = true;
      this.record('commandCatalog.probe.skipped', 'debug', {
        commandCount: record.commands.length,
        reason: 'cache_fresh',
      });
    } catch {
      // A cache that cannot be read or keyed leaves today's behaviour intact.
    }
  }

  /**
   * The digest of the current configuration. A digest that cannot be computed
   * collapses to one shared bucket rather than disabling the pacing: without a
   * key nothing would ever be recorded and nothing skipped, which is the
   * probe-per-keystroke this class exists to stop.
   */
  private safeFingerprint(): string {
    const cache = this.deps.cache;
    if (!cache) return '';
    try {
      return cache.currentFingerprint();
    } catch {
      return '';
    }
  }

  /**
   * Files a list under the configuration it actually came from. Reading the
   * digest here instead would stamp a list discovered under one configuration
   * with another's key when the two straddle a settings edit or a CLI upgrade -
   * and with no expiry, that mislabelling never heals.
   */
  private async writeCache(commands: SlashCommand[], fingerprint: string): Promise<void> {
    const cache = this.deps.cache;
    if (!cache) return;
    try {
      if (cache.currentFingerprint() !== fingerprint) {
        this.record('commandCatalog.cache.skipped', 'debug', {
          reason: 'configuration_changed',
        });
        return;
      }
      await cache.write({ commands, fingerprint });
    } catch (error) {
      this.record('commandCatalog.cache.writeFailed', 'warn', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private record(
    event: string,
    level: DebugLogEvent['level'],
    data: Record<string, unknown>,
  ): void {
    this.deps.recordEvent?.({
      data: { providerId: 'claude', ...data },
      event,
      level,
      scope: 'provider.claude',
    });
  }

  /** Probe the SDK for commands. Deduplicates concurrent calls. */
  private async ensureProbed(fingerprint: string, options: { force?: boolean } = {}): Promise<void> {
    if (!this.probe) return;
    if (!options.force) {
      const lastEmptyAt = this.emptyProbeAtByFingerprint.get(fingerprint);
      if (lastEmptyAt !== undefined && Date.now() - lastEmptyAt < CLAUDE_EMPTY_DISCOVERY_RETRY_MS) {
        this.record('commandCatalog.probe.skipped', 'debug', {
          ageMs: Date.now() - lastEmptyAt,
          reason: 'empty_attempt_throttled',
        });
        return;
      }
    } else if (this.probePromise) {
      // A probe already running is itself a fresh discovery, so a forced
      // refresh waits for it rather than starting a second billed session
      // beside it. Only if it produced nothing does the force spend one.
      await this.probePromise;
      if (this.sdkCommands.length > 0) {
        return;
      }
    }
    if (!this.probePromise) {
      this.record('commandCatalog.probe.started', 'debug', { forced: options.force === true });
      this.probePromise = this.probe().then(async (commands) => {
        if (commands.length === 0) {
          this.emptyProbeAtByFingerprint.set(fingerprint, Date.now());
          this.record('commandCatalog.probe.empty', 'debug', {});
          return;
        }
        // A probe the user asked for is the freshest thing there is, so it
        // wins even against a list a session handed over while it ran -
        // otherwise the billed session is spent and thrown away while the
        // settings tab reports success.
        const applied = options.force === true || this.sdkCommands.length === 0;
        if (applied) {
          this.sdkCommands = commands;
          this.sdkCommandsFromCache = false;
        }
        this.record('commandCatalog.probe.succeeded', 'info', {
          applied,
          commandCount: commands.length,
        });
        if (applied) {
          await this.writeCache(commands, fingerprint);
        }
      }).catch((error) => {
        // Probe is best-effort. A throw is treated like an empty result: the
        // cause is usually a missing or broken CLI, and retrying it on every
        // dropdown open is exactly the behaviour this window exists to stop.
        this.emptyProbeAtByFingerprint.set(fingerprint, Date.now());
        this.record('commandCatalog.probe.failed', 'warn', {
          message: error instanceof Error ? error.message : String(error),
        });
      }).finally(() => {
        this.probePromise = null;
      });
    }
    await this.probePromise;
  }

  /**
   * A cached list is a snapshot of what the SDK reported earlier, while the vault
   * folders it was built from keep changing. Reading them costs nothing, so the
   * snapshot is topped up with what is on disk right now. The vault version wins
   * a name collision: it is a real, editable file the user owns, whereas the
   * cached entry is only a description of it.
   */
  private async mergeWithVaultEntries(
    runtimeEntries: ProviderCommandEntry[],
  ): Promise<ProviderCommandEntry[]> {
    const vaultEntries = await this.listVaultEntries();
    const vaultByName = new Map(
      vaultEntries.map(entry => [entry.name.toLowerCase(), entry] as const),
    );
    const merged: ProviderCommandEntry[] = [];
    const takenRuntimeNames = new Set<string>();
    // A command and a skill may legally share a name on disk, and both are
    // separately editable from settings. Keying vault entries by kind as well
    // keeps them apart: collapsing them would drop one of two files that
    // listVaultEntries - the branch taken when there is no runtime list -
    // returns in full.
    const takenVaultKeys = new Set<string>();

    for (const entry of runtimeEntries) {
      const name = entry.name.toLowerCase();
      if (takenRuntimeNames.has(name)) continue;
      takenRuntimeNames.add(name);
      const vaultEntry = vaultByName.get(name);
      if (vaultEntry) {
        takenVaultKeys.add(`${vaultEntry.kind}:${name}`);
      }
      merged.push(vaultEntry ?? entry);
    }
    for (const entry of vaultEntries) {
      const key = `${entry.kind}:${entry.name.toLowerCase()}`;
      if (takenVaultKeys.has(key)) continue;
      takenVaultKeys.add(key);
      merged.push(entry);
    }

    return merged;
  }

  async listVaultEntries(): Promise<ProviderCommandEntry[]> {
    const commands = await this.commandStorage.loadAll();
    const skills = await this.skillStorage.loadAll();
    return [...commands, ...skills].map(slashCommandToEntry);
  }

  async saveVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    const cmd = entryToSlashCommand(entry);
    if (entry.kind === 'skill') {
      await this.skillStorage.save(cmd);
    } else {
      await this.commandStorage.save(cmd);
    }
  }

  async deleteVaultEntry(entry: ProviderCommandEntry): Promise<void> {
    if (entry.kind === 'skill') {
      await this.skillStorage.delete(entry.id);
    } else {
      await this.commandStorage.delete(entry.id);
    }
  }

  /**
   * The escape hatch behind the refresh button in provider settings. This is the
   * one place that deliberately spends a probe: it drops the cache, forgets a
   * throttled empty window and rediscovers the list from the SDK.
   */
  async refresh(): Promise<ProviderCatalogRefreshOutcome> {
    this.emptyProbeAtByFingerprint.clear();
    // The old list is kept until a probe actually returns one. Dropping it
    // first would mean a refresh attempted against a broken or logged-out CLI
    // destroys a working list, leaves the dropdown with vault entries only, and
    // then throttles every retry for ten minutes.
    const previousCommands = this.sdkCommands;
    const previousFromCache = this.sdkCommandsFromCache;
    this.sdkCommands = [];
    this.sdkCommandsFromCache = false;

    await this.ensureProbed(this.safeFingerprint(), { force: true });

    if (this.sdkCommands.length === 0) {
      this.sdkCommands = previousCommands;
      this.sdkCommandsFromCache = previousFromCache;
      // Restoring the old list is what keeps the dropdown usable, and it is
      // also exactly why a surface cannot read success off the list's length:
      // what is there is what was there before the probe found nothing.
      return 'failed';
    }

    return 'refreshed';
  }
}
