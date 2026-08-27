import type { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import type { AppSessionStorage } from '@/core/providers/types';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { ProviderId } from '@/core/types/provider';
import type GrimoirePlugin from '@/main';

import { ChatExecutionComposition } from './chat/ChatExecutionComposition';
import { StoredChatConversations } from './chat/StoredChatConversations';
import { AntigravityExecution } from './execution/antigravity/AntigravityExecutionComposition';
import { ClaudeExecution } from './execution/claude/ClaudeExecutionComposition';
import { CodexExecution } from './execution/codex/CodexExecutionComposition';
import { ExecutionKernelHost } from './execution/ExecutionKernelHost';
import { GeminiExecution } from './execution/gemini/GeminiExecutionComposition';
import { GrokExecution } from './execution/grok/GrokExecutionComposition';
import { KimicodeExecution } from './execution/kimicode/KimicodeExecutionComposition';
import { LocalShellExecution } from './execution/local/LocalShellExecution';
import { MimocodeExecution } from './execution/mimocode/MimocodeExecutionComposition';
import { OpencodeExecution } from './execution/opencode/OpencodeExecutionComposition';
import { QwenExecution } from './execution/qwen/QwenExecutionComposition';
import { VaultDurableStorage } from './storage/VaultDurableStorage';

/**
 * Everything one plugin load composes, and the only object that owns it.
 *
 * The compositions were eleven fields on the plugin, each with a getter naming
 * a provider — a provider's name on the application's own surface, and eleven
 * lifetimes to keep in step with one load. This is that one object: it builds
 * the kernel, registers every backend against it, assembles the chat execution
 * path beside it, and takes them all down together.
 *
 * **One per load and never a module singleton.** A singleton outlives the
 * instance a reload replaces, and two registries over one control store would
 * each believe they own every run in it. `ExecutionKernelHost` says the same
 * thing about itself, and this is what absorbs it: the host still owns the
 * load/unload race, because Obsidian's `onload` is async and `onunload` neither
 * waits for it nor is withheld until it finishes.
 *
 * The provider fields are still named, and they are still reachable through the
 * plugin. That is the seam the provider rows remove — a provider's registration
 * asks the plugin for its own composition today — and it is deliberately left
 * where it is: moving fifty call sites is that step's work, not this one's.
 */

export interface ApplicationRuntimeOptions {
  readonly plugin: GrimoirePlugin;
  readonly adapter: VaultFileAdapter;
  /**
   * The vault's one record store, and the projection a chat reads it through.
   *
   * Narrowed to the three members rather than taking `SessionStorage`: the
   * plugin's own field is the `AppSessionStorage` port, and asking for the
   * class would make this the only thing in the load that needed more than the
   * port gives.
   */
  readonly sessions: Pick<AppSessionStorage, 'records' | 'toConversation' | 'toSessionMetadata'>;
  readonly defaultProviderId: ProviderId;
  /** Reports a failure that must not take the load down; never thrown at the caller. */
  report(event: {
    readonly error?: unknown;
    readonly event: string;
    readonly level: 'warn' | 'error';
    readonly scope: string;
    readonly data?: Record<string, unknown>;
  }): void;
}

export class ApplicationRuntime {
  readonly kernel: ExecutionKernelHost;
  readonly chat: ChatExecutionComposition;
  readonly localShell: LocalShellExecution;
  readonly antigravity: AntigravityExecution;
  readonly codex: CodexExecution;
  readonly claude: ClaudeExecution;
  readonly opencode: OpencodeExecution;
  readonly grok: GrokExecution;
  readonly mimocode: MimocodeExecution;
  readonly kimicode: KimicodeExecution;
  readonly gemini: GeminiExecution;
  readonly qwen: QwenExecution;

  constructor(private readonly options: ApplicationRuntimeOptions) {
    const { plugin } = options;
    this.kernel = new ExecutionKernelHost({
      storage: new VaultDurableStorage(options.adapter),
      reportShutdownFailure: error => options.report({
        error,
        event: 'execution.shutdown.failed',
        level: 'warn',
        scope: 'plugin',
      }),
    });
    const registry: ExecutionLifecycleRegistry = this.kernel.registry;

    // The application's own shell, registered like any provider backend: a
    // bang-bash command is a run the kernel owns, so shutdown cancels it
    // instead of leaving a process behind the plugin that started it.
    this.localShell = new LocalShellExecution(registry);
    this.kernel.registerBackend({ backend: this.localShell.createBackend() });

    // Print mode, and the only provider with no interaction channel: approval
    // is refused before a process exists, so it registers as a bare backend.
    this.antigravity = new AntigravityExecution(plugin, registry);
    this.kernel.registerBackend({ backend: this.antigravity.createBackend() });

    // **Every other provider registers with its interaction and recovery
    // ports**, and the reason is the same for all of them: a backend registered
    // without its interaction port leaves an approval the user answered with
    // nowhere to send the answer — and, since the chat flip, leaves the turn
    // waiting on it for ever. What differs between them lives in each
    // composition rather than here.
    this.codex = new CodexExecution(plugin, registry);
    this.kernel.registerBackend(this.codex.createBackendRegistration());
    this.claude = new ClaudeExecution(plugin, registry);
    this.kernel.registerBackend(this.claude.createBackendRegistration());
    this.opencode = new OpencodeExecution(plugin, registry);
    this.kernel.registerBackend(this.opencode.createBackendRegistration());
    this.grok = new GrokExecution(plugin, registry);
    this.kernel.registerBackend(this.grok.createBackendRegistration());
    this.mimocode = new MimocodeExecution(plugin, registry);
    this.kernel.registerBackend(this.mimocode.createBackendRegistration());
    this.kimicode = new KimicodeExecution(plugin, registry);
    this.kernel.registerBackend(this.kimicode.createBackendRegistration());
    this.gemini = new GeminiExecution(plugin, registry);
    this.kernel.registerBackend(this.gemini.createBackendRegistration());
    this.qwen = new QwenExecution(plugin, registry);
    this.kernel.registerBackend(this.qwen.createBackendRegistration());

    // Assembled beside the kernel it runs on. The store it writes through is
    // the vault's own, because the queue that serializes writes to a
    // conversation is held on that instance and a second one would not
    // serialize against it.
    this.chat = new ChatExecutionComposition({
      lifecycle: registry,
      conversations: new StoredChatConversations({
        repository: options.sessions.records,
        projection: options.sessions,
        defaultProviderId: options.defaultProviderId,
      }),
    });
  }

  /**
   * Opens the kernel's gate, then does the work that needs it open.
   *
   * A kernel that cannot start must not take the load down with it: every
   * provider runs through it, and a plugin that fails to load leaves the user
   * with no settings tab to fix it from. So a failed start is recorded and the
   * load continues — with a kernel whose gate never opened, which refuses work
   * rather than half-doing it.
   */
  async start(): Promise<void> {
    try {
      await this.kernel.start();
    } catch (error) {
      this.options.report({ error, event: 'execution.start.failed', level: 'error', scope: 'plugin' });
      return;
    }
    // After the gate is open, because it reaches provider services that expect
    // a started plugin, and nothing renders a Codex tab before it resolves.
    void this.codex.initializeWorkspace().catch(error => {
      this.options.report({
        error,
        event: 'execution.workspace.failed',
        level: 'warn',
        scope: 'codex',
      });
    });
    const migration = this.kernel.migrationRequirement();
    if (migration) {
      // Persistence decision D5: a control record this build cannot read opens
      // the store read-only rather than being guessed at or discarded. Recorded
      // so the reason a provider refuses work is answerable.
      this.options.report({
        data: { recordKind: migration.recordKind },
        event: 'execution.migrationRequired',
        level: 'warn',
        scope: 'plugin',
      });
    }
  }

  /**
   * Takes the load's composition down: providers, then the chat surface, then
   * the kernel.
   *
   * The order is the whole of it. Each provider composition releases the
   * scratch a turn was holding; the chat surface detaches what is watching
   * runs; and the kernel, last, decides what happens to the runs themselves.
   * Not awaited by `onunload`, which returns void — so a failure here is
   * reported rather than propagated.
   */
  dispose(): void {
    void this.localShell.dispose();
    this.codex.dispose();
    this.claude.dispose();
    this.opencode.dispose();
    this.grok.dispose();
    this.mimocode.dispose();
    this.kimicode.dispose();
    this.gemini.dispose();
    this.qwen.dispose();
    this.chat.dispose();
    void this.kernel.dispose();
  }
}
