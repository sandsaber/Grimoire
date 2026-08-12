import { PROVIDER_SETTINGS_TRANSACTION_INTENTS_PATH } from '../bootstrap/StoragePaths';
import type { ExecutionBackendId } from '../execution/ExecutionBackendDescriptor';
import type { SettingsTransitionSnapshot } from '../execution/ExecutionLifecycleRegistry';
import type { DurableStorage } from '../persistence/DurableStorage';
import {
  TransactionIntentCoordinator,
  type TransactionIntentSnapshot,
  type TransactionStep,
  type TransactionStepHandler,
} from '../persistence/TransactionIntentCoordinator';
import type { ProviderId } from '../types/provider';
import type { ProviderCatalog } from './ProviderCatalog';
import type {
  ProviderConfigMap,
  ProviderControlPlane,
} from './ProviderControlPlane';
import type { ProviderSettingsFingerprint } from './ProviderSettingsFingerprint';

export type ProviderRuntimeFingerprintMap = Readonly<Record<
string,
ProviderSettingsFingerprint
>>;

export interface ActiveProviderSettingsState {
  readonly configs: ProviderConfigMap;
  readonly runtimeFingerprints: ProviderRuntimeFingerprintMap;
}

export type ExpectedProviderConfigMap = Readonly<Record<
string,
Readonly<Record<string, unknown>> | null
>>;

export interface StagedProviderSettingsPatch {
  readonly commandProviderIds: readonly ProviderId[];
  readonly expectedProviderConfigs: ExpectedProviderConfigMap;
  readonly providerConfigUpdates: ProviderConfigMap;
  readonly runtimeFingerprintUpdates: ProviderRuntimeFingerprintMap;
}

export interface ProviderSettingsAuditEntry {
  readonly providerId: ProviderId;
  readonly status: 'current' | 'uninitialized' | 'drifted' | 'invalid';
  readonly activeFingerprint: ProviderSettingsFingerprint;
  readonly recordedFingerprint?: ProviderSettingsFingerprint;
  readonly issues: readonly string[];
}

export interface StagedProviderSettingsStore {
  readActive(): Promise<ActiveProviderSettingsState>;
  listStagedTransactionIds(): Promise<readonly string[]>;
  stage(
    transactionId: string,
    patch: StagedProviderSettingsPatch,
  ): Promise<void>;
  validateTarget(transactionId: string, providerConfigUpdates: ProviderConfigMap): Promise<void>;
  activate(transactionId: string): Promise<void>;
  clear(transactionId: string): Promise<void>;
}

export interface ProviderSettingsLifecyclePort {
  beginSettingsTransition(command: {
    readonly transitionId: string;
    readonly backendId: ExecutionBackendId;
    readonly settingsFingerprint: string;
  }): Promise<void>;
  markSettingsTransitionApplying(transitionId: string): Promise<void>;
  completeSettingsTransition(transitionId: string): Promise<void>;
  recoverSettingsTransition(transitionId: string, activeFingerprint: string): Promise<void>;
  getSettingsTransition(transitionId: string): Promise<SettingsTransitionSnapshot | null>;
}

export interface ProviderWorkspaceSettingsPort {
  beginSettingsTransition(providerId: ProviderId, transitionId: string): Promise<void>;
  completeSettingsTransition(providerId: ProviderId, transitionId: string): Promise<void>;
}

export interface ApplyProviderSettingsCommand {
  readonly transactionId: string;
  readonly transitionIds: Readonly<Record<string, string>>;
  readonly providerConfigUpdates: ProviderConfigMap;
}

export interface ApplyProviderSettingsResult {
  readonly transactionId: string;
  readonly affectedProviderIds: readonly ProviderId[];
  readonly recovered: boolean;
}

const TRANSACTION_KIND = 'provider-settings';
const HANDLER_BEGIN = 'provider-settings-begin';
const HANDLER_APPLY = 'provider-settings-apply';
const HANDLER_ACTIVATE = 'provider-settings-activate';
const HANDLER_COMPLETE = 'provider-settings-complete';
const HANDLER_CLEAR = 'provider-settings-clear';

/**
 * Coordinates settings persistence and backend generation changes without
 * writing provider settings or fingerprint preimages into the control store.
 */
