import { ProviderCatalog } from '@/core/providers/ProviderCatalog';
import {
  antigravityConfiguredModelsPort,
  antigravityProviderModule,
} from '@/providers/antigravity/AntigravityProviderModule';
import { AntigravityExecutionBackend } from '@/providers/antigravity/execution/AntigravityExecutionBackend';

describe('antigravityProviderModule', () => {
  it('publishes one validated topology and honest unsupported capabilities', () => {
    const catalog = new ProviderCatalog([antigravityProviderModule]);
    const module = catalog.require('antigravity');

    expect(module.manifest).toEqual({
      id: 'antigravity',
      displayName: 'Antigravity',
      order: 70,
    });
    expect(module.execution.descriptor).toEqual({
      backendId: 'provider-antigravity',
      association: { kind: 'provider', providerId: 'antigravity' },
    });
    expect(module.capabilities).toMatchObject({
      process: { topology: 'per-run-process', concurrency: 'serial-runs' },
      session: { resume: 'unsupported', transcriptHydration: 'unsupported' },
      history: { ownership: 'grimoire-projection' },
      agents: {
        definitionInventory: 'none',
        spawnOrigins: [],
        stableIdentity: false,
        observation: 'none',
      },
      interactions: {
        approval: 'unsupported',
        question: 'unsupported',
        planExit: 'unsupported',
      },
      security: {
        process: 'grimoire',
        filesystem: 'unsupported',
        network: 'unsupported',
        permissions: 'unsupported',
      },
    });
  });

  it('decodes known settings, preserves unknown provider fields, and fails closed on invalid types', () => {
    const decoded = antigravityProviderModule.settings.decode({
      cliPath: ' /opt/agy ',
      cliPathsByHost: { workstation: '/opt/agy' },
      customModels: 'model-a\nmodel-a\nmodel-b',
      discoveredModels: [{ rawId: 'model-a', label: 'Model A' }],
      enabled: true,
      environmentHash: 'hash',
      environmentVariables: 'TOKEN=value',
      modelAliases: { 'model-a': 'Fast' },
      visibleModels: ['model-a', 'model-a'],
      futureProviderField: { retained: true },
    });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) {
      throw new Error('Expected valid settings.');
    }
    expect(decoded.value).toMatchObject({
      cliPath: '/opt/agy',
      cliPathsByHost: { workstation: '/opt/agy' },
      customModels: 'model-a\nmodel-b',
      enabled: true,
      visibleModels: ['model-a'],
    });
    expect(antigravityProviderModule.settings.encode(
      decoded.value,
      decoded.preservedUnknown,
    )).toMatchObject({
      futureProviderField: { retained: true },
      cliPath: '/opt/agy',
      enabled: true,
    });

    const invalid = antigravityProviderModule.settings.decode({ enabled: 'yes' });
    expect(invalid).toMatchObject({
      ok: false,
      fallback: { enabled: false },
      issues: ['enabled has an invalid type'],
    });
    expect(antigravityProviderModule.settings.decode({
      cliPathsByHost: { workstation: 42 },
      discoveredModels: [{ rawId: 'missing-label' }],
      modelAliases: { model: false },
      visibleModels: ['valid', 42],
    })).toMatchObject({
      ok: false,
      issues: [
        'cliPathsByHost contains an invalid path',
        'modelAliases contains an invalid alias',
        'visibleModels contains an invalid model',
        'discoveredModels contains an invalid model',
      ],
    });
  });

  it('constructs workspace and backend contributions only through narrow contexts', async () => {
    const workspace = { dispose: jest.fn().mockResolvedValue(undefined) };
    const initialize = jest.fn().mockResolvedValue(workspace);
    const signal = new AbortController().signal;

    const createdWorkspace = await antigravityProviderModule.workspace.initialize(
      { initialize },
      signal,
    );
    await antigravityProviderModule.workspace.dispose(createdWorkspace);

    expect(initialize).toHaveBeenCalledWith(signal);
    expect(workspace.dispose).toHaveBeenCalledTimes(1);
    await expect(antigravityProviderModule.execution.create({
      requestResolver: { resolve: jest.fn() },
      processRunner: { start: jest.fn() },
      resultSink: { storeResult: jest.fn() },
      scheduler: { setTimeout: jest.fn(), clearTimeout: jest.fn() },
      sessionInstanceIdFactory: jest.fn(),
    })).resolves.toBeInstanceOf(AntigravityExecutionBackend);
  });

  it('shares discovered, persisted, custom, and default model selection semantics', () => {
    const settings = antigravityProviderModule.settings.defaults();
    settings.visibleModels = ['visible'];
    settings.discoveredModels = [
      { rawId: 'visible', label: 'Visible' },
      { rawId: 'hidden', label: 'Hidden' },
    ];

    expect(antigravityConfiguredModelsPort.list(settings)).toEqual([
      {
        rawId: 'visible',
        label: 'Visible',
        description: 'Antigravity CLI model',
        selectionId: 'antigravity:visible',
        source: 'discovered',
      },
      {
        rawId: 'hidden',
        label: 'Hidden',
        description: 'Antigravity CLI model',
        selectionId: 'antigravity:hidden',
        source: 'discovered',
      },
    ]);
    expect(settings.discoveredModels).toHaveLength(2);

    settings.discoveredModels = [];
    settings.visibleModels = ['seeded-fallback'];
    settings.customModels = 'custom-model';
    expect(antigravityConfiguredModelsPort.list(settings)).toEqual([
      expect.objectContaining({ rawId: 'seeded-fallback', source: 'persisted' }),
      expect.objectContaining({ rawId: 'custom-model', source: 'custom' }),
    ]);

    settings.visibleModels = [];
    settings.customModels = '';
    expect(antigravityConfiguredModelsPort.list(settings)).toEqual([
      expect.objectContaining({
        rawId: null,
        selectionId: 'antigravity',
        source: 'provider-default',
      }),
    ]);
  });
});
