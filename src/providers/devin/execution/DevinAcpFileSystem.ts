import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';

import {
  AcpWorkspaceFileSystem,
  type AcpWorkspaceFileSystemContext,
} from '@/providers/acp/execution/AcpWorkspaceFileSystem';
import type {
  AcpReadTextFileRequest,
  AcpReadTextFileResponse,
  AcpWriteTextFileRequest,
  AcpWriteTextFileResponse,
} from '@/providers/acp/types';

export type DevinAcpFileSystemContext = Omit<AcpWorkspaceFileSystemContext, 'providerLabel'> & {
  /** Where Devin keeps its plans; overridable so a test does not write to a home directory. */
  readonly plansDirectory?: string;
};

/**
 * Devin's filesystem delegate: the shared one, with one door of its own.
 *
 * In Plan mode Devin writes the plan it is asked to approve to
 * `~/.devin/plans/<id>.md` — through `fs/write_text_file`, and outside the
 * vault (observed 2026-09-09). Contained, that write is refused, and the agent
 * has no plan to exit into. The plans directory is Devin's own state, not the
 * vault's, so it is read and written directly, without containment and without
 * the approval a vault write gets. Everything else is the shared delegate.
 */
export class DevinAcpFileSystem extends AcpWorkspaceFileSystem {
  private readonly plansDirectory: string;

  constructor(context: DevinAcpFileSystemContext) {
    super({ ...context, providerLabel: 'Devin' });
    this.plansDirectory = resolve(context.plansDirectory ?? resolve(homedir(), '.devin', 'plans'));
  }

  override async readTextFile(request: AcpReadTextFileRequest): Promise<AcpReadTextFileResponse> {
    const plan = this.planPath(request.path);
    if (plan) {
      return { content: await readFile(plan, 'utf8') };
    }
    return super.readTextFile(request);
  }

  override async writeTextFile(request: AcpWriteTextFileRequest): Promise<AcpWriteTextFileResponse> {
    const plan = this.planPath(request.path);
    if (plan) {
      await mkdir(dirname(plan), { recursive: true });
      await writeFile(plan, request.content, 'utf8');
      return {};
    }
    return super.writeTextFile(request);
  }

  /** The path, when it is a file inside Devin's own plans directory. */
  private planPath(requestPath: string): string | null {
    const resolved = resolve(requestPath);
    return resolved.startsWith(this.plansDirectory + sep) ? resolved : null;
  }
}
