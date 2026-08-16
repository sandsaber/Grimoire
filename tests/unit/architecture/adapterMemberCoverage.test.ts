import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readInterfaceMembers } from '@test/helpers/interfaceMembers';

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
  // Row 13: no production call site. Re-establishing a session is what
  // `cleanup` followed by `ensureReady` already does.
  resetSession: 'no production call site; disposal and re-establishment cover it',
  // Row 8: no production call site, and optional in the contract.
  reloadWorkspaceResources: 'optional, and no production call site declares it',
  // Row 18: model routing is a workspace port, and the adapter has no
  // auxiliary execution of its own until M5.
  getAuxiliaryModel: 'auxiliary model routing belongs to the workspace port at M5',
  // Rows 31 and 32: optional, no production call site, and no provider
  // declares the capability. Present-but-empty is the shape the contract bans.
  loadSubagentToolCalls: 'optional; no provider declares subagent tool loading',
  loadSubagentFinalResult: 'optional; no provider declares subagent result loading',
};

describe('adapter member coverage', () => {
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
    expect(contractMembers.length).toBe(32);
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
