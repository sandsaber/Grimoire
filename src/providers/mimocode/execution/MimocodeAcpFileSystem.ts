import {
  AcpWorkspaceFileSystem,
  type AcpWorkspaceFileSystemContext,
} from '@/providers/acp/execution/AcpWorkspaceFileSystem';

export type MimocodeAcpFileSystemContext = Omit<AcpWorkspaceFileSystemContext, 'providerLabel'>;

/**
 * MiMoCode's filesystem delegate: the shared one, under MiMoCode's name.
 *
 * The label is the whole difference. Containment, the line window and the
 * refusal are the protocol's, and MiMoCode's legacy runtime carries the same
 * three verbatim — its own copy is what this replaces.
 */
export class MimocodeAcpFileSystem extends AcpWorkspaceFileSystem {
  constructor(context: MimocodeAcpFileSystemContext) {
    super({ ...context, providerLabel: 'MiMoCode' });
  }
}
