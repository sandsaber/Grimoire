import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CodexExecutionTurnReconciler,
  CodexJsonlExecutionTranscriptReader,
  parseCodexExecutionTurn,
} from '@/providers/codex/execution/CodexExecutionTurnReconciler';
import type { Thread, Turn } from '@/providers/codex/runtime/codexAppServerTypes';
import type { CodexExecutionConnection } from '@/providers/codex/runtime/CodexExecutionConnection';

const TRACE = readFileSync(
  join(process.cwd(), 'tests/fixtures/provider-traces/codex-execution.jsonl'),
  'utf8',
);

describe('CodexExecutionTurnReconciler', () => {
  it('prefers authoritative app-server turn state', async () => {
    const connection = connectionReturning(thread('active', [turn('turn-live', 'completed')]));
    const transcript = { readTurn: jest.fn() };
    const reconciler = new CodexExecutionTurnReconciler(connection, transcript);

    await expect(reconciler.reconcile({
      threadId: 'thread-1',
      turnId: 'turn-live',
    })).resolves.toEqual({ kind: 'turn', turn: turn('turn-live', 'completed') });
    expect(transcript.readTurn).not.toHaveBeenCalled();
  });

  it('reports an active thread without polling JSONL', async () => {
    const connection = connectionReturning(thread('active'));
    const transcript = { readTurn: jest.fn() };
    const reconciler = new CodexExecutionTurnReconciler(connection, transcript);

    await expect(reconciler.reconcile({
      threadId: 'thread-1',
      turnId: 'turn-live',
    })).resolves.toEqual({ kind: 'running' });
    expect(transcript.readTurn).not.toHaveBeenCalled();
  });

  it('falls back to bounded JSONL evidence after idle or daemon loss', async () => {
    const replay = parseCodexExecutionTurn(TRACE, 'turn-replay');
    const transcript = { readTurn: jest.fn().mockResolvedValue(replay) };
    const reconciler = new CodexExecutionTurnReconciler(
      connectionReturning(thread('idle'), true),
      transcript,
    );

    await expect(reconciler.reconcile({
      threadId: 'thread-replay',
      turnId: 'turn-replay',
    })).resolves.toEqual({ kind: 'turn', turn: replay });
    expect(transcript.readTurn).toHaveBeenCalledWith('thread-replay', 'turn-replay');
  });

  it('finds the provider session file and rejects an oversized replay', async () => {
    const sessionsRoot = mkdtempSync(join(tmpdir(), 'grimoire-codex-reconcile-'));
    const threadId = 'thread-replay';
    writeFileSync(join(sessionsRoot, `${threadId}.jsonl`), TRACE, 'utf8');
    try {
      await expect(new CodexJsonlExecutionTranscriptReader(sessionsRoot).readTurn(
        threadId,
        'turn-replay',
      )).resolves.toMatchObject({ id: 'turn-replay', status: 'completed' });
      await expect(new CodexJsonlExecutionTranscriptReader(sessionsRoot, 32).readTurn(
        threadId,
        'turn-replay',
      )).resolves.toBeNull();
    } finally {
      rmSync(sessionsRoot, { recursive: true, force: true });
    }
  });
});

describe('parseCodexExecutionTurn', () => {
  it('recovers only the selected turn, final output, and collaboration lifecycle evidence', () => {
    const replay = parseCodexExecutionTurn(TRACE, 'turn-replay');

    expect(replay).toMatchObject({
      id: 'turn-replay',
      status: 'completed',
      items: [
        { type: 'collabAgentToolCall', tool: 'spawnAgent', result: { agent_id: 'native-agent-replay' } },
        { type: 'collabAgentToolCall', tool: 'sendInput' },
        { type: 'collabAgentToolCall', tool: 'wait' },
        { type: 'collabAgentToolCall', tool: 'closeAgent' },
        { type: 'agentMessage', text: 'Recovered parent result' },
      ],
    });
    expect(parseCodexExecutionTurn(TRACE, 'turn-absent')).toBeNull();
  });

  it('drops collaboration prompt and input content from recovered evidence', () => {
    const sensitiveMarker = 'DO_NOT_PERSIST_COLLABORATION_INPUT';
    const content = [
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'turn-redaction' },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'spawn_agent',
          arguments: JSON.stringify({
            message: sensitiveMarker,
            parent_agent_id: 'root-agent',
          }),
          call_id: 'spawn-redaction',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'spawn-redaction',
          output: JSON.stringify({ agent_id: 'native-agent-redaction' }),
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'task_complete', turn_id: 'turn-redaction' },
      }),
    ].join('\n');

    const replay = parseCodexExecutionTurn(content, 'turn-redaction');
    expect(replay).toMatchObject({
      items: [{
        type: 'collabAgentToolCall',
        tool: 'spawnAgent',
        arguments: { parent_agent_id: 'root-agent' },
      }],
    });
    expect(JSON.stringify(replay)).not.toContain(sensitiveMarker);
  });

  it.each([
    ['task_complete', 'completed'],
    ['turn_aborted', 'interrupted'],
    ['turn_failed', 'failed'],
  ] as const)('maps %s to %s terminal evidence', (eventType, expectedStatus) => {
    const content = [
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'turn-terminal' },
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: eventType, turn_id: 'turn-terminal' },
      }),
    ].join('\n');

    expect(parseCodexExecutionTurn(content, 'turn-terminal')).toMatchObject({
      status: expectedStatus,
    });
  });
});

function connectionReturning(nativeThread: Thread, reject = false): CodexExecutionConnection {
  return {
    initializeResult: null,
    initialize: jest.fn(),
    request: reject
      ? jest.fn().mockRejectedValue(new Error('daemon unavailable'))
      : jest.fn().mockResolvedValue({ thread: nativeThread }),
    notify: jest.fn(),
    onNotification: jest.fn(() => () => undefined),
    onServerRequest: jest.fn(() => () => undefined),
    onConnectionLost: jest.fn(() => () => undefined),
    dispose: jest.fn(),
  };
}

function thread(status: Thread['status']['type'], turns: Turn[] = []): Thread {
  return {
    id: 'thread-1',
    preview: '',
    ephemeral: false,
    path: '',
    cwd: '/vault',
    cliVersion: 'test',
    status: { type: status },
    turns,
    createdAt: 1,
    updatedAt: 1,
    name: null,
    modelProvider: 'openai',
    source: 'app-server',
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
  };
}

function turn(id: string, status: Turn['status']): Turn {
  return { id, status, items: [], error: null };
}