export class ProviderSettingsTransactionCoordinator {
  private readonly intents: TransactionIntentCoordinator;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(
    storage: DurableStorage,
    private readonly catalog: ProviderCatalog,
    private readonly controlPlane: ProviderControlPlane,
    private readonly settingsStore: StagedProviderSettingsStore,
    private readonly lifecycle: ProviderSettingsLifecyclePort,
    private readonly workspaces: ProviderWorkspaceSettingsPort,
  ) {
    this.intents = new TransactionIntentCoordinator(storage, {
      namespace: PROVIDER_SETTINGS_TRANSACTION_INTENTS_PATH,
      kinds: [TRANSACTION_KIND],
      handlers: this.createHandlers(),
    });
  }

  apply(command: ApplyProviderSettingsCommand): Promise<ApplyProviderSettingsResult> {
    return this.enqueue(() => this.applyUnlocked(command));
  }

  recoverPending(): Promise<readonly ApplyProviderSettingsResult[]> {
    return this.enqueue(() => this.recoverPendingUnlocked());
  }

  private async applyUnlocked(
    command: ApplyProviderSettingsCommand,
  ): Promise<ApplyProviderSettingsResult> {
    requireTransactionId(command.transactionId);
    const current = await this.settingsStore.readActive();
    const normalized = await this.controlPlane.normalizeConfigs({
      ...current.configs,
      ...command.providerConfigUpdates,
    });
    const existingIntent = await this.intents.getIntent(command.transactionId);
    if (existingIntent?.status === 'completed') {
      return this.validateCompletedReplay(command, current, normalized.configs, existingIntent);
    }
    if (existingIntent?.status === 'pending') {
      return this.resumePending(command, normalized.configs, normalized.providers, existingIntent);
    }
    const runtimeFingerprints = Object.freeze({
      ...current.runtimeFingerprints,
      ...Object.fromEntries(normalized.providers.map(provider => [
        provider.providerId,
        provider.fingerprint,
      ])),
    });
    const affectedProviderIds = Object.freeze(normalized.providers.flatMap(provider => (
      current.runtimeFingerprints[provider.providerId]?.digest === provider.fingerprint.digest
        ? []
        : [provider.providerId]
    )));
    const targets = await Promise.all(affectedProviderIds.map(async providerId => {
      const transitionId = command.transitionIds[providerId];
      requireTransitionId(transitionId, providerId);
      const projection = normalized.providers.find(provider => provider.providerId === providerId);
      if (!projection) throw new Error(`Provider "${providerId}" has no normalized settings.`);
      const module = this.catalog.require(providerId);
      return {
        providerId,
        transitionId,
        backendId: module.execution.descriptor.backendId,
        fingerprint: projection.fingerprint.digest,
      };
    }));

    const stagedProviderIds = new Set([
      ...Object.keys(command.providerConfigUpdates),
      ...affectedProviderIds,
    ]);
    const patch: StagedProviderSettingsPatch = Object.freeze({
      commandProviderIds: Object.freeze(Object.keys(command.providerConfigUpdates).sort()),
      expectedProviderConfigs: Object.freeze(Object.fromEntries(
        [...stagedProviderIds].map(providerId => [
          providerId,
          current.configs[providerId] ?? null,
        ]),
      )),
      providerConfigUpdates: Object.freeze(Object.fromEntries(
        [...stagedProviderIds].map(providerId => [providerId, normalized.configs[providerId] ?? {}]),
      )),
      runtimeFingerprintUpdates: Object.freeze(Object.fromEntries(
        affectedProviderIds.map(providerId => [providerId, runtimeFingerprints[providerId]]),
      )),
    });

    const operation = {
      transactionId: command.transactionId,
      kind: TRANSACTION_KIND,
      steps: createSteps(command.transactionId, targets),
    };
    // The settings-domain stage must exist before the recoverable intent can
    // execute. A crash in this narrow order leaves an orphan that startup
    // cleanup can safely identify; the opposite order would strand a durable
    // pending intent without its sensitive inputs.
    await this.settingsStore.stage(command.transactionId, patch);
    const result = await this.intents.execute(operation);
    return Object.freeze({
      transactionId: command.transactionId,
      affectedProviderIds: Object.freeze([...affectedProviderIds]),
      recovered: result.recovered,
    });
  }

