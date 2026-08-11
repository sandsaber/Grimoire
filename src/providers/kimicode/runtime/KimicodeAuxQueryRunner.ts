import * as fs from 'node:fs/promises';

import type { LegacyProviderContext } from '@/core/providers/LegacyProviderContext';

import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import { t } from '../../../i18n/i18n';
import { getVaultPath } from '../../../utils/path';
import {
  AcpClientConnection,
  AcpJsonRpcTransport,
  type AcpReadTextFileRequest,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  AcpSessionUpdateNormalizer,
  AcpSubprocess,
  extractAcpSessionModelState,
  resolveWorkspacePath,
} from '../../acp';
import { decodeKimicodeModelId, isKimicodeModelSelectionId } from '../models';
import {
  type KimicodeManagedAgentConfig,
  prepareKimicodeLaunchArtifacts,
} from './KimicodeLaunchArtifacts';
import { buildKimicodeRuntimeEnv } from './KimicodeRuntimeEnvironment';

type KimicodeAuxAgentProfile = 'passive' | 'readonly';
type KimicodeAuxArtifactPurpose = 'inline' | 'instructions' | 'title-gen';

interface KimicodeAuxQueryRunnerOptions {
  agentProfile: KimicodeAuxAgentProfile;
  artifactPurpose: KimicodeAuxArtifactPurpose;
  allowReadTextFile?: boolean;
}

const KIMICODE_AUX_AGENT_IDS: Record<KimicodeAuxAgentProfile, string> = {
  passive: 'grimoire-aux-passive',
  readonly: 'grimoire-aux-readonly',
};

const KIMICODE_AUX_READ_PERMISSION = Object.freeze({
  '*': 'allow',
  '*.env': 'deny',
  '*.env.*': 'deny',
  '*.env.example': 'allow',
});

export class KimicodeAuxQueryRunner implements AuxQueryRunner {
  private availableModelIds = new Set<string>();
  private connection: AcpClientConnection | null = null;
  private currentModelId: string | null = null;
  private currentLaunchKey: string | null = null;
  private process: AcpSubprocess | null = null;
  private readonly sessionCwds = new Map<string, string>();
  private sessionId: string | null = null;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private transport: AcpJsonRpcTransport | null = null;

  constructor(
    private readonly plugin: LegacyProviderContext,
    private readonly options: KimicodeAuxQueryRunnerOptions,
  ) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    await this.ensureReady(cwd, config.systemPrompt);

    if (!this.connection) {
      throw new Error(t('chat.ui.errors.provider.notReady', { provider: ProviderRegistry.getProviderDisplayNameOrId('kimicode') }));
    }

