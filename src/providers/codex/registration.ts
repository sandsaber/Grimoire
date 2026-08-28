import type { ProviderRegistration } from '../../core/providers/types';
import { codexSubagentLifecycleAdapter } from './normalization/codexSubagentNormalization';

export const codexProviderRegistration: ProviderRegistration = {
  // The second provider flip: chat execution runs through the kernel. Only this
  // row moves — workspace services, settings, auxiliary services, history and
  // UI config stay exactly as they were, per the mixed-authority rule that
  // holds until M5.
  subagentLifecycleAdapter: codexSubagentLifecycleAdapter,
};
