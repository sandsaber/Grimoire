import { ProviderCatalog } from '@/core/providers/ProviderCatalog';
import {
  codexCommandsPort,
  codexConfiguredModelsPort,
  codexProviderModule,
} from '@/providers/codex/CodexProviderModule';
import { CodexExecutionBackend } from '@/providers/codex/execution/CodexExecutionBackend';

describe('codexProviderModule', () => {
  it('publishes the multiplexed topology and independently declared agent capabilities', () => {
    const catalog = new ProviderCatalog([codexProviderModule]);
    const module = catalog.require('codex');

    expect(module.manifest).toEqual({ id: 'codex', displayName: 'Codex', order: 20 });
    expect(module.execution.descriptor).toEqual({
      backendId: 'provider-codex',
      association: { kind: 'provider', providerId: 'codex' },
    });
    expect(module.capabilities).toMatchObject({
      process: {
        topology: 'persistent-app-server',
        concurrency: 'multiplexed-sessions',
      },
      session: { resume: 'native', transcriptHydration: 'native' },
      history: { ownership: 'provider-native' },
      agents: {
        definitionInventory: 'provider-files',
        spawnOrigins: ['provider-native'],
        stableIdentity: true,
        observation: 'aggregate',
        resultExtraction: 'native',
        cancellation: 'unsupported',
        statusQuery: 'unsupported',
        reattachment: 'unsupported',
      },
      controls: {
        fork: 'native',
        rewind: 'unsupported',
        steering: 'native',
        compaction: 'native',
      },
      interactions: { approval: 'native', question: 'native', planExit: 'unsupported' },
      security: {
        process: 'grimoire',
        filesystem: 'native',
        network: 'native',
        permissions: 'native',
      },
    });
    expect(module.features.ports).toEqual({
      commands: codexCommandsPort,
      models: codexConfiguredModelsPort,
    });
  });

  it('round-trips provider settings, preserves unknown fields, and fails closed', () => {
    const decoded = codexProviderModule.settings.decode({
      enabled: true,
      cliPath: ' /opt/codex ',
      cliPathsByHost: { workstation: '/opt/codex' },
      customModels: 'custom-a',
      discoveredModels: [{ id: 'gpt-test', label: 'GPT Test' }],
      reasoningSummary: 'concise',
      environmentVariables: 'OPENAI_MODEL=gpt-test',
      environmentHash: 'sha256:test',
      installationMethod: 'wsl',
      installationMethodsByHost: { workstation: 'wsl' },
      wslDistroOverride: ' Ubuntu ',
      wslDistroOverridesByHost: { workstation: 'Ubuntu' },
      futureCodexField: { retained: true },
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      throw new Error('Expected valid Codex settings.');
    }
    expect(decoded.value).toMatchObject({
      cliPath: '/opt/codex',
      reasoningSummary: 'concise',
      installationMethod: 'wsl',
      wslDistroOverride: 'Ubuntu',
    });
    expect(codexProviderModule.settings.encode(
      decoded.value,
      decoded.preservedUnknown,
    )).toMatchObject({
      futureCodexField: { retained: true },
      cliPath: '/opt/codex',
      installationMethodsByHost: { workstation: 'wsl' },
    });

    expect(codexProviderModule.settings.decode({
      enabled: 'yes',
      reasoningSummary: 'everything',
      installationMethod: 'unsafe',
      cliPathsByHost: { workstation: 42 },
      installationMethodsByHost: { workstation: 'unsafe' },
      discoveredModels: [{ label: 'missing id' }],
    })).toMatchObject({
      ok: false,
      fallback: {
        enabled: true,
        reasoningSummary: 'detailed',
        installationMethod: 'native-windows',
        cliPathsByHost: {},
        installationMethodsByHost: {},
        discoveredModels: [],
      },
      issues: expect.arrayContaining([
        'enabled must be a boolean',
        'reasoningSummary is invalid',
        'installationMethod is invalid',
        'cliPathsByHost contains an invalid path',
        'installationMethodsByHost contains an invalid method',
        'discoveredModels contains an invalid model',
      ]),
    });
  });

  it('constructs workspace and backend contributions through narrow contexts', async () => {
    const workspace = { dispose: jest.fn().mockResolvedValue(undefined) };
    const initialize = jest.fn().mockResolvedValue(workspace);
    const signal = new AbortController().signal;
    const created = await codexProviderModule.workspace.initialize({ initialize }, signal);
    await codexProviderModule.workspace.dispose(created);

    expect(initialize).toHaveBeenCalledWith(signal);
    expect(workspace.dispose).toHaveBeenCalledTimes(1);
    await expect(codexProviderModule.execution.create({
      connectionFactory: { create: jest.fn() },
      requestResolver: { resolve: jest.fn(), resolveSteer: jest.fn() },
      resultSink: { storeResult: jest.fn() },
      interactionBridge: { prepare: jest.fn() },
      turnReconcilerFactory: { create: jest.fn() },
      defaultResumeParams: { experimentalRawEvents: true },
      scheduler: { setTimeout: jest.fn(), clearTimeout: jest.fn() },
      sessionInstanceIdFactory: jest.fn(),
      interactionIdFactory: jest.fn(),
    })).resolves.toBeInstanceOf(CodexExecutionBackend);
  });

  it('combines discovered, environment, and configured models without duplicates', () => {
    const settings = codexProviderModule.settings.defaults();
    settings.discoveredModels = [{
      id: 'gpt-discovered',
      label: 'GPT Discovered',
      description: 'Discovered model',
    }];
    settings.environmentVariables = 'OPENAI_MODEL=gpt-env';
    settings.customModels = 'gpt-custom\ngpt-discovered\ngpt-custom';

    expect(codexConfiguredModelsPort.list(settings)).toEqual([
      { id: 'gpt-env', label: 'GPT-env', description: 'Custom (env)' },
      { id: 'gpt-discovered', label: 'GPT Discovered', description: 'Discovered model' },
      { id: 'gpt-custom', label: 'GPT-custom', description: 'Custom model' },
    ]);
    expect(settings.discoveredModels).toHaveLength(1);
  });
});
