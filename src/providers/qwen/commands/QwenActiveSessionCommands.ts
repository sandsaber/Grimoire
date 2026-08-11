import type { SlashCommand } from '@/core/types';
import type { QwenExecutionCommandsPort } from '@/providers/qwen/execution/QwenExecutionBackend';

/** Session-keyed command state; callers must name the active native session explicitly. */
export class QwenActiveSessionCommands implements QwenExecutionCommandsPort {
  private readonly bySession = new Map<string, readonly SlashCommand[]>();

  replace(sessionId: string, commands: readonly SlashCommand[]): void {
    this.bySession.set(sessionId, commands.map(command => ({ ...command })));
  }

  clear(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  list(sessionId: string): readonly SlashCommand[] {
    return (this.bySession.get(sessionId) ?? []).map(command => ({ ...command }));
  }
}
