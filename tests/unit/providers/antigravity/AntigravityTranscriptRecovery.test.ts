import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  recoverAntigravityPrintOutputFromTranscript,
  recoverAntigravityPrintTranscriptBounded,
} from '@/providers/antigravity/runtime/AntigravityTranscriptRecovery';

describe('AntigravityTranscriptRecovery', () => {
  it('recovers the last completed model result within the byte ceiling', async () => {
    const fixture = createFixture('visible result');
    try {
      await expect(recoverAntigravityPrintTranscriptBounded(
        fixture.logPath,
        {},
        64,
      )).resolves.toEqual({ output: 'visible result', outputLimitExceeded: false });
    } finally {
      fixture.cleanup();
    }
  });

  it('fails closed when recovered provider content exceeds the byte ceiling', async () => {
    const fixture = createFixture('provider result exceeds the configured limit');
    try {
      await expect(recoverAntigravityPrintTranscriptBounded(
        fixture.logPath,
        {},
        8,
      )).resolves.toEqual({ output: '', outputLimitExceeded: true });
    } finally {
      fixture.cleanup();
    }
  });

  it('detects a final JSONL record larger than the bounded read window', async () => {
    const content = 'x'.repeat(1_100_000);
    const fixture = createFixture(content, true);
    try {
      await expect(recoverAntigravityPrintTranscriptBounded(
        fixture.logPath,
        {},
        64_000,
      )).resolves.toEqual({ output: '', outputLimitExceeded: true });
      await expect(recoverAntigravityPrintOutputFromTranscript(
        fixture.logPath,
        {},
      )).resolves.toBe(content);
    } finally {
      fixture.cleanup();
    }
  });
});

function createFixture(content: string, trailingNewline = false) {
  const directory = mkdtempSync(join(tmpdir(), 'grimoire-antigravity-transcript-'));
  const conversationId = '00000000-0000-4000-8000-000000000000';
  const transcriptDirectory = join(
    directory,
    'brain',
    conversationId,
    '.system_generated',
    'logs',
  );
  mkdirSync(transcriptDirectory, { recursive: true });
  const logPath = join(directory, 'print.log');
  writeFileSync(logPath, [
    `Created conversation ${conversationId}`,
    `CLI app data directory: ${directory}`,
  ].join('\n'), 'utf8');
  const transcript = [
    JSON.stringify({ source: 'MODEL', status: 'DONE', content: 'older result' }),
    JSON.stringify({ source: 'MODEL', status: 'DONE', content }),
  ].join('\n');
  writeFileSync(
    join(transcriptDirectory, 'transcript.jsonl'),
    trailingNewline ? `${transcript}\n` : transcript,
    'utf8',
  );
  return {
    logPath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
