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

export interface ProviderFeatureContributions {
  readonly providerId: ProviderId;
  readonly ports: Readonly<Partial<Record<ProviderFeatureKind, object>>>;
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
  readonly features: ProviderFeatureContributions;
}