    if (!this.sessionId) {
      const sessionId = await this.createSession(cwd);
      if (!sessionId) {
        throw new Error(t('chat.ui.errors.provider.sessionCreateFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('kimicode') }));
      }
    }

    const sessionId = this.sessionId!;
    const selectedModel = this.resolveSelectedRawModel(config.model);
    const nextModel = this.resolveApplicableModel(selectedModel);
    if (nextModel) {
      const response = await this.connection.setConfigOption({
        configId: 'model',
        sessionId,
        type: 'select',
        value: nextModel,
      });
      this.syncSessionModelState({
        configOptions: response.configOptions,
      });
    }

    this.sessionUpdateNormalizer.reset();
    let accumulatedText = '';
    const removeListener = this.connection.onSessionNotification((notification) => {
      if (notification.sessionId !== sessionId) {
        return;
      }

      const normalized = this.sessionUpdateNormalizer.normalize(notification.update);
      if (normalized.type !== 'message_chunk' || normalized.role !== 'assistant') {
        return;
      }

      for (const chunk of normalized.streamChunks) {
        if (chunk.type !== 'text') {
          continue;
        }

        accumulatedText += chunk.content;
        config.onTextChunk?.(accumulatedText);
      }
    });

    const abortHandler = () => {
      if (this.connection && this.sessionId) {
        this.connection.cancel({ sessionId: this.sessionId });
      }
    };
    config.abortController?.signal.addEventListener('abort', abortHandler, { once: true });

    try {
      if (config.abortController?.signal.aborted) {
        throw new Error('Cancelled');
      }

      await this.connection.prompt({
        prompt: [{ type: 'text', text: prompt }],
        sessionId,
      });

      if (config.abortController?.signal.aborted) {
        throw new Error('Cancelled');
      }

      return accumulatedText;
    } catch (error) {
      const message = error instanceof Error ? error.message : t('chat.ui.errors.provider.requestFailed', { provider: ProviderRegistry.getProviderDisplayNameOrId('kimicode') });
      const stderr = this.process?.getStderrSnapshot();
      throw new Error(
        stderr ? `${message}\n\n${stderr}` : message,
        error instanceof Error ? { cause: error } : undefined,
      );
    } finally {
      config.abortController?.signal.removeEventListener('abort', abortHandler);
      removeListener();
    }
  }

  reset(): void {
    this.availableModelIds.clear();
    this.sessionId = null;
    this.sessionCwds.clear();
    this.currentModelId = null;
    this.currentLaunchKey = null;
    this.connection?.dispose();
    this.connection = null;
    this.transport?.dispose();
    this.transport = null;
    if (this.process) {
      void this.process.shutdown().catch(() => {});
    }
    this.process = null;
    this.sessionUpdateNormalizer.reset();
  }

  private async ensureReady(cwd: string, systemPrompt: string): Promise<void> {
    const resolvedCliPath = this.plugin.getResolvedProviderCliPath('kimicode') ?? 'kimi';

    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    const runtimeEnv = buildKimicodeRuntimeEnv(settings, resolvedCliPath);
    const auxAgentId = KIMICODE_AUX_AGENT_IDS[this.options.agentProfile];
    const artifacts = await prepareKimicodeLaunchArtifacts({
      artifactsSubdir: `kimicode/auxiliary/${this.options.artifactPurpose}`,
      defaultAgentId: auxAgentId,
      managedAgents: [buildKimicodeAuxAgentConfig(this.options.agentProfile)],
      runtimeEnv,
      systemPromptKey: systemPrompt,
      systemPromptText: systemPrompt,
      userName: typeof settings.userName === 'string' ? settings.userName : undefined,
      workspaceRoot: cwd,
    });
    const nextLaunchKey = JSON.stringify({
      artifactKey: artifacts.launchKey,
      command: resolvedCliPath,
      configPath: artifacts.configPath,
      envText: getRuntimeEnvironmentText(settings, 'kimicode'),
    });

    const shouldRestart = !this.process
      || !this.transport
      || !this.connection
      || !this.process.isAlive()
      || this.transport.isClosed
      || this.currentLaunchKey !== nextLaunchKey;

    if (!shouldRestart) {
      return;
    }

    this.reset();
    await this.startProcess({
      command: resolvedCliPath,
      configPath: artifacts.configPath,
      configContent: artifacts.configContent,
      cwd,
      runtimeEnv,
    });
    this.currentLaunchKey = nextLaunchKey;
  }

  private async createSession(cwd: string): Promise<string | null> {
    if (!this.connection) {
      return null;
    }

    try {
      const response = await this.connection.newSession({
        cwd,
        mcpServers: [],
      });
      this.syncSessionModelState({
        configOptions: response.configOptions ?? null,
        models: response.models ?? null,
      });
      await this.connection.setConfigOption({
        configId: 'mode',
        sessionId: response.sessionId,
        type: 'select',
        value: KIMICODE_AUX_AGENT_IDS[this.options.agentProfile],
      });
      this.sessionId = response.sessionId;
      this.sessionCwds.set(response.sessionId, cwd);
      return response.sessionId;
    } catch {
      return null;
    }
  }

  private async startProcess(params: {
    command: string;
    configPath: string;
    configContent: string;
    cwd: string;
    runtimeEnv: NodeJS.ProcessEnv;
  }): Promise<void> {
    const processEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...params.runtimeEnv,
      KIMICODE_CONFIG: params.configPath,
      KIMICODE_CONFIG_CONTENT: params.configContent,
      PATH: params.runtimeEnv.PATH,
    };

    this.process = new AcpSubprocess({
      args: ['acp'],
      command: params.command,
      cwd: params.cwd,
      env: processEnv,
    });
    this.process.start();

    this.transport = new AcpJsonRpcTransport({
      input: this.process.stdout,
      onClose: (listener) => this.process!.onClose(listener),
      output: this.process.stdin,
    });

    this.connection = new AcpClientConnection({
      clientInfo: {
        name: 'grimoire-aux',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: {
        fileSystem: this.options.allowReadTextFile
          ? {
            readTextFile: (request) => this.readTextFile(request),
          }
          : undefined,
        requestPermission: (request) => this.handlePermissionRequest(request),
      },
      transport: this.transport,
    });

    this.transport.start();
    await this.connection.initialize();
  }

  private async readTextFile(
    request: AcpReadTextFileRequest,
  ): Promise<{ content: string }> {
    const resolvedPath = this.resolveSessionPath(request.sessionId, request.path);
    const content = await fs.readFile(resolvedPath, 'utf-8');

    if (request.line === undefined && request.limit === undefined) {
      return { content };
    }

    const lines = content.split(/\r?\n/);
    const startIndex = Math.max(0, (request.line ?? 1) - 1);
    const endIndex = request.limit
      ? startIndex + Math.max(0, request.limit)
      : lines.length;

    return {
      content: lines.slice(startIndex, endIndex).join('\n'),
    };
  }

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    return selectPermissionOption(request.options, ['reject_once', 'reject_always']);
  }

