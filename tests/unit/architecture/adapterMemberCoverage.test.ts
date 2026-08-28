import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readInterfaceMembers } from '@test/helpers/interfaceMembers';

import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import type { ExecutionInteractionCallbacks } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';
import { ExecutionChatRuntimeAdapter } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';

/**
 * The M2-adapter exit gate: every `ChatRuntime` member has an answer.
 *
 * The plan makes a deviation that needs a new `ChatRuntime` member a stop
 * condition, which only means something if the adapter's coverage of the
 * existing thirty-two is checked rather than asserted in a journal. It was
 * asserted in a journal first, and the entry was wrong — the adapter covered
 * fourteen while the note said only two optional loaders remained.
 *
 * Absence is a verdict, not a gap, but it has to be written down here with its
 * reason, so "we decided not to" stays distinguishable from "we did not notice".
 */

const ADAPTER_PATH = 'src/core/runtime/execution/ExecutionChatRuntimeAdapter.ts';

/**
 * Members the adapter deliberately does not implement, each with the reason
 * from `docs/provider-execution-adapter-contract.md`.
 */
const DECLARED_ABSENCES: Readonly<Record<string, string>> = {
  // Row 18: model routing is a workspace port, and the adapter has no
  // auxiliary execution of its own until M5.
  getAuxiliaryModel: 'auxiliary model routing belongs to the workspace port at M5',
  // Rows 31 and 32: optional, no production call site, and no provider
  // declares the capability. Present-but-empty is the shape the contract bans.
  loadSubagentToolCalls: 'optional; no provider declares subagent tool loading',
  loadSubagentFinalResult: 'optional; no provider declares subagent result loading',
};

/**
 * Assignability, checked by the compiler rather than by this file.
 *
 * The name comparison below is a coarse net; it passed while `rewind` was a
 * getter returning a capability port, and while four other members had
 * signatures the caller could not use. This declaration is what actually holds
 * the adapter to the contract: it fails `npm run typecheck`, not a test run, if
 * any member's shape drifts.
 *
 * Written as a type-level assertion rather than `implements` on the class so
 * the adapter stays constructible in tests without a full plugin host.
 */
type AdapterSatisfiesContract = ExecutionChatRuntimeAdapter extends Pick<
ChatRuntime,
| 'providerId'
| 'getCapabilities'
| 'prepareTurn'
| 'onReadyStateChange'
| 'setResumeCheckpoint'
| 'syncConversationState'
| 'reloadMcpServers'
| 'ensureReady'
| 'query'
| 'cancel'
| 'resetSession'
| 'getSessionId'
| 'consumeSessionInvalidation'
| 'isReady'
| 'getSupportedCommands'
| 'cleanup'
| 'rewind'
// The six interaction setters were here until the seam deletion took them off
// the contract. They are one `installInteractions` on the adapter now, which is
// not a `ChatRuntime` member and so cannot be listed — the assertion below
// checks it exists instead. `setAutoTurnCallback` stayed, because the kernel's
// backend-initiated turns still reach the surface through it.
| 'setAutoTurnCallback'
| 'consumeTurnMetadata'
| 'buildSessionUpdates'
| 'resolveSessionIdForFork'
> ? true : false;

const ADAPTER_IS_ASSIGNABLE: AdapterSatisfiesContract = true;

/**
 * The interaction installation, which is deliberately *not* on the contract.
 *
 * Six setters that the adapter stored and never acted on were a seam, not a
 * runtime capability. Asserted here rather than in the `Pick` above because
 * `keyof ChatRuntime` can no longer name it — which is the point.
 */
type AdapterInstallsInteractions =
  ExecutionChatRuntimeAdapter['installInteractions'] extends
    (callbacks: ExecutionInteractionCallbacks) => void ? true : false;

const ADAPTER_INSTALLS_INTERACTIONS: AdapterInstallsInteractions = true;

describe('adapter member coverage', () => {
  it('is assignable to the contract, which the compiler decides', () => {
    // The assertion above is the real check; this only keeps the constant used
    // so the file cannot drift into being type-only and stop being compiled.
    expect(ADAPTER_IS_ASSIGNABLE).toBe(true);
    expect(ADAPTER_INSTALLS_INTERACTIONS).toBe(true);
  });

  const contractMembers = readInterfaceMembers('src/core/runtime/ChatRuntime.ts', 'ChatRuntime');
  const adapterMembers = new Set([
    ...Object.getOwnPropertyNames(ExecutionChatRuntimeAdapter.prototype),
    // Fields assigned in the constructor are not on the prototype, so the
    // source is read for the ones declared as properties.
    ...readAdapterFields(),
  ]);

  it('reads a contract of the size the freeze test pins', () => {
    // Guards the guard: a reader that returned nothing would make every claim
    // below vacuous.
    expect(contractMembers.length).toBe(26);
  });

  it('covers every member or declares why not', () => {
    const uncovered = contractMembers
      .filter(member => !adapterMembers.has(member))
      .filter(member => !(member in DECLARED_ABSENCES));

    expect(uncovered).toEqual([]);
  });

  it('declares no absence for a member it actually implements', () => {
    // An absence list that outlives its reason is how a gate turns into
    // decoration.
    const stale = Object.keys(DECLARED_ABSENCES).filter(member => adapterMembers.has(member));

    expect(stale).toEqual([]);
  });

  it('names only members the contract actually has', () => {
    const unknown = Object.keys(DECLARED_ABSENCES)
      .filter(member => !contractMembers.includes(member));

    expect(unknown).toEqual([]);
  });
});

/** Property-style members the adapter declares, read from its source. */
function readAdapterFields(): string[] {
  const source = readFileSync(resolve(process.cwd(), ADAPTER_PATH), 'utf8');
  const body = source.slice(source.indexOf('export class ExecutionChatRuntimeAdapter'));
  return [...body.matchAll(/^ {2}(?:readonly )?([a-zA-Z]+)\s*[:=(]/gm)].map(match => match[1]);
}
