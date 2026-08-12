import { createHash } from 'node:crypto';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { DurableStagedProviderSettingsStore } from '@/app/settings/StagedProviderSettingsStore';
import {
  GRIMOIRE_SETTINGS_PATH,
  PROVIDER_SETTINGS_STAGING_PATH,
  PROVIDER_SETTINGS_TRANSACTION_INTENTS_PATH,
} from '@/core/bootstrap/StoragePaths';
import type { ExecutionBackendId } from '@/core/execution/ExecutionBackendDescriptor';
import type { SettingsTransitionRecord } from '@/core/execution/ExecutionControlRecords';
import type { SettingsTransitionSnapshot } from '@/core/execution/ExecutionLifecycleRegistry';
import { ProviderControlPlane } from '@/core/providers/ProviderControlPlane';
import type { Sha256DigestPort } from '@/core/providers/ProviderSettingsFingerprint';
import {
  type ProviderSettingsLifecyclePort,
  ProviderSettingsTransactionCoordinator,
  type StagedProviderSettingsStore,
} from '@/core/providers/ProviderSettingsTransactionCoordinator';
import { builtInProviderCatalog } from '@/providers/BuiltInProviderCatalog';

const TRANSACTION_ID = `tx-${'1'.repeat(32)}`;
const TRANSITION_ID = `st-${'2'.repeat(32)}`;
const TRANSACTION_ID_2 = `tx-${'3'.repeat(32)}`;
const TRANSITION_ID_2 = `st-${'4'.repeat(32)}`;
const digestPort: Sha256DigestPort = {
  digestUtf8: async value => createHash('sha256').update(value, 'utf8').digest('hex'),
};

class FakeLifecycle implements ProviderSettingsLifecyclePort {
  readonly transitions = new Map<string, SettingsTransitionRecord>();
  readonly calls: string[] = [];
  requireRestartOnce = false;

  async beginSettingsTransition(command: {
    readonly transitionId: string;
    readonly backendId: ExecutionBackendId;
    readonly settingsFingerprint: string;
  }): Promise<void> {
    this.calls.push(`begin:${command.transitionId}`);
    this.transitions.set(command.transitionId, {
      transitionId: command.transitionId,
      backendId: command.backendId,
      fromGeneration: 1,
      toGeneration: 2,
      status: 'quiescent',
      settingsFingerprint: command.settingsFingerprint,
      createdAt: 1,
      updatedAt: 1,
    });
  }

  async markSettingsTransitionApplying(transitionId: string): Promise<void> {
    this.calls.push(`apply:${transitionId}`);
    this.update(transitionId, 'applying');
  }

  async completeSettingsTransition(transitionId: string): Promise<void> {
    this.calls.push(`complete:${transitionId}`);
    if (this.requireRestartOnce) {
      this.requireRestartOnce = false;
      this.update(transitionId, 'restart-required');
      return;
    }
    this.update(transitionId, 'completed');
  }

  async recoverSettingsTransition(
    transitionId: string,
    activeFingerprint: string,
  ): Promise<void> {
    this.calls.push(`recover:${transitionId}`);
    const current = this.require(transitionId);
    if (current.settingsFingerprint !== activeFingerprint) throw new Error('fingerprint mismatch');
    this.update(transitionId, 'completed');
  }

  async getSettingsTransition(
    transitionId: string,
  ): Promise<SettingsTransitionSnapshot | null> {
    const record = this.transitions.get(transitionId);
    return record ? { record, revision: 1 } : null;
  }

  private update(transitionId: string, status: SettingsTransitionRecord['status']): void {
    const current = this.require(transitionId);
    this.transitions.set(transitionId, { ...current, status, updatedAt: current.updatedAt + 1 });
  }

  private require(transitionId: string): SettingsTransitionRecord {
    const current = this.transitions.get(transitionId);
    if (!current) throw new Error(`Missing ${transitionId}`);
    return current;
  }
}

class FakeWorkspaceSettingsPort {
  readonly transitions: string[] = [];
  completeFailures = 0;