  private resolveSelectedRawModel(explicitModel?: string): string | undefined {
    const projectedSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      'kimicode',
    );
    if (explicitModel) {
      const trimmed = explicitModel.trim();
      if (!trimmed) {
        return undefined;
      }
      return isKimicodeModelSelectionId(trimmed)
        ? decodeKimicodeModelId(trimmed) ?? undefined
        : trimmed;
    }

    const selectedModel = typeof projectedSettings.model === 'string'
      ? projectedSettings.model
      : '';
    return isKimicodeModelSelectionId(selectedModel)
      ? decodeKimicodeModelId(selectedModel) ?? undefined
      : undefined;
  }

  private resolveApplicableModel(selectedModel: string | undefined): string | null {
    if (!selectedModel) {
      return null;
    }
    if (selectedModel === this.currentModelId) {
      return null;
    }
    if (this.availableModelIds.size === 0) {
      return selectedModel;
    }
    return this.availableModelIds.has(selectedModel)
      ? selectedModel
      : null;
  }

  private syncSessionModelState(params: {
    configOptions?: Parameters<typeof extractAcpSessionModelState>[0]['configOptions'];
    models?: Parameters<typeof extractAcpSessionModelState>[0]['models'];
  }): void {
    const state = extractAcpSessionModelState(params);
    this.currentModelId = state.currentModelId;
    this.availableModelIds = new Set(state.availableModels.map((model) => model.id));
  }

  private resolveSessionPath(sessionId: string, rawPath: string): string {
    const cwd = this.sessionCwds.get(sessionId)
      ?? getVaultPath(this.plugin.app)
      ?? process.cwd();
    return resolveWorkspacePath(cwd, rawPath, {
      containmentMessage: 'Kimi Code aux read access is limited to the current workspace.',
    });
  }
}

function buildKimicodeAuxAgentConfig(profile: KimicodeAuxAgentProfile): KimicodeManagedAgentConfig {
  const id = KIMICODE_AUX_AGENT_IDS[profile];
  if (profile === 'readonly') {
    return {
      definition: {
        description: 'Internal Grimoire read-only agent for Kimi Code auxiliary tasks.',
        mode: 'primary',
        permission: {
          '*': 'deny',
          codesearch: 'allow',
          external_directory: 'deny',
          glob: 'allow',
          grep: 'allow',
          lsp: 'allow',
          read: KIMICODE_AUX_READ_PERMISSION,
          webfetch: 'allow',
          websearch: 'allow',
        },
      },
      id,
    };
  }

  return {
    definition: {
      description: 'Internal Grimoire no-tool agent for Kimi Code auxiliary tasks.',
      mode: 'primary',
      permission: {
        '*': 'deny',
        external_directory: 'deny',
      },
    },
    id,
  };
}

function selectPermissionOption(
  options: readonly {
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
    optionId: string;
  }[],
  preferredKinds: readonly ('allow_once' | 'allow_always' | 'reject_once' | 'reject_always')[],
): AcpRequestPermissionResponse {
  for (const kind of preferredKinds) {
    const option = options.find((entry) => entry.kind === kind);
    if (option) {
      return {
        outcome: {
          optionId: option.optionId,
          outcome: 'selected',
        },
      };
    }
  }

  return { outcome: { outcome: 'cancelled' } };
}