  private async resumePending(
    command: ApplyProviderSettingsCommand,
    requestedConfigs: ProviderConfigMap,
    normalizedProviders: readonly {
      readonly providerId: ProviderId;
      readonly fingerprint: ProviderSettingsFingerprint;
    }[],
    intent: TransactionIntentSnapshot,
  ): Promise<ApplyProviderSettingsResult> {
    if (intent.kind !== TRANSACTION_KIND) {
      throw new Error(`Transaction "${command.transactionId}" has a different kind.`);
    }
    const targets = completedIntentTargets(intent);
    this.requireMatchingCommandTransitions(command, targets, 'Pending');
    for (const target of targets) {
      const requested = normalizedProviders.find(provider => (
        provider.providerId === target.providerId
      ));
      if (requested?.fingerprint.digest !== target.fingerprint) {
        throw new Error(
          `Pending transaction "${command.transactionId}" cannot be reused for new settings.`,
        );
      }
    }
    await this.settingsStore.validateTarget(
      command.transactionId,
      Object.freeze(Object.fromEntries(Object.keys(command.providerConfigUpdates).map(providerId => [
        providerId,
        requestedConfigs[providerId] ?? {},
      ]))),
    );
    const result = await this.intents.execute(operationFromIntent(intent));
    return Object.freeze({
      transactionId: command.transactionId,
      affectedProviderIds: Object.freeze(targets.map(target => target.providerId)),
      recovered: result.recovered,
    });
  }

  private async recoverPendingUnlocked(): Promise<readonly ApplyProviderSettingsResult[]> {
    const knownTransactionIds = new Set(await this.intents.listPendingTransactionIds());
    for (const stagedTransactionId of await this.settingsStore.listStagedTransactionIds()) {
      if (!knownTransactionIds.has(stagedTransactionId)) {
        await this.settingsStore.clear(stagedTransactionId);
      }
    }
    const results = await this.intents.recoverPending();
    return Object.freeze(results.map(result => Object.freeze({
      transactionId: result.transactionId,
      affectedProviderIds: Object.freeze([]),
      recovered: true,
    })));
  }

  private validateCompletedReplay(
    command: ApplyProviderSettingsCommand,
    active: ActiveProviderSettingsState,
    requestedConfigs: ProviderConfigMap,
    intent: TransactionIntentSnapshot,
  ): ApplyProviderSettingsResult {
    if (intent.kind !== TRANSACTION_KIND) {
      throw new Error(`Transaction "${command.transactionId}" has a different kind.`);
    }
    for (const providerId of Object.keys(command.providerConfigUpdates)) {
      if (!sameValue(active.configs[providerId], requestedConfigs[providerId])) {
        throw new Error(
          `Completed transaction "${command.transactionId}" cannot be reused for new settings.`,
        );
      }
    }
    const targets = completedIntentTargets(intent);
    this.requireMatchingCommandTransitions(command, targets, 'Completed');
    for (const target of targets) {
      if (active.runtimeFingerprints[target.providerId]?.digest !== target.fingerprint) {
        throw new Error(
          `Completed transaction "${command.transactionId}" is not active anymore.`,
        );
      }
    }
    return Object.freeze({
      transactionId: command.transactionId,
      affectedProviderIds: Object.freeze(targets.map(target => target.providerId)),
      recovered: true,
    });
  }

  private requireMatchingCommandTransitions(
    command: ApplyProviderSettingsCommand,
    targets: readonly TransitionTarget[],
    status: 'Pending' | 'Completed',
  ): void {
    if (!sameStringMap(
      command.transitionIds,
      Object.fromEntries(targets.map(target => [target.providerId, target.transitionId])),
    )) {
      throw new Error(
        `${status} transaction "${command.transactionId}" transition identities do not match.`,
      );
    }
  }

  auditActiveSettings(): Promise<readonly ProviderSettingsAuditEntry[]> {
    return this.enqueue(() => this.auditActiveSettingsUnlocked());
  }

  private async auditActiveSettingsUnlocked(): Promise<readonly ProviderSettingsAuditEntry[]> {
    const active = await this.settingsStore.readActive();
    const products = await this.controlPlane.listProducts(active.configs);
    return Object.freeze(products.map(product => {
      const recordedFingerprint = active.runtimeFingerprints[product.definition.providerId];
      const status = !product.settings.valid
        ? 'invalid' as const
        : !recordedFingerprint
          ? 'uninitialized' as const
          : recordedFingerprint.digest === product.settings.fingerprint.digest
            && recordedFingerprint.version === product.settings.fingerprint.version
            && recordedFingerprint.algorithm === product.settings.fingerprint.algorithm
            ? 'current' as const
            : 'drifted' as const;
      return Object.freeze({
        providerId: product.definition.providerId,
        status,
        activeFingerprint: product.settings.fingerprint,
        ...(recordedFingerprint ? { recordedFingerprint } : {}),
        issues: product.settings.issues,
      });
    }));
  }

