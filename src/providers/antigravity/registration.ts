import type { ProviderRegistration } from '../../core/providers/types';

export const antigravityProviderRegistration: ProviderRegistration = {
  // The first provider flip: chat execution runs through the kernel. Only this
  // row moves — workspace services, settings, auxiliary services, and every
  // other registration stay exactly as they were. Codex followed in wave 2.
  createRuntime: ({ plugin }) => plugin.getAntigravityExecution().createRuntime(),
};
