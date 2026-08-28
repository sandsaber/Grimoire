import type { ProviderRegistration } from '../../core/providers/types';
import { grokSubagentLifecycleAdapter } from './normalization/grokSubagentNormalization';

export const grokProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getGrokExecution().createRuntime(),
  subagentLifecycleAdapter: grokSubagentLifecycleAdapter,
};
