import { type Dirent, existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { ClaudeConfigDirContext } from '../config/ClaudeConfigDir';
import { resolveClaudeConfigDir } from '../config/ClaudeConfigDir';
import type { SDKNativeMessage, SDKSessionReadResult } from './sdkHistoryTypes';

export type SDKSessionAvailability = 'available' | 'relocated' | 'missing' | 'unknown';

export interface SDKSessionLocation {
  availability: SDKSessionAvailability;
  sessionPath?: string;
}

/**
 * Encodes a vault path for the SDK project directory name.
 * The SDK replaces ALL non-alphanumeric characters with `-`.
 * This handles Unicode characters and special chars.
 */
export function encodeVaultPathForSDK(vaultPath: string): string {
  const absolutePath = path.resolve(vaultPath);
  return absolutePath.replace(/[^a-zA-Z0-9]/g, '-');
}

export function getSDKProjectsPath(context?: ClaudeConfigDirContext): string {
  return path.join(resolveClaudeConfigDir(context), 'projects');
}

/** Validates an identifier for safe use in filesystem paths (no traversal, bounded length). */
export function isPathSafeId(value: string): boolean {
  if (!value || value.length === 0 || value.length > 128) {
    return false;
  }
  if (value.includes('..') || value.includes('/') || value.includes('\\')) {
    return false;
  }
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

export function isValidSessionId(sessionId: string): boolean {
  return isPathSafeId(sessionId);
}

export function getSDKSessionPath(
  vaultPath: string,
  sessionId: string,
  context?: ClaudeConfigDirContext,
): string {
  if (!isValidSessionId(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }

  const projectsPath = getSDKProjectsPath(context);
  const encodedVault = encodeVaultPathForSDK(vaultPath);
  return path.join(projectsPath, encodedVault, `${sessionId}.jsonl`);
}

function hasFileSystemErrorCode(error: unknown, code: string): boolean {
  return !!error
    && typeof error === 'object'
    && 'code' in error
    && error.code === code;
}

export async function locateSDKSessions(
  vaultPath: string,
  sessionIds: string[],
  context?: ClaudeConfigDirContext,
): Promise<Map<string, SDKSessionLocation>> {
  const locations = new Map<string, SDKSessionLocation>();
  const unresolvedIds = new Set<string>();

  await Promise.all([...new Set(sessionIds)].map(async (sessionId) => {
    let sessionPath: string;
    try {
      sessionPath = getSDKSessionPath(vaultPath, sessionId, context);
    } catch {
      locations.set(sessionId, { availability: 'unknown' });
      return;
    }

    try {
      await fs.access(sessionPath);
      locations.set(sessionId, { availability: 'available', sessionPath });
    } catch (error) {
      if (hasFileSystemErrorCode(error, 'ENOENT')) {
        unresolvedIds.add(sessionId);
      } else {
        locations.set(sessionId, { availability: 'unknown' });
      }
    }
  }));

  if (unresolvedIds.size === 0) {
    return locations;
  }

  const targetIdsByFilename = new Map(
    [...unresolvedIds].map(sessionId => [`${sessionId}.jsonl`, sessionId]),
  );
  const projectsPath = getSDKProjectsPath(context);
  const pendingDirectories = [projectsPath];
  let rootExists = true;
  let scanComplete = true;
  let visitedDirectoryCount = 0;

  while (pendingDirectories.length > 0 && unresolvedIds.size > 0) {
    const directory = pendingDirectories.shift()!;
    visitedDirectoryCount += 1;
    if (visitedDirectoryCount > 4096) {
      scanComplete = false;
      break;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (directory === projectsPath && hasFileSystemErrorCode(error, 'ENOENT')) {
        rootExists = false;
      } else if (!hasFileSystemErrorCode(error, 'ENOENT')) {
        scanComplete = false;
      }
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isFile()) {
        const sessionId = targetIdsByFilename.get(entry.name);
        if (sessionId && unresolvedIds.has(sessionId)) {
          locations.set(sessionId, { availability: 'relocated', sessionPath: entryPath });
          unresolvedIds.delete(sessionId);
        }
      } else if (entry.isDirectory() && entry.name !== 'subagents') {
        pendingDirectories.push(entryPath);
      } else if (!entry.isDirectory()) {
        // Never follow symlinks or special files while resolving history.
        scanComplete = false;
      }
    }
  }

  for (const sessionId of unresolvedIds) {
    locations.set(sessionId, {
      availability: rootExists && scanComplete ? 'missing' : 'unknown',
    });
  }

  return locations;
}

export async function deleteSDKSession(
  vaultPath: string,
  sessionId: string,
  context?: ClaudeConfigDirContext,
): Promise<void> {
  try {
    const sessionPath = getSDKSessionPath(vaultPath, sessionId, context);
    if (!existsSync(sessionPath)) {
      return;
    }

    await fs.unlink(sessionPath);
  } catch {
    // Best-effort deletion
  }
}

export async function readSDKSession(
  vaultPath: string,
  sessionId: string,
  context?: ClaudeConfigDirContext,
): Promise<SDKSessionReadResult> {
  try {
    const sessionPath = getSDKSessionPath(vaultPath, sessionId, context);
    if (!existsSync(sessionPath)) {
      return { messages: [], skippedLines: 0 };
    }

    return readSDKSessionFile(sessionPath);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { messages: [], skippedLines: 0, error: errorMsg };
  }
}

export async function readSDKSessionFile(sessionPath: string): Promise<SDKSessionReadResult> {
  try {
    const content = await fs.readFile(sessionPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    const messages: SDKNativeMessage[] = [];
    let skippedLines = 0;

    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as SDKNativeMessage;
        messages.push(msg);
      } catch {
        skippedLines++;
      }
    }

    return { messages, skippedLines };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { messages: [], skippedLines: 0, error: errorMsg };
  }
}
