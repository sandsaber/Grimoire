import type { ProviderRegistration } from '../../core/providers/types';

export const opencodeProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getOpencodeExecution().createRuntime(),
};
