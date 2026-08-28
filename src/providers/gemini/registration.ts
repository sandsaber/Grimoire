import type { ProviderRegistration } from '../../core/providers/types';

export const geminiProviderRegistration: ProviderRegistration = {
  createRuntime: ({ plugin }) => plugin.getGeminiExecution().createRuntime(),
};
