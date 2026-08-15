import { open } from 'node:fs/promises';

import type { ClaudeTaskResultLoader } from './ClaudeExecutionBackend';

/** Reads SDK-owned task output without copying unbounded sidecar data into memory. */
export class ClaudeTaskOutputLoader implements ClaudeTaskResultLoader {
  async load(input: {
    readonly outputFile: string;
    readonly maxBytes: number;
    readonly signal: AbortSignal;
  }): Promise<string | null> {
    if (!input.outputFile.trim() || input.outputFile.includes('\0')) {
      return null;
    }
    throwIfAborted(input.signal);
    const handle = await open(input.outputFile, 'r');
    try {
      const stat = await handle.stat();
      throwIfAborted(input.signal);
      if (!stat.isFile()) {
        return null;
      }
      const buffer = Buffer.allocUnsafe(input.maxBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      throwIfAborted(input.signal);
      if (bytesRead > input.maxBytes) {
        throw new Error('Claude task output exceeds the configured byte limit.');
      }
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  throw signal.reason instanceof Error ? signal.reason : new Error('Operation aborted.');
}
