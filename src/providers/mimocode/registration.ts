import type { ProviderRegistration } from '../../core/providers/types';

export const mimocodeProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getMimocodeExecution().createRuntime(),
};
