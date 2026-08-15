import antigravityTrace from '@test/fixtures/provider-traces/antigravity-execution.json';
import claudeTrace from '@test/fixtures/provider-traces/claude-execution.json';
import codexTrace from '@test/fixtures/provider-traces/codex-execution.json';
import opencodeTrace from '@test/fixtures/provider-traces/opencode-execution.json';

import type { ExecutionBackendDescriptor } from '@/core/execution/ExecutionBackendDescriptor';
import type {
  ProviderCapabilityDescriptor,
  ProviderManifest,
} from '@/core/providers/ProviderModule';
import { antigravityProviderModule } from '@/providers/antigravity/AntigravityProviderModule';
import { claudeProviderModule } from '@/providers/claude/ClaudeProviderModule';
import { codexProviderModule } from '@/providers/codex/CodexProviderModule';
import { opencodeProviderModule } from '@/providers/opencode/OpencodeProviderModule';

/**
 * The M2-proofs exit gate.
 *
 * Four providers were proven against four topologies so the execution contract
 * could be shown to fit more than the provider it was designed around. This
 * suite is what stops that from decaying: after it, changing what a topology
 * means requires editing a trace fixture and a module together, deliberately,
 * rather than drifting one of them.
 *
 * Written against the M1 `ProviderModule` contract rather than harvested. The
 * v1 suite asserts a different capability vocabulary — `observation`,
 * `controls`, and support strings where this contract has booleans — so
 * harvesting it would have frozen the shape this migration replaced. Its
 * per-provider agent evidence is real observation, so that data was translated
 * into the fixtures instead of being re-derived.
 *
 * What is deliberately *not* frozen here: the four backends' internal
 * behaviour, which their own suites and the shared conformance suite cover.
 * This is about the claims a provider publishes.
 */

interface AgentEvidence {
  readonly definitions: string;
  readonly spawnOrigin: readonly string[];
  readonly stableIdentity: boolean;
  readonly progressObservation: string;
  readonly resultExtraction: boolean;
  readonly cancellation: boolean;
  readonly statusQuery: boolean;
  readonly reattachment: boolean;
  /** Where the observation comes from, named so a claim cites something. */
  readonly source: string;
  /** The event case that demonstrates the observation, or null if there is none. */
  readonly eventCase: string | null;
  readonly cancellationCase: readonly string[] | null;
}

interface TopologyTrace {
  readonly providerId: string;
  readonly backendId: string;
  readonly topology: string;
  readonly concurrency: string;
  readonly sessionBoundary: string;
  readonly resume: string;
  readonly resultExpectation: string;
  readonly agentObservation: string;
  readonly agentEvidence: AgentEvidence;
  readonly identity: {
    readonly backendGeneration: number;
    readonly executionSessionId: string;
    readonly sessionInstanceId: string;
    readonly runId: string;
  };
  readonly eventCases?: Readonly<Record<string, readonly string[]>>;
  readonly cases: Readonly<Record<string, readonly string[]>>;
}

interface FrozenModule {
  readonly manifest: ProviderManifest;
  readonly execution: { readonly descriptor: ExecutionBackendDescriptor };
  readonly capabilities: ProviderCapabilityDescriptor;
}

const PROOFS: ReadonlyArray<{ module: FrozenModule; trace: TopologyTrace }> = [
  { module: antigravityProviderModule, trace: antigravityTrace },
  { module: codexProviderModule, trace: codexTrace },
  { module: claudeProviderModule, trace: claudeTrace },
  { module: opencodeProviderModule, trace: opencodeTrace },
];

/**
 * Which observation source each label is allowed to cite.
 *
 * The point is that "how much can this provider see of a subagent" is answered
 * by naming the mechanism, not by picking an adjective.
 */
const SOURCE_FOR_OBSERVATION: Readonly<Record<string, string>> = {
  none: 'none',
  aggregate: 'parent-collaboration-events',
  full: 'native-task-notifications',
  'terminal-only': 'native-terminal-events',
  opaque: 'opaque-nested-evidence',
};

