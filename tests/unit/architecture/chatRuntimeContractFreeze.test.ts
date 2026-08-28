import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { listAllSourceModules } from '@test/helpers/moduleReachability';

import type {
  ExecutionChatRuntimeAdapter,
  ExecutionInteractionCallbacks,
} from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';

/**
 * The `ChatRuntime` contract is **deleted**, and this keeps it deleted.
 *
 * It began as a freeze: the old runtime path took no new members from the M0a
 * checkpoint, and every member had to be mapped in the adapter specification
 * before M2 could touch it. Thirty-two members went in, and the plan's seam
 * deletion names what comes out — *"when the last UI consumer of `ChatRuntime`
 * is gone: delete the interface"*.
 *
 * That happened. The six interaction setters became one installation on the
 * adapter; the two subagent loaders were implemented by nothing and took a
 * retry ladder with them; the turn-metadata member's three facts are on
 * `CompletedChatTurn`, which the surface already read; and the tab, the three
 * controllers and both tab contexts type their runtime as the adapter every
 * composition builds. No module in `src/` imports the interface, so the file is
 * gone.
 *
 * What this file asserts now is the shape of that deletion rather than the
 * shape of the contract: nothing in production names it, and the specification
 * that mapped it survives as the record of what each member became. A source
 * module reintroducing it is a re-entry to the old path, which is what the
 * freeze existed to stop and what this still stops.
 */

const CONTRACT_PATH = 'src/core/runtime/ChatRuntime.ts';
const SPECIFICATION_PATH = 'docs/provider-execution-adapter-contract.md';
const SOURCE_ROOT = resolve(process.cwd(), 'src');

/**
 * The interaction installation, which replaced six contract setters.
 *
 * Asserted here because `adapterMemberCoverage.test.ts` is deleted with the
 * contract it compared against: with the host typed as the adapter rather than
 * as an interface the adapter structurally satisfied, **the compiler is the
 * coverage gate** — removing a member or a parameter the tab, the controllers
 * or the compositions use is now a `npm run typecheck` failure rather than
 * something a name comparison had to notice. What that file could not notice is
 * on record in the entry that deleted it: a method with fewer parameters is
 * assignable to one with more, and two members had quietly dropped one.
 */
type AdapterInstallsInteractions =
  ExecutionChatRuntimeAdapter['installInteractions'] extends
    (callbacks: ExecutionInteractionCallbacks) => void ? true : false;

const ADAPTER_INSTALLS_INTERACTIONS: AdapterInstallsInteractions = true;

describe('ChatRuntime contract deletion', () => {
  it('installs its interactions off the deleted contract', () => {
    expect(ADAPTER_INSTALLS_INTERACTIONS).toBe(true);
  });

  it('has no contract file left', () => {
    expect(existsSync(resolve(process.cwd(), CONTRACT_PATH))).toBe(false);
  });

  it('is imported or redeclared by no module in production source', () => {
    // **Imports and declarations, not the word.** Six modules name the deleted
    // interface in prose, and that prose is the record of what replaced it — a
    // gate that forbade describing a deletion would be a gate against
    // explaining the codebase. What this catches is re-entry: something
    // importing the contract back, or declaring its own under the same name.
    const reentry = listAllSourceModules({ sourceRoot: SOURCE_ROOT, baseDir: SOURCE_ROOT })
      .filter((module) => {
        const source = readFileSync(resolve(SOURCE_ROOT, module), 'utf8');
        return /^import[^\n]*(?<![A-Za-z])ChatRuntime(?![A-Za-z])/m.test(source)
          || /^export (interface|type) ChatRuntime(?![A-Za-z])/m.test(source);
      });

    expect(reentry).toEqual([]);
  });

  it('keeps the specification that mapped every member', () => {
    // Retained deliberately. It is the only place that says what each of the
    // thirty-two became, and a deletion whose record is deleted with it is a
    // deletion nobody can check afterwards.
    const specification = readFileSync(resolve(process.cwd(), SPECIFICATION_PATH), 'utf8');

    expect(specification).toContain('`prepareTurn');
    expect(specification).toContain('`query');
  });

  it('leaves no mapping undecided', () => {
    // "unknown" is deliberately not a marker: an honest `indeterminate`
    // outcome is described as unknown, which is a decided verdict.
    const specification = readFileSync(resolve(process.cwd(), SPECIFICATION_PATH), 'utf8');
    const markers = ['decide later', 'tbd', 'todo', 'to be determined'];
    const undecided = specification
      .split('\n')
      .filter(line => line.startsWith('|'))
      .filter(line => markers.some(marker => line.toLowerCase().includes(marker)));

    expect(undecided).toEqual([]);
  });
});
