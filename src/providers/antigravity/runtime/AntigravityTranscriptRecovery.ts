import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOG_READ_LIMIT_BYTES = 256 * 1024;
const TRANSCRIPT_OVERHEAD_BYTES = 64 * 1024;
const TRANSCRIPT_READ_LIMIT_BYTES = 1024 * 1024;

export interface AntigravityTranscriptRecoveryResult {
  readonly output: string;
  readonly outputLimitExceeded: boolean;
}

export function createAntigravityPrintLogPath(): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return path.join(os.tmpdir(), `grimoire-antigravity-print-${suffix}.log`);
}
export async function recoverAntigravityPrintTranscriptBounded(
  logFilePath: string,
  runtimeEnv: NodeJS.ProcessEnv,
  outputByteLimit: number,
): Promise<AntigravityTranscriptRecoveryResult> {
  const logText = await readFileEdges(logFilePath, LOG_READ_LIMIT_BYTES);
  if (!logText) {
    return emptyRecovery();
  }

  const transcriptPaths = resolveTranscriptLocations(logText, runtimeEnv);
  if (!transcriptPaths) {
    return emptyRecovery();
  }
  for (const transcriptPath of transcriptPaths) {
    const readLimit = Math.min(
      TRANSCRIPT_READ_LIMIT_BYTES,
      Math.max(TRANSCRIPT_OVERHEAD_BYTES, outputByteLimit + TRANSCRIPT_OVERHEAD_BYTES),
    );
    const transcript = await readFileTail(transcriptPath, readLimit);
    const content = extractLastAntigravityModelContent(transcript.text, transcript.truncated);
    if (content.output || content.outputLimitExceeded) {
      if (Buffer.byteLength(content.output, 'utf8') > outputByteLimit) {
        return { output: '', outputLimitExceeded: true };
      }
      return content;
    }
  }
  return emptyRecovery();
}

function extractAntigravityConversationId(logText: string): string | null {
  const match = logText.match(/\b(?:conversation=|Created conversation )([0-9a-f-]{36})\b/i);
  return match?.[1] ?? null;
}

function extractAntigravityAppDataDir(logText: string): string | null {
  const match = logText.match(/CLI app data directory:\s*(.+)$/mi);
  return match?.[1]?.trim() || null;
}

function getDefaultAntigravityAppDataDir(runtimeEnv: NodeJS.ProcessEnv): string | null {
  const home = runtimeEnv.USERPROFILE
    ?? (runtimeEnv.HOMEDRIVE && runtimeEnv.HOMEPATH
      ? `${runtimeEnv.HOMEDRIVE}${runtimeEnv.HOMEPATH}`
      : undefined)
    ?? runtimeEnv.HOME;
  return home ? path.join(home, '.gemini', 'antigravity-cli') : null;
}

function resolveTranscriptLocations(
  logText: string,
  runtimeEnv: NodeJS.ProcessEnv,
): readonly string[] | null {
  if (!logText) {
    return null;
  }
  const conversationId = extractAntigravityConversationId(logText);
  if (!conversationId) {
    return null;
  }
  const appDataDir = extractAntigravityAppDataDir(logText)
    ?? getDefaultAntigravityAppDataDir(runtimeEnv);
  if (!appDataDir) {
    return null;
  }
  return [
    path.join(appDataDir, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl'),
    path.join(appDataDir, 'brain', conversationId, '.system_generated', 'logs', 'transcript_full.jsonl'),
  ];
}

function extractLastAntigravityModelContent(
  transcriptText: string,
  truncated: boolean,
): AntigravityTranscriptRecoveryResult {
  let lastContent = '';
  const lines = transcriptText.split(/\r?\n/);
  if (truncated) {
    lines.shift();
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      if (record.source === 'MODEL'
        && record.status === 'DONE'
        && typeof record.content === 'string'
        && record.content.trim()) {
        lastContent = record.content;
      }
    } catch {
      // Partial provider transcripts can end with a malformed line.
    }
  }
  if (!lastContent && truncated) {
    return { output: '', outputLimitExceeded: true };
  }
  return { output: lastContent, outputLimitExceeded: false };
}

async function readFileEdges(filePath: string, maxBytes: number): Promise<string> {
  const handle = await fs.open(filePath, 'r').catch(() => null);
  if (!handle) {
    return '';
  }
  try {
    const { size } = await handle.stat();
    if (size <= maxBytes) {
      return await readRange(handle, 0, size);
    }
    const headBytes = Math.floor(maxBytes / 2);
    const tailBytes = maxBytes - headBytes;
    const [head, tail] = await Promise.all([
      readRange(handle, 0, headBytes),
      readRange(handle, size - tailBytes, tailBytes),
    ]);
    return `${head}\n${tail}`;
  } finally {
    await handle.close();
  }
}

async function readFileTail(
  filePath: string,
  maxBytes: number,
): Promise<{ readonly text: string; readonly truncated: boolean }> {
  const handle = await fs.open(filePath, 'r').catch(() => null);
  if (!handle) {
    return { text: '', truncated: false };
  }
  try {
    const { size } = await handle.stat();
    const bytes = Math.min(size, maxBytes);
    return {
      text: await readRange(handle, size - bytes, bytes),
      truncated: size > bytes,
    };
  } finally {
    await handle.close();
  }
}

async function readRange(
  handle: Awaited<ReturnType<typeof fs.open>>,
  position: number,
  length: number,
): Promise<string> {
  if (length <= 0) {
    return '';
  }
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead).toString('utf8');
}

function emptyRecovery(): AntigravityTranscriptRecoveryResult {
  return { output: '', outputLimitExceeded: false };
}