  private enqueue<TResult>(task: () => Promise<TResult>): Promise<TResult> {
    const operation = this.operationTail.catch(() => undefined).then(task);
    this.operationTail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private createHandlers(): readonly TransactionStepHandler[] {
    return [
      handler(HANDLER_BEGIN, validateTransitionInput, async input => {
        this.requireTargetIdentity(input);
        const existing = await this.lifecycle.getSettingsTransition(input.transitionId);
        if (existing) {
          requireMatchingTransition(existing, input);
        } else {
          await this.lifecycle.beginSettingsTransition({
            transitionId: input.transitionId,
            backendId: input.backendId as ExecutionBackendId,
            settingsFingerprint: input.fingerprint,
          });
        }
        await this.workspaces.beginSettingsTransition(input.providerId, input.transitionId);
      }),
      handler(HANDLER_APPLY, validateTransitionInput, async input => {
        this.requireTargetIdentity(input);
        const existing = await requireExistingTransition(this.lifecycle, input);
        if (existing.record.status === 'completed' || existing.record.status === 'applying') return;
        if (existing.record.status === 'restart-required') {
          return;
        }
        await this.lifecycle.markSettingsTransitionApplying(input.transitionId);
      }),
      handler(HANDLER_ACTIVATE, validateTransactionInput, input => (
        this.settingsStore.activate(input.transactionId)
      )),
      handler(HANDLER_COMPLETE, validateTransitionInput, async input => {
        this.requireTargetIdentity(input);
        await this.settingsStore.activate(input.transactionId);
        const activeState = await this.settingsStore.readActive();
        const active = await this.controlPlane.project(input.providerId, activeState.configs);
        if (!active.settings.valid
          || active.settings.fingerprint.digest !== input.fingerprint
          || activeState.runtimeFingerprints[input.providerId]?.digest !== input.fingerprint) {
          throw new Error(
            `Active provider "${input.providerId}" settings do not match the transition intent.`,
          );
        }
        const existing = await requireExistingTransition(this.lifecycle, input);
        if (existing.record.status !== 'completed') {
          if (existing.record.status === 'restart-required') {
            await this.lifecycle.recoverSettingsTransition(input.transitionId, input.fingerprint);
          } else {
            await this.lifecycle.completeSettingsTransition(input.transitionId);
          }
        }
        const completed = await requireExistingTransition(this.lifecycle, input);
        if (completed.record.status !== 'completed') {
          throw new Error(
            `Settings transition "${input.transitionId}" requires another recovery attempt.`,
          );
        }
        await this.workspaces.completeSettingsTransition(
          input.providerId,
          input.transitionId,
        );
      }),
      handler(HANDLER_CLEAR, validateTransactionInput, input => (
        this.settingsStore.clear(input.transactionId)
      )),
    ];
  }

  private requireTargetIdentity(input: TransitionInput): void {
    const descriptor = this.catalog.require(input.providerId).execution.descriptor;
    if (descriptor.backendId !== input.backendId) {
      throw new Error(
        `Provider "${input.providerId}" backend does not match the transition intent.`,
      );
    }
  }
}

interface TransitionTarget {
  readonly providerId: ProviderId;
  readonly transitionId: string;
  readonly backendId: ExecutionBackendId;
  readonly fingerprint: string;
}

interface TransitionInput extends Readonly<Record<string, unknown>> {
  readonly backendId: string;
  readonly fingerprint: string;
  readonly providerId: ProviderId;
  readonly transactionId: string;
  readonly transitionId: string;
}

interface TransactionInput extends Readonly<Record<string, unknown>> {
  readonly transactionId: string;
}

function createSteps(
  transactionId: string,
  targets: readonly TransitionTarget[],
): readonly TransactionStep[] {
  const steps: TransactionStep[] = [];
  for (const target of targets) {
    steps.push(step(steps.length, HANDLER_BEGIN, transitionInput(transactionId, target)));
  }
  for (const target of targets) {
    steps.push(step(steps.length, HANDLER_APPLY, transitionInput(transactionId, target)));
  }
  steps.push(step(steps.length, HANDLER_ACTIVATE, { transactionId }));
  for (const target of targets) {
    steps.push(step(steps.length, HANDLER_COMPLETE, transitionInput(transactionId, target)));
  }
  steps.push(step(steps.length, HANDLER_CLEAR, { transactionId }));
  return steps;
}

function completedIntentTargets(intent: TransactionIntentSnapshot): readonly TransitionTarget[] {
  return Object.freeze(intent.steps.flatMap(stepRecord => {
    if (stepRecord.handlerId !== HANDLER_BEGIN) return [];
    const input = validateTransitionInput(stepRecord.input);
    return [{
      providerId: input.providerId,
      transitionId: input.transitionId,
      backendId: input.backendId as ExecutionBackendId,
      fingerprint: input.fingerprint,
    }];
  }));
}

function operationFromIntent(intent: TransactionIntentSnapshot) {
  return {
    transactionId: intent.transactionId,
    kind: intent.kind,
    steps: intent.steps,
  };
}

function sameStringMap(
  first: Readonly<Record<string, string>>,
  second: Readonly<Record<string, string>>,
): boolean {
  const keys = new Set([...Object.keys(first), ...Object.keys(second)]);
  return [...keys].every(key => first[key] === second[key]);
}

function sameValue(first: unknown, second: unknown): boolean {
  return stableSerialize(first) === stableSerialize(second);
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(',')}}`;
}

function step(
  index: number,
  handlerId: string,
  input: Readonly<Record<string, unknown>>,
): TransactionStep {
  return { id: `step-${index}`, handlerId, input };
}

function transitionInput(transactionId: string, target: TransitionTarget): TransitionInput {
  return {
    backendId: target.backendId,
    fingerprint: target.fingerprint,
    providerId: target.providerId,
    transactionId,
    transitionId: target.transitionId,
  };
}

function handler<TInput extends Readonly<Record<string, unknown>>>(
  handlerId: string,
  validate: (input: unknown) => TInput,
  apply: (input: TInput) => Promise<void>,
): TransactionStepHandler {
  return { handlerId, validate, apply: input => apply(validate(input)) };
}

function validateTransitionInput(input: unknown): TransitionInput {
  const record = requireExactRecord(input, [
    'backendId',
    'fingerprint',
    'providerId',
    'transactionId',
    'transitionId',
  ]);
  requireIdentifier(record.backendId, 'backend id');
  requireFingerprint(record.fingerprint);
  requireIdentifier(record.providerId, 'provider id');
  requireTransactionId(record.transactionId);
  requireTransitionId(record.transitionId, 'unknown');
  return {
    backendId: record.backendId,
    fingerprint: record.fingerprint,
    providerId: record.providerId,
    transactionId: record.transactionId,
    transitionId: record.transitionId,
  };
}

function validateTransactionInput(input: unknown): TransactionInput {
  const record = requireExactRecord(input, ['transactionId']);
  requireTransactionId(record.transactionId);
  return { transactionId: record.transactionId };
}

async function requireExistingTransition(
  lifecycle: ProviderSettingsLifecyclePort,
  input: TransitionInput,
): Promise<SettingsTransitionSnapshot> {
  const existing = await lifecycle.getSettingsTransition(input.transitionId);
  if (!existing) throw new Error(`Settings transition "${input.transitionId}" is missing.`);
  requireMatchingTransition(existing, input);
  return existing;
}

function requireMatchingTransition(
  existing: SettingsTransitionSnapshot,
  input: TransitionInput,
): void {
  if (existing.record.backendId !== input.backendId
    || existing.record.settingsFingerprint !== input.fingerprint) {
    throw new Error(`Settings transition "${input.transitionId}" does not match its intent.`);
  }
}

function requireExactRecord(
  input: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Provider settings transaction input must be an object.');
  }
  const record = input as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    throw new Error('Provider settings transaction input has invalid fields.');
  }
  return record;
}

function requireTransactionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^tx-[0-9a-f]{32}$/.test(value)) {
    throw new Error('Provider settings transaction id is invalid.');
  }
}

function requireTransitionId(
  value: unknown,
  providerId: string,
): asserts value is string {
  if (typeof value !== 'string' || !/^st-[0-9a-f]{32}$/.test(value)) {
    throw new Error(`Provider "${providerId}" settings transition id is invalid.`);
  }
}

function requireIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function requireFingerprint(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error('Provider settings fingerprint is invalid.');
  }
}
