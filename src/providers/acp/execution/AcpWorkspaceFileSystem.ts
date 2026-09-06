import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { JsonRpcHandlerError } from '@/providers/acp/AcpJsonRpcTransport';
import { resolveWorkspacePath } from '@/providers/acp/resolveWorkspacePath';
import type {
  AcpReadTextFileRequest,
  AcpReadTextFileResponse,
  AcpWriteTextFileRequest,
  AcpWriteTextFileResponse,
} from '@/providers/acp/types';

export interface AcpWorkspaceFileSystemContext {
  /** How the provider is named in a refusal the user reads. */
  readonly providerLabel: string;
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

/**
 * The filesystem an ACP agent reads and writes the vault through.
 *
 * Shared rather than per-provider: the containment rule, the line window and
 * the refusal are the protocol's, not any CLI's — the five legacy ACP runtimes
 * carry the same three behaviours copied five times, each with its own label.
 * What a provider supplies is that label and the two decisions: where a session
 * is rooted, and whether a write may happen.
 */
export class AcpWorkspaceFileSystem {
  constructor(private readonly context: AcpWorkspaceFileSystemContext) {}

  async readTextFile(request: AcpReadTextFileRequest): Promise<AcpReadTextFileResponse> {
    const resolved = this.resolve(request.sessionId, request.path);
    const content = await readFile(resolved, 'utf8').catch((error: unknown) => {
      // The protocol's own answer for a file that is not there, because an agent
      // asks this question *before* creating one. Gemini CLI's write tool reads
      // the file it is about to replace and stops when the read fails, so a
      // missing file that answered like a refused one took the write down with
      // it — and a refusal is what everything else here still answers with.
      if ((error as { code?: unknown } | null)?.code === 'ENOENT') {
        throw new JsonRpcHandlerError(-32002, `Resource not found: ${resolved}`);
      }
      throw error;
    });
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
    if (!approved) throw new Error(`${this.context.providerLabel} file write was not approved.`);
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