  async beginSettingsTransition(providerId: string): Promise<void> {
    this.transitions.push(`begin:${providerId}`);
  }

  async completeSettingsTransition(providerId: string): Promise<void> {
    this.transitions.push(`complete:${providerId}`);
    if (this.completeFailures > 0) {
      this.completeFailures -= 1;
      throw new Error('workspace completion failed');
    }
  }
}

describe('ProviderSettingsTransactionCoordinator', () => {
  it('persists settings, recycles only affected providers, and advances the generation', async () => {
    const fixture = await createFixture();
    const next = {
      ...fixture.defaults,
      codex: {
        ...fixture.defaults.codex,
        environmentVariables: 'OPENAI_API_KEY=private-value',
        futureProviderField: 'retained',
      },
    };

    const result = await fixture.coordinator.apply({
      transactionId: TRANSACTION_ID,
      transitionIds: { codex: TRANSITION_ID },
      providerConfigUpdates: { codex: next.codex },
    });

    expect(result).toEqual({
      transactionId: TRANSACTION_ID,
      affectedProviderIds: ['codex'],
      recovered: false,
    });
    expect(fixture.workspaces.transitions).toEqual(['begin:codex', 'complete:codex']);
    expect(fixture.lifecycle.transitions.get(TRANSITION_ID)?.status).toBe('completed');
    expect((await fixture.settingsStore.readActive()).configs.codex)
      .toMatchObject({
        environmentVariables: 'OPENAI_API_KEY=private-value',
        futureProviderField: 'retained',
      });
    expect(fixture.storage.get(`${PROVIDER_SETTINGS_STAGING_PATH}/${TRANSACTION_ID}.json`))
      .toBeNull();

    const intentPaths = await fixture.storage.list(PROVIDER_SETTINGS_TRANSACTION_INTENTS_PATH);
    const intentPayload = intentPaths.map(path => fixture.storage.get(path)).join('\n');
    expect(intentPayload).not.toContain('OPENAI_API_KEY');
    expect(intentPayload).not.toContain('private-value');
  });

  it('recovers a restart-required completion without redispatching settings persistence', async () => {
    const fixture = await createFixture();
    fixture.lifecycle.requireRestartOnce = true;
    const next = {
      ...fixture.defaults,
      codex: {
        ...fixture.defaults.codex,
        environmentVariables: 'OPENAI_BASE_URL=https://local',
      },
    };

    const command = {
      transactionId: TRANSACTION_ID,
      transitionIds: { codex: TRANSITION_ID },
      providerConfigUpdates: { codex: next.codex },
    };
    await expect(fixture.coordinator.apply(command))
      .rejects.toThrow('requires another recovery attempt');
    expect(fixture.lifecycle.transitions.get(TRANSITION_ID)?.status).toBe('restart-required');
    expect(fixture.storage.get(`${PROVIDER_SETTINGS_STAGING_PATH}/${TRANSACTION_ID}.json`))
      .not.toBeNull();

    const restored = new ProviderSettingsTransactionCoordinator(
      fixture.storage,
      builtInProviderCatalog,
      fixture.controlPlane,
      fixture.settingsStore,
      fixture.lifecycle,
      fixture.workspaces,
    );
    await expect(restored.apply(command)).resolves.toEqual({
      transactionId: TRANSACTION_ID,
      affectedProviderIds: ['codex'],
      recovered: true,
    });
    expect(fixture.lifecycle.transitions.get(TRANSITION_ID)?.status).toBe('completed');
    expect(fixture.lifecycle.calls.filter(call => call.startsWith('begin:'))).toHaveLength(1);
    expect(fixture.lifecycle.calls).toContain(`recover:${TRANSITION_ID}`);
    expect(fixture.storage.get(`${PROVIDER_SETTINGS_STAGING_PATH}/${TRANSACTION_ID}.json`))
      .toBeNull();
  });

  it('persists non-runtime settings without opening a backend transition', async () => {
    const fixture = await createFixture();
    const next = {
      ...fixture.defaults,
      codex: { ...fixture.defaults.codex, customModels: 'presentation-only-model' },
    };

    const result = await fixture.coordinator.apply({
      transactionId: TRANSACTION_ID,
      transitionIds: {},
      providerConfigUpdates: { codex: next.codex },
    });

    expect(result.affectedProviderIds).toEqual([]);
    expect(fixture.lifecycle.calls).toEqual([]);
    expect(fixture.workspaces.transitions).toEqual([]);
    expect((await fixture.settingsStore.readActive()).configs.codex?.customModels)
      .toBe('presentation-only-model');
  });

  it('rejects a pending presentation-only retry that omits the original update', async () => {
    const fixture = await createFixture();
    let failClear = true;
    const backing = fixture.settingsStore;
    const failingStore: StagedProviderSettingsStore = {
      readActive: () => backing.readActive(),
      listStagedTransactionIds: () => backing.listStagedTransactionIds(),
      stage: (transactionId, patchInput) => backing.stage(transactionId, patchInput),
      validateTarget: (transactionId, updates) => (
        backing.validateTarget(transactionId, updates)
      ),
      activate: transactionId => backing.activate(transactionId),
      clear: async transactionId => {
        if (failClear) {
          failClear = false;
          throw new Error('clear interrupted');
        }
        await backing.clear(transactionId);
      },
    };
    const coordinator = new ProviderSettingsTransactionCoordinator(
      fixture.storage,
      builtInProviderCatalog,
      fixture.controlPlane,
      failingStore,
      fixture.lifecycle,
      fixture.workspaces,
    );
    const command = {
      transactionId: TRANSACTION_ID,
      transitionIds: {},
      providerConfigUpdates: {
        codex: { ...fixture.defaults.codex, customModels: 'presentation-only-model' },
      },
    };

    await expect(coordinator.apply(command)).rejects.toThrow('clear interrupted');
    await expect(coordinator.apply({
      transactionId: TRANSACTION_ID,
      transitionIds: {},
      providerConfigUpdates: {},
    })).rejects.toThrow('does not match the requested providers');
    await expect(coordinator.apply(command)).resolves.toMatchObject({ recovered: true });
  });

  it('rejects malformed target settings before staging or draining a backend', async () => {
    const fixture = await createFixture();
    await expect(fixture.coordinator.apply({
      transactionId: TRANSACTION_ID,
      transitionIds: { codex: TRANSITION_ID },
      providerConfigUpdates: {
        codex: { ...fixture.defaults.codex, enabled: 'unsafe' },
      },
    })).rejects.toThrow('Provider settings are invalid');

    expect(fixture.lifecycle.calls).toEqual([]);
    expect(fixture.storage.get(`${PROVIDER_SETTINGS_STAGING_PATH}/${TRANSACTION_ID}.json`))
      .toBeNull();
  });

  it('cleans an orphaned sensitive stage left before the durable intent boundary', async () => {
    const fixture = await createFixture();
    await fixture.settingsStore.stage(TRANSACTION_ID, {
      commandProviderIds: ['codex'],
      expectedProviderConfigs: { codex: null },
      providerConfigUpdates: {
        codex: {
          enabled: true,
          environmentVariables: 'OPENAI_API_KEY=private-value',
        },
      },
      runtimeFingerprintUpdates: {},
    });
    expect(fixture.storage.get(`${PROVIDER_SETTINGS_STAGING_PATH}/${TRANSACTION_ID}.json`))
      .toContain('private-value');

    await expect(fixture.coordinator.recoverPending()).resolves.toEqual([]);
    expect(fixture.storage.get(`${PROVIDER_SETTINGS_STAGING_PATH}/${TRANSACTION_ID}.json`))
      .toBeNull();
  });

  it('releases a durable completed generation when workspace completion previously failed', async () => {
    const fixture = await createFixture();
    fixture.workspaces.completeFailures = 1;
    const next = {
      ...fixture.defaults,
      codex: {
        ...fixture.defaults.codex,
        environmentVariables: 'OPENAI_BASE_URL=https://local',
      },
    };

    const command = {
      transactionId: TRANSACTION_ID,
      transitionIds: { codex: TRANSITION_ID },
      providerConfigUpdates: { codex: next.codex },
    };
    await expect(fixture.coordinator.apply(command)).rejects.toThrow(
      'workspace completion failed',
    );
    expect(fixture.lifecycle.transitions.get(TRANSITION_ID)?.status).toBe('completed');

    await expect(fixture.coordinator.apply(command)).resolves.toEqual({
      transactionId: TRANSACTION_ID,
      affectedProviderIds: ['codex'],
      recovered: true,
    });
    expect(fixture.workspaces.transitions).toEqual([
      'begin:codex',
      'complete:codex',
      'complete:codex',
    ]);
  });

  it('serializes disjoint provider updates without losing either change', async () => {
    const fixture = await createFixture();
    const [codex, opencode] = await Promise.all([
      fixture.coordinator.apply({
        transactionId: TRANSACTION_ID,
        transitionIds: { codex: TRANSITION_ID },
        providerConfigUpdates: {
          codex: {
            ...fixture.defaults.codex,
            environmentVariables: 'OPENAI_BASE_URL=https://local',
          },
        },
      }),
      fixture.coordinator.apply({
        transactionId: TRANSACTION_ID_2,
        transitionIds: { opencode: TRANSITION_ID_2 },
        providerConfigUpdates: {
          opencode: {
            ...fixture.defaults.opencode,
            environmentVariables: 'OPENCODE_CONFIG_DIR=/vault/config',
          },
        },
      }),
    ]);
    const active = (await fixture.settingsStore.readActive()).configs;

    expect(codex.affectedProviderIds).toEqual(['codex']);
    expect(opencode.affectedProviderIds).toEqual(['opencode']);
    expect(active.codex?.environmentVariables).toBe('OPENAI_BASE_URL=https://local');
    expect(active.opencode?.environmentVariables).toBe('OPENCODE_CONFIG_DIR=/vault/config');
  });

  it('merges disjoint updates from distinct coordinator and store instances', async () => {
    const fixture = await createFixture();
    const secondStore = new DurableStagedProviderSettingsStore(fixture.storage);
    const secondCoordinator = new ProviderSettingsTransactionCoordinator(
      fixture.storage,
      builtInProviderCatalog,
      fixture.controlPlane,
      secondStore,
      fixture.lifecycle,
      fixture.workspaces,
    );

    await Promise.all([
      fixture.coordinator.apply({
        transactionId: TRANSACTION_ID,
        transitionIds: { codex: TRANSITION_ID },
        providerConfigUpdates: {
          codex: {
            ...fixture.defaults.codex,
            environmentVariables: 'OPENAI_BASE_URL=https://first-owner',
          },
        },
      }),
      secondCoordinator.apply({
        transactionId: TRANSACTION_ID_2,
        transitionIds: { opencode: TRANSITION_ID_2 },
        providerConfigUpdates: {
          opencode: {
            ...fixture.defaults.opencode,
            environmentVariables: 'OPENCODE_CONFIG_DIR=/second-owner',
          },
        },
      }),
    ]);

    const active = await fixture.settingsStore.readActive();
    expect(active.configs.codex?.environmentVariables)
      .toBe('OPENAI_BASE_URL=https://first-owner');
    expect(active.configs.opencode?.environmentVariables)
      .toBe('OPENCODE_CONFIG_DIR=/second-owner');
  });

  it('replays a completed transaction without recreating its sensitive stage', async () => {
    const fixture = await createFixture();
    const command = {
      transactionId: TRANSACTION_ID,
      transitionIds: { codex: TRANSITION_ID },
      providerConfigUpdates: {
        codex: {
          ...fixture.defaults.codex,
          environmentVariables: 'OPENAI_API_KEY=private-value',
        },
      },
    };
    await fixture.coordinator.apply(command);

    await expect(fixture.coordinator.apply(command)).resolves.toEqual({
      transactionId: TRANSACTION_ID,
      affectedProviderIds: ['codex'],
      recovered: true,
    });
    expect(fixture.storage.get(`${PROVIDER_SETTINGS_STAGING_PATH}/${TRANSACTION_ID}.json`))
      .toBeNull();

    await expect(fixture.coordinator.apply({
      ...command,
      providerConfigUpdates: {
        codex: {
          ...command.providerConfigUpdates.codex,
          environmentVariables: 'OPENAI_API_KEY=different-value',
        },
      },
    })).rejects.toThrow('cannot be reused for new settings');
    expect(fixture.storage.get(`${PROVIDER_SETTINGS_STAGING_PATH}/${TRANSACTION_ID}.json`))
      .toBeNull();
  });

  it('audits missing and externally drifted runtime baselines without exposing preimages', async () => {
    const fixture = await createFixture();
    const initialAudit = await fixture.coordinator.auditActiveSettings();
    expect(initialAudit.every(entry => entry.status === 'current')).toBe(true);
    const stored = JSON.parse(fixture.storage.get(GRIMOIRE_SETTINGS_PATH) ?? '{}') as {
      providerConfigs: Record<string, Record<string, unknown>>;
      providerRuntimeFingerprints: Record<string, unknown>;
    };
    stored.providerConfigs.codex = {
      ...stored.providerConfigs.codex,
      environmentVariables: 'OPENAI_API_KEY=externally-changed',
    };
    delete stored.providerRuntimeFingerprints.gemini;
    fixture.storage.seed(GRIMOIRE_SETTINGS_PATH, JSON.stringify(stored));

    const audit = await fixture.coordinator.auditActiveSettings();
    expect(audit.find(entry => entry.providerId === 'codex')?.status).toBe('drifted');
    expect(audit.find(entry => entry.providerId === 'gemini')?.status).toBe('uninitialized');
    expect(JSON.stringify(audit)).not.toContain('externally-changed');
  });

  it('refuses an unrelated update while an externally drifted provider lacks a transition', async () => {
    const fixture = await createFixture();
    const stored = JSON.parse(fixture.storage.get(GRIMOIRE_SETTINGS_PATH) ?? '{}') as {
      providerConfigs: Record<string, Record<string, unknown>>;
    };
    stored.providerConfigs.codex = {
      ...stored.providerConfigs.codex,
      environmentVariables: 'OPENAI_BASE_URL=https://external-change',
    };
    fixture.storage.seed(GRIMOIRE_SETTINGS_PATH, JSON.stringify(stored));

    await expect(fixture.coordinator.apply({
      transactionId: TRANSACTION_ID,
      transitionIds: { opencode: TRANSITION_ID_2 },
      providerConfigUpdates: {
        opencode: {
          ...fixture.defaults.opencode,
          environmentVariables: 'OPENCODE_CONFIG_DIR=/vault/config',
        },
      },
    })).rejects.toThrow('Provider "codex" settings transition id is invalid.');
    expect(fixture.lifecycle.calls).toEqual([]);
  });
});

async function createFixture() {
  const storage = new TestDurableStorage();
  const controlPlane = new ProviderControlPlane(builtInProviderCatalog, digestPort);
  const defaults = controlPlane.defaultConfigs();
  const normalizedDefaults = await controlPlane.normalizeConfigs(defaults);
  const providerRuntimeFingerprints = Object.fromEntries(
    normalizedDefaults.providers.map(provider => [provider.providerId, provider.fingerprint]),
  );
  storage.seed(GRIMOIRE_SETTINGS_PATH, JSON.stringify({
    locale: 'en',
    providerConfigs: defaults,
    providerRuntimeFingerprints,
  }));
  const settingsStore = new DurableStagedProviderSettingsStore(storage);
  const lifecycle = new FakeLifecycle();
  const workspaces = new FakeWorkspaceSettingsPort();
  const coordinator = new ProviderSettingsTransactionCoordinator(
    storage,
    builtInProviderCatalog,
    controlPlane,
    settingsStore,
    lifecycle,
    workspaces,
  );
  return {
    storage,
    controlPlane,
    defaults,
    settingsStore,
    lifecycle,
    workspaces,
    coordinator,
  };
}
