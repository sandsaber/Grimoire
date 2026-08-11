import antigravityTrace from '@test/fixtures/provider-traces/antigravity-execution.json';
import claudeTrace from '@test/fixtures/provider-traces/claude-execution.json';
import codexTrace from '@test/fixtures/provider-traces/codex-execution.json';
import opencodeTrace from '@test/fixtures/provider-traces/opencode-execution.json';
import qwenTrace from '@test/fixtures/provider-traces/qwen-execution.json';

import type { ExecutionBackendDescriptor } from '@/core/execution/ExecutionBackendDescriptor';
import type {
  ProviderCapabilityDescriptor,
  ProviderManifest,
} from '@/core/providers/ProviderModule';
import { antigravityProviderModule } from '@/providers/antigravity/AntigravityProviderModule';
import { claudeProviderModule } from '@/providers/claude/ClaudeProviderModule';
import { codexProviderModule } from '@/providers/codex/CodexProviderModule';
import { opencodeProviderModule } from '@/providers/opencode/OpencodeProviderModule';
import { qwenProviderModule } from '@/providers/qwen/QwenProviderModule';

interface TopologyTrace {
  readonly providerId: string;
  readonly backendId: string;
  readonly topology: string;
  readonly concurrency: string;
  readonly historyOwnership: string;
  readonly resultExpectation: string;
  readonly agentObservation: string;
  readonly agentEvidence: {
    readonly definitionInventory: string;
    readonly spawnOrigins: readonly string[];
    readonly stableIdentity: boolean;
    readonly observation: string;
    readonly resultExtraction: string;
    readonly cancellation: string;
    readonly statusQuery: string;
    readonly reattachment: string;
    readonly source: string;
    readonly eventCase: string | null;
    readonly cancellationCase: readonly string[] | null;
    readonly statusQueryCase: readonly string[] | null;
    readonly reattachmentCase: readonly string[] | null;
  };
  readonly identity: {
    readonly backendGeneration: number;
    readonly executionSessionId: string;
    readonly sessionInstanceId: string;
    readonly runId: string;
    readonly nativeSessionId?: string;
    readonly nativeThreadId?: string;
    readonly nativeRunId?: string;
    readonly nativeTurnId?: string;
  };
  readonly eventCases: Readonly<Record<string, readonly string[]>>;
  readonly cases: Readonly<Record<string, readonly string[]>>;
}

interface FrozenModuleProof {
  readonly manifest: ProviderManifest;
  readonly execution: { readonly descriptor: ExecutionBackendDescriptor };
  readonly capabilities: ProviderCapabilityDescriptor;
}

const topologyProofs: ReadonlyArray<{
  readonly module: FrozenModuleProof;
  readonly trace: TopologyTrace;
}> = [
  { module: antigravityProviderModule, trace: antigravityTrace },
  { module: codexProviderModule, trace: codexTrace },
  { module: claudeProviderModule, trace: claudeTrace },
  { module: opencodeProviderModule, trace: opencodeTrace },
];

const providerProofs: typeof topologyProofs = [
  ...topologyProofs,
  { module: qwenProviderModule, trace: qwenTrace },
];

describe('execution semantic freeze', () => {
  it.each(providerProofs)(
    'binds $trace.providerId topology, history, identity, and agent fidelity to its module',
    ({ module, trace }) => {
      expect(module.manifest.id).toBe(trace.providerId);
      expect(module.execution.descriptor).toEqual({
        backendId: trace.backendId,
        association: { kind: 'provider', providerId: trace.providerId },
      });
      expect(module.capabilities.process).toEqual({
        topology: trace.topology,
        concurrency: trace.concurrency,
      });
      expect(module.capabilities.history.ownership).toBe(trace.historyOwnership);
      expect(module.capabilities.agents.observation).toBe(trace.agentObservation);
      expect(trace.resultExpectation).toBe('required');
      expect(trace.identity).toEqual(expect.objectContaining({
        backendGeneration: expect.any(Number),
        executionSessionId: expect.stringMatching(/^es-[0-9a-f]{32}$/),
        sessionInstanceId: expect.stringMatching(/^si-[0-9a-f]{32}$/),
        runId: expect.stringMatching(/^run-[0-9a-f]{32}$/),
      }));

      const {
        source,
        eventCase,
        cancellationCase,
        statusQueryCase,
        reattachmentCase,
        ...declaredAgentCapabilities
      } = trace.agentEvidence;
      expect(module.capabilities.agents).toEqual(declaredAgentCapabilities);
      const expectedSourceByObservation: Readonly<Record<string, string>> = {
        none: 'none',
        aggregate: 'parent-collaboration-events',
        full: 'native-task-notifications',
        'terminal-only': 'native-terminal-events',
        opaque: 'opaque-nested-evidence',
      };
      expect(source).toBe(expectedSourceByObservation[trace.agentObservation]);
      expect(eventCase === null).toBe(trace.agentObservation === 'none');
      expect(cancellationCase !== null).toBe(
        trace.agentEvidence.cancellation !== 'unsupported',
      );
      expect(statusQueryCase !== null).toBe(
        trace.agentEvidence.statusQuery !== 'unsupported',
      );
      expect(reattachmentCase !== null).toBe(
        trace.agentEvidence.reattachment !== 'unsupported',
      );

      const agentEvents = eventCase ? (trace.eventCases[eventCase] ?? []) : [];
      expect(eventCase !== null && agentEvents.length === 0).toBe(false);
      const hasObservedIdentity = agentEvents.some(event => event.includes('agent-observed')
        || event.includes('agent:observed'));
      const hasResult = agentEvents.some(event => event.includes('agent-result')
        || event.includes('agent:result'));
      expect(declaredAgentCapabilities.stableIdentity && !hasObservedIdentity).toBe(false);
      expect(declaredAgentCapabilities.resultExtraction !== 'unsupported' && !hasResult)
        .toBe(false);
      expect(trace.agentObservation === 'none' && agentEvents.length > 0).toBe(false);
    },
  );

  it('keeps the four topology proofs materially distinct', () => {
    expect(new Set(topologyProofs.map(proof => (
      `${proof.trace.topology}:${proof.trace.concurrency}`
    ))).size).toBe(topologyProofs.length);
  });
});
