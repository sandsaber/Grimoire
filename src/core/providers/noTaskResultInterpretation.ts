import type {
  ProviderTaskResultInterpreter,
  ProviderTaskTerminalStatus,
} from './types';

/**
 * What a provider that says nothing about task results is read as.
 *
 * Eight of the nine providers shipped this file themselves — the same
 * twenty-nine lines, five empty answers, a different class name — because the
 * registration required something in the slot. Only Claude has a real one:
 * the async task protocol these interpret is Claude's, and the other eight
 * were declaring that they do not speak it by implementing it emptily.
 *
 * The declaration is the absence now. This is the host's reading of it, in one
 * place, applied where the consumer needs an object rather than a question.
 */
export const NO_TASK_RESULT_INTERPRETATION: ProviderTaskResultInterpreter = {
  hasAsyncLaunchMarker: () => false,
  extractAgentId: () => null,
  extractStructuredResult: () => null,
  resolveTerminalStatus: (
    _toolUseResult: unknown,
    fallbackStatus: ProviderTaskTerminalStatus,
  ) => fallbackStatus,
  extractTagValue: () => null,
};
