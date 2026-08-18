import { randomUUID } from 'node:crypto';

import {
  CodexActiveLaunchSpec,
  NodeCodexExecutionConnectionFactory,
} from '@/app/execution/codex/NodeCodexExecutionConnectionFactory';
import { interactionId, sessionInstanceId } from '@/core/execution/ExecutionIds';
import { buildSystemPrompt } from '@/core/prompt/mainAgent';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type GrimoirePlugin from '@/main';
import {
  CodexExecutionBackend,
  type CodexExecutionBackendContext,
  type CodexExecutionConnectionFactory,
} from '@/providers/codex/execution/CodexExecutionBackend';
import {
  CodexExecutionRequests,
  type CodexInvocationEnvironment,
} from '@/providers/codex/execution/CodexExecutionRequests';
import {
  CodexExecutionTurnReconciler,
  CodexJsonlExecutionTranscriptReader,
} from '@/providers/codex/execution/CodexExecutionTurnReconciler';
import { CodexInteractionBridge } from '@/providers/codex/execution/CodexInteractionBridge';
import { CodexInteractionPresenter } from '@/providers/codex/execution/CodexInteractionPresenter';
import { CodexProjectionResultSink } from '@/providers/codex/execution/CodexProjectionResultSink';
import { resolveCodexAppServerLaunchSpec } from '@/providers/codex/runtime/codexAppServerSupport';
import { createCodexRuntimeContext } from '@/providers/codex/runtime/CodexRuntimeContext';
import { CodexSkillListingService } from '@/providers/codex/skills/CodexSkillListingService';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '@/providers/codex/types/models';
import { getVaultPath } from '@/utils/path';

/**
 * Codex chat execution, assembled from the running plugin.
 *
 * One object per plugin load, holding what the backend and every tab runtime
 * must agree on: the store behind the kernel's request references, the launch
 * spec the daemon runs under and paths are expressed in, and the bridge that
 * turns a server request into something the surface can show. None of these can
 * be handed out as copies — a reference minted against one store resolves to
 * nothing in another, and a path expressed for one target means a different
 * place on the other.
 *
 * It lives in `src/app/` because the backend takes no plugin and no vault: it
 * is a strict module by the composition gate, and everything ambient reaches it
 * as a port constructed here.
 */
export class CodexExecution {
  private readonly activeLaunchSpec = new CodexActiveLaunchSpec(
    () => resolveCodexAppServerLaunchSpec(this.plugin, 'codex'),
  );
  private readonly interactions = new CodexInteractionBridge();
  private readonly skills = new CodexSkillListingService(this.plugin);
  private readonly requests = new CodexExecutionRequests(
    () => opaqueId('codexreq'),
    () => this.environment(),
  );
  private readonly presenters = new Set<CodexInteractionPresenter>();
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly plugin: GrimoirePlugin) {}

  /**
   * The backend, over an application-owned daemon by default.
   *
   * The connection factory is a parameter because it is the seam between
   * provider protocol and process ownership, and a test that has to launch
   * `codex app-server` to check how a turn is composed is testing the wrong
   * thing.
   */
  createBackend(
    connectionFactory: CodexExecutionConnectionFactory = this.createConnectionFactory(),
  ): CodexExecutionBackend {
    const context: CodexExecutionBackendContext = {
      connectionFactory,
      requestResolver: this.requests,
      resultSink: new CodexProjectionResultSink(),
      interactionBridge: this.interactions,
      turnReconcilerFactory: {
        create: connection => new CodexExecutionTurnReconciler(
          connection,
          // The daemon reports where it keeps transcripts as part of its
          // handshake, so the reader is built per connection rather than from a
          // path guessed before one exists.
          new CodexJsonlExecutionTranscriptReader(this.sessionsRootHost(connection)),
        ),
      },
      // What a thread has to be resumed with when the backend has no turn of
      // its own to take parameters from — recovery after a restart, where the
      // conversation's own request is long gone.
      defaultResumeParams: {
        model: DEFAULT_CODEX_PRIMARY_MODEL,
        experimentalRawEvents: true,
        persistExtendedHistory: true,
      },
      scheduler: {
        setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
        clearTimeout: handle => window.clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      sessionInstanceIdFactory: () => sessionInstanceId(opaqueId('si')),
      interactionIdFactory: () => interactionId(opaqueId('ix')),
    };
    return new CodexExecutionBackend(context);
  }

  /**
   * A presenter for one tab, subscribed to the interactions it shows.
   *
   * Subscribed rather than polled because the two endings the surface cannot
   * see — a run cancelled while its prompt is up, and a request Codex answered
   * itself — reach the bridge and nothing else.
   */
  createInteractionPresenter(
    callbacks: ConstructorParameters<typeof CodexInteractionPresenter>[1],
  ): CodexInteractionPresenter {
    const presenter = new CodexInteractionPresenter(this.interactions, callbacks);
    this.presenters.add(presenter);
    const unsubscribe = this.interactions.onSettled(ref => presenter.dismiss(ref));
    this.disposers.push(() => {
      unsubscribe();
      this.presenters.delete(presenter);
    });
    return presenter;
  }

  /** The store every tab runtime references its turns through. */
  get turnRequests(): CodexExecutionRequests {
    return this.requests;
  }

  /** Releases the scratch directories and takes down whatever is on screen. */
  dispose(): void {
    // Taken down before the subscriptions are dropped: unsubscribing first
    // empties the set this iterates, and the prompts stay on screen.
    for (const presenter of this.presenters) {
      presenter.dismissAll();
    }
    for (const disposer of this.disposers.splice(0)) {
      disposer();
    }
    this.presenters.clear();
    this.requests.dispose();
    this.skills.invalidate();
  }

  private createConnectionFactory(): CodexExecutionConnectionFactory {
    return new NodeCodexExecutionConnectionFactory({ activeLaunchSpec: this.activeLaunchSpec });
  }

  /**
   * Everything a queued turn is resolved against, read now rather than when it
   * was queued.
   */
  private async environment(): Promise<CodexInvocationEnvironment> {
    const launchSpec = this.activeLaunchSpec.current();
    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'codex',
    );
    return {
      settings,
      launchSpec,
      baseInstructions: orchestratorMode => buildSystemPrompt({
        mediaFolder: this.plugin.settings.mediaFolder,
        customPrompt: this.plugin.settings.systemPrompt,
        vaultPath: getVaultPath(this.plugin.app) ?? undefined,
        userName: this.plugin.settings.userName,
      }, { orchestratorMode }),
      listSkills: () => this.skills.listSkills(),
    };
  }

  private sessionsRootHost(connection: { readonly initializeResult: unknown }): string {
    const initializeResult = connection.initializeResult;
    const launchSpec = this.activeLaunchSpec.current();
    if (initializeResult) {
      const context = createCodexRuntimeContext(
        launchSpec,
        initializeResult as Parameters<typeof createCodexRuntimeContext>[1],
      );
      if (context.sessionsDirHost) {
        return context.sessionsDirHost;
      }
    }
    // The reader treats an unreadable root as "no replay available", which is
    // the same answer it gives for a transcript that is not there.
    return '';
  }
}

function opaqueId(prefix: string): string {
  return `${prefix}-${randomUUID().replaceAll('-', '')}`;
}
