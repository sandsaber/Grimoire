import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { resolveWorkspacePath } from '@/providers/acp/resolveWorkspacePath';
import type {
  AcpReadTextFileRequest,
  AcpReadTextFileResponse,
  AcpWriteTextFileRequest,
  AcpWriteTextFileResponse,
} from '@/providers/acp/types';

export interface GeminiAcpFileSystemContext {
  resolveSession(sessionId: string): {
    readonly cwd: string;
    readonly allowOutsideWorkspace: boolean;
  };
  approveWrite(input: {
    readonly sessionId: string;
    readonly requestPath: string;
    readonly resolvedPath: string;
  }): Promise<boolean>;
}

/** Provider-owned filesystem delegate with explicit workspace containment. */
export class GeminiAcpFileSystem {
  constructor(private readonly context: GeminiAcpFileSystemContext) {}

  async readTextFile(request: AcpReadTextFileRequest): Promise<AcpReadTextFileResponse> {
    const resolved = this.resolve(request.sessionId, request.path);
    const content = await readFile(resolved, 'utf8');
    if (request.line === undefined && request.limit === undefined) return { content };
    const lines = content.split(/\r?\n/);
    const start = Math.max(0, (request.line ?? 1) - 1);
    const end = request.limit === undefined || request.limit === null
      ? lines.length
      : start + Math.max(0, request.limit);
    return { content: lines.slice(start, end).join('\n') };
  }

  async writeTextFile(request: AcpWriteTextFileRequest): Promise<AcpWriteTextFileResponse> {
    const resolvedPath = this.resolve(request.sessionId, request.path);
    const approved = await this.context.approveWrite({
      sessionId: request.sessionId,
      requestPath: request.path,
      resolvedPath,
    });
    if (!approved) throw new Error('Gemini CLI file write was not approved.');
    await mkdir(dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, request.content, 'utf8');
    return {};
  }

  private resolve(sessionId: string, requestPath: string): string {
    const session = this.context.resolveSession(sessionId);
    return resolveWorkspacePath(session.cwd, requestPath, {
      allowOutsideWorkspace: session.allowOutsideWorkspace,
    });
  }
}
