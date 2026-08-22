import {
  AcpWorkspaceFileSystem,
  type AcpWorkspaceFileSystemContext,
} from '@/providers/acp/execution/AcpWorkspaceFileSystem';

export type GeminiAcpFileSystemContext = Omit<AcpWorkspaceFileSystemContext, 'providerLabel'>;

/**
 * Gemini's filesystem delegate: the shared one, under Gemini's name.
 *
 * The label is the whole difference. Containment, the line window and the
 * refusal are the protocol's, and `GeminiChatRuntime` carries the same three
 * verbatim — its own copy is what this replaces.
 */
export class GeminiAcpFileSystem extends AcpWorkspaceFileSystem {
  constructor(context: GeminiAcpFileSystemContext) {
    super({ ...context, providerLabel: 'Gemini' });
  }
}
