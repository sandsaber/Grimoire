import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readInterfaceMembers } from '@test/helpers/interfaceMembers';

/**
 * Freezes the `ChatRuntime` contract and keeps its specification honest.
 *
 * Two rules from the plan are enforced here. The old runtime path is frozen
 * for new product features from the M0a checkpoint, so a new member is a
 * deliberate act that has to be recorded. And the adapter specification must
 * cover every member with no "decide later" rows — a mapping discovered during
 * M2 instead of now is the v1 failure mode repeating at the seam.
 */

const CONTRACT_PATH = 'src/core/runtime/ChatRuntime.ts';
const SPECIFICATION_PATH = 'docs/provider-execution-adapter-contract.md';

const FROZEN_MEMBERS = [
  'providerId',
  'getCapabilities',
  'prepareTurn',
  'onReadyStateChange',
  'setResumeCheckpoint',
  'syncConversationState',
  'reloadMcpServers',
  'reloadWorkspaceResources',
  'ensureReady',
  'query',
  'steer',
  'cancel',
  'resetSession',
  'getSessionId',
  'consumeSessionInvalidation',
  'isReady',
  'getSupportedCommands',
  'getAuxiliaryModel',
  'cleanup',
  'rewind',
  // The six interaction setters were frozen here and are **deleted**, which the
  // freeze permits and a new member does not: the plan's seam deletion names
  // "runtime approval/question/plan/subagent callbacks" among what goes. They
  // were stored by the adapter and acted on by nothing, which is what made them
  // a seam rather than a capability, and they are one `installInteractions` on
  // the adapter now — off this contract entirely.
  //
  // `setAutoTurnCallback` stayed: the kernel starts turns of its own, and the
  // surface has to be told about a turn nothing in it asked for.
  'setAutoTurnCallback',
  'consumeTurnMetadata',
  'buildSessionUpdates',
  'resolveSessionIdForFork',
  'loadSubagentToolCalls',
  'loadSubagentFinalResult',
];

describe('ChatRuntime contract freeze', () => {
  const declared = readInterfaceMembers(CONTRACT_PATH, 'ChatRuntime');
  const specification = readFileSync(resolve(process.cwd(), SPECIFICATION_PATH), 'utf8');

  it('declares exactly the frozen member set', () => {
    // A failure here means the seam widened. Adding a member is a stop
    // condition against the migration plan, not a routine change: map it in
    // the adapter specification first, or land the capability on the new
    // platform instead.
    expect([...declared].sort()).toEqual([...FROZEN_MEMBERS].sort());
  });

  it('declares 26 members', () => {
    // **32 until the seam deletion took six.** The count is asserted separately
    // from the set so a deletion has to be stated twice rather than sliding
    // through as a list edit — the freeze forbids growth, and a shrink is a
    // milestone step that should be visible in the diff.
    expect(declared).toHaveLength(26);
  });

  it('maps every member in the adapter specification', () => {
    const unmapped = declared.filter(member => !specification.includes(`\`${member}`));

    expect(unmapped).toEqual([]);
  });

  it('leaves no mapping undecided', () => {
    // "unknown" is deliberately not a marker: an honest `indeterminate`
    // outcome is described as unknown, which is a decided verdict.
    const markers = ['decide later', 'tbd', 'todo', 'to be determined'];
    // Only table rows carry verdicts. Prose is allowed to name the markers —
    // the specification says of itself that it has no "decide later" rows.
    const undecided = specification
      .split('\n')
      .filter(line => line.startsWith('|'))
      .filter(line => markers.some(marker => line.toLowerCase().includes(marker)));

    expect(undecided).toEqual([]);
  });
});
