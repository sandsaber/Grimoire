import type { ProviderRegistration } from '../../core/providers/types';

export const kimicodeProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getKimicodeExecution().createRuntime(),
};
