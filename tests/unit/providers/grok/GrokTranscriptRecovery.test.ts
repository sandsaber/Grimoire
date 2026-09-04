import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  extractGrokFinalAssistantMessage,
  GrokNativeTranscriptRecovery,
} from '@/providers/grok/history/GrokTranscriptRecovery';
import { encodeGrokWorkspaceKey } from '@/providers/grok/runtime/GrokPaths';

function historyLine(row: Record<string, unknown>): string {
  return `${JSON.stringify(row)}\n`;
}

async function withGrokSession(
  sessionId: string,
  history: string,
  run: (workspacePath: string) => Promise<void>,
): Promise<void> {
  const workspacePath = await mkdtemp(join(tmpdir(), 'grimoire-grok-transcript-'));
  const sessionDir = join(
    workspacePath,
    '.grimoire',
    'grok',
    'sessions',
    encodeGrokWorkspaceKey(workspacePath),
    sessionId,
  );
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, 'chat_history.jsonl'), history, 'utf8');
  try {
    await run(workspacePath);
  } finally {
    await rm(workspacePath, { force: true, recursive: true });
  }
}

describe('extractGrokFinalAssistantMessage', () => {
  it('returns the last assistant message written after the last prompt', () => {
    const history = [
      historyLine({ type: 'user', content: [{ type: 'text', text: 'first' }] }),
      historyLine({ type: 'assistant', content: 'stale answer' }),
      historyLine({ type: 'user', content: [{ type: 'text', text: 'second' }] }),
      historyLine({ type: 'assistant', content: 'working on it', tool_calls: [] }),
      historyLine({ type: 'tool_result', content: 'ok', tool_call_id: 'call-1' }),
      historyLine({ type: 'assistant', content: 'final answer' }),
    ].join('');

    expect(extractGrokFinalAssistantMessage(history)).toBe('final answer');
  });

  it('ignores answers recorded before the last prompt', () => {
    const history = [
      historyLine({ type: 'assistant', content: 'previous turn' }),
      historyLine({ type: 'user', content: [{ type: 'text', text: 'new question' }] }),
    ].join('');

    expect(extractGrokFinalAssistantMessage(history)).toBe('');
  });

  it('skips partial and unparsable rows', () => {
    const history = [
      historyLine({ type: 'user', content: [{ type: 'text', text: 'q' }] }),
      historyLine({ type: 'assistant', content: 'answer' }),
      '{"type":"assistant","content":"truncat',
    ].join('');

    expect(extractGrokFinalAssistantMessage(history)).toBe('answer');
  });

  it('drops the first line when the tail read was truncated', () => {
    const history = [
      historyLine({ type: 'assistant', content: 'partial row from a cut boundary' }),
      historyLine({ type: 'user', content: [{ type: 'text', text: 'q' }] }),
      historyLine({ type: 'assistant', content: 'answer' }),
    ].join('');

    expect(extractGrokFinalAssistantMessage(history, true)).toBe('answer');
  });
});

describe('GrokNativeTranscriptRecovery', () => {
  const recovery = new GrokNativeTranscriptRecovery();

  it('recovers the answer Grok stored for the running session', async () => {
    const history = [
      historyLine({ type: 'user', content: [{ type: 'text', text: 'question' }] }),
      historyLine({ type: 'assistant', content: 'the answer from Grok history' }),
    ].join('');

    await withGrokSession('session-1', history, async (workspacePath) => {
      await expect(recovery.recoverFinalAssistantMessage({
        nativeSessionRef: 'session-1',
        workspacePath,
        maxBytes: 64_000,
      })).resolves.toBe('the answer from Grok history');
    });
  });

  it('returns nothing when the recovered answer exceeds the result limit', async () => {
    const history = [
      historyLine({ type: 'user', content: [{ type: 'text', text: 'q' }] }),
      historyLine({ type: 'assistant', content: 'x'.repeat(200) }),
    ].join('');

    await withGrokSession('session-2', history, async (workspacePath) => {
      await expect(recovery.recoverFinalAssistantMessage({
        nativeSessionRef: 'session-2',
        workspacePath,
        maxBytes: 100,
      })).resolves.toBe('');
    });
  });

  it('returns nothing when the session has no native history', async () => {
    await expect(recovery.recoverFinalAssistantMessage({
      nativeSessionRef: 'missing-session',
      workspacePath: join(tmpdir(), 'grimoire-grok-transcript-absent'),
      maxBytes: 64_000,
    })).resolves.toBe('');
  });
});
