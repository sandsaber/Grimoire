import {
  AcpWorkspaceFileSystem,
  type AcpWorkspaceFileSystemContext,
} from '@/providers/acp/execution/AcpWorkspaceFileSystem';

export type KimicodeAcpFileSystemContext = Omit<AcpWorkspaceFileSystemContext, 'providerLabel'>;

/**
 * Kimi Code's filesystem delegate: the shared one, under Kimi Code's name.
 *
 * The label is the whole difference. Containment, the line window and the
 * refusal are the protocol's, and Kimi Code's legacy runtime carries the same
 * three verbatim — its own copy is what this replaces.
 */
export class KimicodeAcpFileSystem extends AcpWorkspaceFileSystem {
  constructor(context: KimicodeAcpFileSystemContext) {
    super({ ...context, providerLabel: 'Kimi Code' });
  }
}
