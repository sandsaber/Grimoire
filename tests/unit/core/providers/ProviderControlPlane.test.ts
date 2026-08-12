import { createHash } from 'node:crypto';

import {
  type ProviderConfigMap,
  ProviderControlPlane,
} from '@/core/providers/ProviderControlPlane';
import type { Sha256DigestPort } from '@/core/providers/ProviderSettingsFingerprint';
import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';

const digestPort: Sha256DigestPort = {
  digestUtf8: async value => createHash('sha256').update(value, 'utf8').digest('hex'),
};

const plane = new ProviderControlPlane(builtInProviderCatalog, digestPort);

describe('ProviderControlPlane', () => {
  it('derives ordered settings presentation and defaults from all nine modules', () => {
    expect(plane.listDefinitions().map(definition => [
      definition.providerId,
      definition.name,
      definition.tabName,
      definition.descriptionKey,
    ])).toEqual([
      ['claude', 'Claude Code', 'Claude', 'settings.providers.claude.desc'],
      ['codex', 'Codex', 'Codex', 'settings.providers.codex.desc'],
      ['opencode', 'OpenCode', 'OpenCode', 'settings.providers.opencode.desc'],
      ['grok', 'Grok Build', 'Grok', 'settings.providers.grok.desc'],
      ['mimocode', 'MiMoCode', 'MiMo', 'settings.providers.mimocode.desc'],
      ['kimicode', 'Kimi Code', 'Kimi', 'settings.providers.kimicode.desc'],
      ['antigravity', 'Antigravity', 'Antigravity', 'settings.providers.antigravity.desc'],
      ['gemini', 'Gemini CLI (Legacy)', 'Gemini', 'settings.providers.gemini.desc'],
      ['qwen', 'Qwen Code', 'Qwen', 'settings.providers.qwen.desc'],
    ]);
    const defaults = plane.defaultConfigs();
    expect(Object.keys(defaults)).toEqual(plane.listDefinitions().map(item => item.providerId));
    expect(Object.values(defaults).every(config => typeof config.enabled === 'boolean')).toBe(true);
  });

  it('fails closed on malformed settings while preserving unknown provider-owned fields', async () => {
    const configs = plane.defaultConfigs();
    const projection = await plane.project('codex', {
      ...configs,
      codex: {
        ...configs.codex,
        enabled: 'yes',
        futureProviderField: { retained: true },
      },
    });

    expect(projection.settings).toMatchObject({
      valid: false,
      enabled: false,
      issues: ['enabled must be a boolean'],
      preservedUnknown: { futureProviderField: { retained: true } },
    });
    expect(projection.settings.encoded.futureProviderField).toEqual({ retained: true });
  });

  it('disables malformed enablement for every built-in provider', async () => {
    const defaults = plane.defaultConfigs();
    for (const definition of plane.listDefinitions()) {
      const projection = await plane.project(definition.providerId, {
        ...defaults,
        [definition.providerId]: {
          ...defaults[definition.providerId],
          enabled: 'unsafe',
        },
      });
      expect(projection.settings).toMatchObject({ valid: false, enabled: false });
    }
  });

  it('normalizes known configs, preserves unknown providers, and refuses invalid writes', async () => {
    const configs: ProviderConfigMap = {
      ...plane.defaultConfigs(),
      future: { enabled: true, opaque: 'retained' },
      codex: {
        ...plane.defaultConfigs().codex,
        futureProviderField: 'retained',
      },
    };
    const normalized = await plane.normalizeConfigs(configs);

    expect(normalized.configs.future).toEqual({ enabled: true, opaque: 'retained' });
    expect(normalized.configs.codex?.futureProviderField).toBe('retained');
    await expect(plane.normalizeConfigs({
      ...configs,
      codex: { ...configs.codex, enabled: 'invalid' },
    })).rejects.toThrow('codex (enabled must be a boolean)');
  });

  it('changes generation fingerprints only for provider-declared runtime inputs', async () => {
    const current = plane.defaultConfigs();
    const presentationOnly = {
      ...current,
      codex: { ...current.codex, customModels: 'new-model' },
    };
    const runtimeChange = {
      ...presentationOnly,
      codex: { ...presentationOnly.codex, environmentVariables: 'OPENAI_BASE_URL=https://local' },
    };

    await expect(plane.affectedRuntimeProviders(current, presentationOnly)).resolves.toEqual([]);
    await expect(plane.affectedRuntimeProviders(current, runtimeChange)).resolves.toEqual(['codex']);
    await expect(plane.affectedRuntimeProviders(current, {
      ...current,
      codex: { ...current.codex, enabled: current.codex?.enabled !== true },
    })).resolves.toEqual(['codex']);
  });

  it('allows a valid update to repair invalid current settings', async () => {
    const defaults = plane.defaultConfigs();
    await expect(plane.affectedRuntimeProviders({
      ...defaults,
      codex: { ...defaults.codex, enabled: 'invalid' },
    }, defaults)).resolves.toEqual([]);
  });

  it('routes models and feature availability without provider-id branching', async () => {
    const configs = plane.defaultConfigs();
    const models = await plane.listConfiguredModels('codex', configs);
    const product = await plane.project('codex', configs);

    expect(models.length).toBeGreaterThan(0);
    expect(models.every(model => model.providerId === 'codex')).toBe(true);
    expect(product.availableFeatures).toEqual(expect.arrayContaining(['commands', 'models']));
    expect(plane.featurePort('codex', 'models')).not.toBeNull();
    expect(plane.featurePort('antigravity', 'agents')).toBeNull();
  });

  it('normalizes model routing for every built-in provider through one feature contract', async () => {
    const configs = plane.defaultConfigs();
    for (const definition of plane.listDefinitions()) {
      const models = await plane.listConfiguredModels(definition.providerId, configs);
      expect(Array.isArray(models)).toBe(true);
      expect(models.every(model => (
        model.providerId === definition.providerId
        && model.id.length > 0
        && model.label.length > 0
      ))).toBe(true);
    }
  });

  it('retains a known preferred provider presentation even when it is disabled', async () => {
    const selected = await plane.selectCurrentProvider(plane.defaultConfigs(), 'gemini');
    expect(selected.definition).toMatchObject({
      providerId: 'gemini',
      name: 'Gemini CLI (Legacy)',
      tabName: 'Gemini',
    });
  });
});
