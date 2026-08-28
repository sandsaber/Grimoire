import type { ProviderRegistration } from '../../core/providers/types';

export const qwenProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getQwenExecution().createRuntime(),
};
