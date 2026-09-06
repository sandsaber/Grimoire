import {
  AcpWorkspaceFileSystem,
  type AcpWorkspaceFileSystemContext,
} from '@/providers/acp/execution/AcpWorkspaceFileSystem';

export type OpencodeAcpFileSystemContext = Omit<AcpWorkspaceFileSystemContext, 'providerLabel'>;

/**
 * OpenCode's filesystem delegate: the shared one, under OpenCode's name.
 *
 * The label is the whole difference. Containment, the line window and the
 * refusal are the protocol's, and wave 5 found them identical in every ACP
 * runtime that has them.
 */
export class OpencodeAcpFileSystem extends AcpWorkspaceFileSystem {
  constructor(context: OpencodeAcpFileSystemContext) {
    super({ ...context, providerLabel: 'OpenCode' });
  }
}