describe('execution semantic freeze', () => {
  it('froze exactly the four topology proofs the milestone required', () => {
    expect(PROOFS).toHaveLength(4);
  });

  describe.each(PROOFS)('$trace.providerId', ({ module, trace }) => {
    it('binds its identity and backend to the trace it was proven against', () => {
      expect(module.manifest.id).toBe(trace.providerId);
      expect(module.execution.descriptor).toEqual({
        backendId: trace.backendId,
        association: { kind: 'provider', providerId: trace.providerId },
      });
    });

    it('binds its topology, session boundary, and resume to the trace', () => {
      expect(module.capabilities.process).toEqual({
        topology: trace.topology,
        concurrency: trace.concurrency,
      });
      expect(module.capabilities.session.resume).toBe(
        trace.resume === 'reconstructed' ? 'unsupported' : trace.resume,
      );
    });

    it('declares agent capabilities identical to the recorded evidence', () => {
      const { source, eventCase, cancellationCase, ...declared } = trace.agentEvidence;

      expect(module.capabilities.agents).toEqual(declared);
      expect(source).toBe(SOURCE_FOR_OBSERVATION[trace.agentEvidence.progressObservation]);
      expect(cancellationCase !== null).toBe(trace.agentEvidence.cancellation);
    });

    it('shows an event case for every observation it claims, and none for "none"', () => {
      const { eventCase, progressObservation, stableIdentity, resultExtraction } =
        trace.agentEvidence;
      const events = eventCase ? trace.eventCases?.[eventCase] ?? [] : [];

      // A claim of "none" that still carries agent events is a provider whose
      // record understates it; a claim of observation with no events is one
      // that overstates it. Both are drift the freeze exists to catch.
      expect(eventCase === null).toBe(progressObservation === 'none');
      expect(eventCase === null || events.length > 0).toBe(true);
      // Two naming conventions are in use across the recordings —
      // `native-agent-observed:` and `agent:observed:` — because the traces
      // were captured against different providers' vocabularies. Both are
      // accepted; what is not accepted is a claim with no event behind it.
      const shows = (subject: string): boolean => events.some(event => (
        event.includes(`agent-${subject}`) || event.includes(`agent:${subject}`)
      ));

      // Implication rather than a branch: a claim requires its event, and no
      // claim requires nothing. Written this way so the assertion runs for
      // every provider instead of only for the ones that claim.
      expect(!stableIdentity || shows('observed')).toBe(true);
      expect(!resultExtraction || shows('result')).toBe(true);
    });

    it('records identities in the kernel id formats', () => {
      expect(trace.identity.executionSessionId).toMatch(/^es-[0-9a-f]{32}$/);
      expect(trace.identity.sessionInstanceId).toMatch(/^si-[0-9a-f]{32}$/);
      expect(trace.identity.runId).toMatch(/^run-[0-9a-f]{32}$/);
      expect(Number.isInteger(trace.identity.backendGeneration)).toBe(true);
    });

    it('carries at least one recorded case, so the trace is evidence and not a header', () => {
      expect(Object.keys(trace.cases).length).toBeGreaterThan(0);
      expect(Object.values(trace.cases).every(steps => steps.length > 0)).toBe(true);
    });
  });

  describe('the proofs as a set', () => {
    it('covers four materially distinct topologies', () => {
      // The reason for four proofs rather than one: a contract that fits only
      // repetitions of the same shape has not been tested.
      expect(new Set(PROOFS.map(proof => proof.trace.topology)).size).toBe(4);
      expect(new Set(PROOFS.map(proof => (
        `${proof.trace.topology}:${proof.trace.concurrency}`
      ))).size).toBe(4);
    });

    it('gives every proof its own backend id', () => {
      const backendIds = PROOFS.map(proof => proof.module.execution.descriptor.backendId);

      expect(new Set(backendIds).size).toBe(PROOFS.length);
    });

    it('spans the range of every capability the proofs were chosen to stress', () => {
      // Each of these is a dimension where a single-provider contract would
      // have quietly assumed one answer.
      const spans = {
        resume: PROOFS.map(proof => proof.module.capabilities.session.resume),
        history: PROOFS.map(proof => proof.module.capabilities.history.ownership),
        mcpOwnership: PROOFS.map(proof => proof.module.capabilities.mcp.ownership),
        commands: PROOFS.map(proof => proof.module.capabilities.commands.discovery),
        security: PROOFS.map(proof => proof.module.capabilities.security.enforcement),
      };

      for (const [dimension, values] of Object.entries(spans)) {
        expect([dimension, new Set(values).size > 1]).toEqual([dimension, true]);
      }
    });

    it('keeps exactly one provider able to rewind, and it is the one with the port', () => {
      const canRewind = PROOFS.filter(proof => (
        proof.module.capabilities.conversation.rewind === 'native'
      ));

      expect(canRewind.map(proof => proof.trace.providerId)).toEqual(['claude']);
    });

    it('never lets an observation label stand in for an agent action', () => {
      // The rule the capability record exists to enforce: seeing a subagent's
      // progress says nothing about being able to stop it, ask after it, or
      // reattach to it. Only Claude can cancel; none can query or reattach.
      const agents = PROOFS.map(proof => proof.module.capabilities.agents);

      expect(agents.filter(agent => agent.cancellation)).toHaveLength(1);
      expect(agents.filter(agent => agent.statusQuery)).toHaveLength(0);
      expect(agents.filter(agent => agent.reattachment)).toHaveLength(0);
      expect(agents.every(agent => (
        agent.progressObservation === 'none' ? !agent.resultExtraction : true
      ))).toBe(true);
    });
  });
});
