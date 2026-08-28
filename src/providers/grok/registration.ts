import type { ProviderRegistration } from '../../core/providers/types';
import { grokSubagentLifecycleAdapter } from './normalization/grokSubagentNormalization';

export const grokProviderRegistration: ProviderRegistration = {
  subagentLifecycleAdapter: grokSubagentLifecycleAdapter,
};
