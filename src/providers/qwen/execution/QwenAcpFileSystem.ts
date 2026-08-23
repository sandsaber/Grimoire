import {
  AcpWorkspaceFileSystem,
  type AcpWorkspaceFileSystemContext,
} from '@/providers/acp/execution/AcpWorkspaceFileSystem';

export type QwenAcpFileSystemContext = Omit<AcpWorkspaceFileSystemContext, 'providerLabel'>;

/**
 * Qwen's filesystem delegate: the shared one, under Qwen's name.
 *
 * The label is the whole difference. Containment, the line window and the
 * refusal are the protocol's, and `QwenChatRuntime` carries the same three
 * verbatim — its own copy is what this replaces.
 */
export class QwenAcpFileSystem extends AcpWorkspaceFileSystem {
  constructor(context: QwenAcpFileSystemContext) {
    super({ ...context, providerLabel: 'Qwen' });
  }
}
