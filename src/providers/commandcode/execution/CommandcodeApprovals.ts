import { randomUUID } from 'node:crypto';

import type { InteractionPort, InteractionRequest, InteractionResolution } from '@/core/execution/ExecutionContracts';
import type { ProviderExecutionEvent } from '@/core/execution/ExecutionEvents';
import { type InteractionId, interactionId, type RunId } from '@/core/execution/ExecutionIds';
import type { ExecutionInteractionCallbacks } from '@/core/runtime/execution/ExecutionChatRuntimeAdapter';

import type { CommandcodeApproval } from '../runtime/CommandcodeApprovalTransport';

interface PendingApproval {
  request: InteractionRequest;
  tool: CommandcodeApproval;
  finish(allow: boolean, responseId: string): void;
}

export class CommandcodeApprovals implements InteractionPort {
  private readonly pending = new Map<InteractionId, PendingApproval>();
  private readonly listeners = new Set<(ref: string) => void>();

  request(runId: RunId, tool: CommandcodeApproval, signal: AbortSignal,
    emit: (event: ProviderExecutionEvent['event']) => void): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    const id = interactionId(`ix-${randomUUID().replaceAll('-', '')}`);
    const request: InteractionRequest = { interactionId: id, runId, kind: 'approval',
      presentationRef: id, responseIds: ['allow-once', 'deny'] };
    return new Promise(resolve => {
      const cancel = () => finish(false, 'deny');
      const finish = (allow: boolean, responseId: string) => {
        if (!this.pending.delete(id)) return;
        signal.removeEventListener('abort', cancel);
        emit({ kind: 'interaction-resolved', interactionId: id, responseId });
        for (const listener of this.listeners) listener(id);
        resolve(allow);
      };
      this.pending.set(id, { request, tool, finish });
      signal.addEventListener('abort', cancel, { once: true });
      emit({ kind: 'interaction-opened', interaction: request });
    });
  }

  async resolve(resolution: InteractionResolution): Promise<void> {
    this.pending.get(resolution.interactionId)?.finish(resolution.responseId === 'allow-once',
      resolution.responseId === 'allow-once' ? 'allow-once' : 'deny');
  }
  async cancel(id: InteractionId): Promise<void> { this.pending.get(id)?.finish(false, 'deny'); }
  cancelRun(runId: RunId): void {
    for (const pending of this.pending.values()) if (pending.request.runId === runId) pending.finish(false, 'deny');
  }
  onSettled(listener: (ref: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  presentation(ref: string): CommandcodeApproval | undefined { return this.pending.get(ref as InteractionId)?.tool; }
}

export class CommandcodeApprovalPresenter {
  private readonly open = new Set<string>();
  constructor(private readonly approvals: CommandcodeApprovals, private readonly callbacks: () => ExecutionInteractionCallbacks) {}
  async present(request: InteractionRequest): Promise<string | null> {
    const tool = this.approvals.presentation(request.presentationRef);
    if (!tool) return null;
    const approval = this.callbacks().approval;
    if (!approval) return 'deny';
    const names: Record<string, string> = { edit_file: 'Edit', write_file: 'Write', shell_command: 'Bash' };
    this.open.add(request.presentationRef);
    const unsubscribe = this.approvals.onSettled(ref => { if (ref === request.presentationRef) this.dismiss(ref); });
    try {
      const decision = await approval(names[tool.toolName] ?? tool.toolName, tool.input,
        'Allow this action once?', { decisionOptions: [
          { value: 'allow-once', label: 'Allow once', presentation: 'allow' },
          { value: 'deny', label: 'Deny', presentation: 'reject' },
        ] });
      if (!this.open.has(request.presentationRef)) return null;
      return decision === 'allow' || (typeof decision === 'object' && decision.value === 'allow-once') ? 'allow-once' : 'deny';
    } catch { return 'deny'; }
    finally { this.open.delete(request.presentationRef); unsubscribe(); }
  }
  dismiss(ref: string): void {
    if (this.open.delete(ref)) this.callbacks().approvalDismisser?.();
  }
  dismissAll(): void { for (const ref of this.open) this.dismiss(ref); }
}
