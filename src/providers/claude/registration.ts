import type { ProviderRegistration } from '../../core/providers/types';
import { ClaudeTaskResultInterpreter } from './runtime/ClaudeTaskResultInterpreter';

export const claudeProviderRegistration: ProviderRegistration = {
  // The one provider with a real interpreter: the async task protocol these
  // read is Claude's own.
  taskResultInterpreter: new ClaudeTaskResultInterpreter(),
};
