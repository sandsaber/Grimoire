import type {
  ExecutionBackendFactory,
} from '../execution/ExecutionBackendDescriptor';
import type { ProviderId } from '../types/provider';

export type CapabilitySupport = 'native' | 'grimoire' | 'unsupported';
export type SecurityEnforcement = CapabilitySupport | 'advisory';

export interface ProviderManifest {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly order: number;
  readonly settingsPresentation: {
    readonly name: string;
    readonly tabName: string;
    readonly descriptionKey: string;
  };
}

export type ProviderSettingsDecodeResult<TSettings extends object> =
  | {
    readonly ok: true;
    readonly value: TSettings;
    readonly preservedUnknown: Readonly<Record<string, unknown>>;
  }
  | {
    readonly ok: false;
    readonly fallback: TSettings;
    readonly issues: readonly string[];
    readonly preservedUnknown: Readonly<Record<string, unknown>>;
  };

export interface ProviderSettingsCodec<TSettings extends object = Record<string, unknown>> {
  readonly providerId: ProviderId;
  readonly schemaVersion: number;
  defaults(): TSettings;
  decode(input: unknown): ProviderSettingsDecodeResult<TSettings>;
  encode(
    value: TSettings,
    preservedUnknown?: Readonly<Record<string, unknown>>,
  ): Record<string, unknown>;
  /** Returns only values that require a new execution backend generation. */
  runtimeFingerprintInput(value: TSettings): unknown;
}

export interface ProviderWorkspaceContribution<TContext = unknown, TWorkspace = unknown> {
  readonly providerId: ProviderId;
  initialize(context: TContext, signal: AbortSignal): Promise<TWorkspace>;
  dispose(workspace: TWorkspace): Promise<void>;
}

export type ProviderFeatureKind =
  | 'history'
  | 'models'
  | 'commands'
  | 'mcp'
  | 'usage'
  | 'agents'
  | 'fork'
  | 'rewind'
  | 'steering'
  | 'compaction';

export interface ProviderConfiguredModelChoice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface ProviderConfiguredModelsPort<TSettings extends object = object> {
  list(settings: TSettings): readonly ProviderConfiguredModelChoice[];
}

export interface ProviderFeaturePorts<TSettings extends object = object> {
  readonly history?: object;
  readonly models?: ProviderConfiguredModelsPort<TSettings>;
  readonly commands?: object;
  readonly mcp?: object;
  readonly usage?: object;
  readonly agents?: object;
  readonly fork?: object;
  readonly rewind?: object;
  readonly steering?: object;
  readonly compaction?: object;
}

export interface ProviderFeatureContributions<TSettings extends object = object> {
  readonly providerId: ProviderId;
  readonly ports: Readonly<ProviderFeaturePorts<TSettings>>;
}

export type ProviderProcessTopology =
  | 'per-run-process'
  | 'persistent-sdk'
  | 'persistent-app-server'
  | 'managed-subprocess';

export type ProviderProcessConcurrency =
  | 'serial-runs'
  | 'parallel-runs'
  | 'multiplexed-sessions';

export type ProviderHistoryOwnership = 'provider-native' | 'grimoire-projection' | 'none';
export type ProviderCommandDiscovery =
  | 'static'
  | 'active-session'
  | 'ephemeral-process'
  | 'unsupported';
export type ProviderAgentDefinitionInventory = 'native' | 'provider-files' | 'none';
export type ProviderAgentSpawnOrigin = 'grimoire' | 'provider-native';
export type ProviderAgentObservation = 'full' | 'aggregate' | 'terminal-only' | 'opaque' | 'none';

export interface ProviderCapabilityDescriptor {
  readonly providerId: ProviderId;
  readonly process: {
    readonly topology: ProviderProcessTopology;
    readonly concurrency: ProviderProcessConcurrency;
  };
  readonly session: {
    readonly resume: CapabilitySupport;
    readonly transcriptHydration: CapabilitySupport;
  };
  readonly history: {
    readonly ownership: ProviderHistoryOwnership;
  };
  readonly commands: {
    readonly discovery: ProviderCommandDiscovery;
  };
  readonly mcp: {
    readonly ownership: CapabilitySupport;
    readonly sessionConfiguration: CapabilitySupport;
    readonly perRunSelection: CapabilitySupport;
  };
  readonly agents: {
    readonly definitionInventory: ProviderAgentDefinitionInventory;
    readonly spawnOrigins: readonly ProviderAgentSpawnOrigin[];
    readonly stableIdentity: boolean;
    readonly observation: ProviderAgentObservation;
    readonly resultExtraction: CapabilitySupport;
    readonly cancellation: CapabilitySupport;
    readonly statusQuery: CapabilitySupport;
    readonly reattachment: CapabilitySupport;
  };
  readonly controls: {
    readonly fork: CapabilitySupport;
    readonly rewind: CapabilitySupport;
    readonly steering: CapabilitySupport;
    readonly compaction: CapabilitySupport;
  };
  readonly interactions: {
    readonly approval: CapabilitySupport;
    readonly question: CapabilitySupport;
    readonly planExit: CapabilitySupport;
  };
  readonly security: {
    readonly process: SecurityEnforcement;
    readonly filesystem: SecurityEnforcement;
    readonly network: SecurityEnforcement;
    readonly permissions: SecurityEnforcement;
  };
}

export interface ProviderModule<
  TSettings extends object = Record<string, unknown>,
  TWorkspace = unknown,
  TBackend = unknown,
  TWorkspaceContext = unknown,
  TBackendContext = unknown,
> {
  readonly manifest: ProviderManifest;
  readonly settings: ProviderSettingsCodec<TSettings>;
  readonly workspace: ProviderWorkspaceContribution<TWorkspaceContext, TWorkspace>;
  readonly execution: ExecutionBackendFactory<TBackendContext, TBackend>;
  readonly capabilities: ProviderCapabilityDescriptor;
  readonly features: ProviderFeatureContributions<TSettings>;
}
