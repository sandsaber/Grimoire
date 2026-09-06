import { createQwenWorkspaceServices } from '@/providers/qwen/app/QwenWorkspaceServices';

describe('createQwenWorkspaceServices', () => {
  it('registers a usage provider for ACP cost updates', async () => {
    const services = await createQwenWorkspaceServices({} as any, {} as any);

    expect(services.commandCatalog).toBeDefined();
    expect(services.usageProvider).toBeDefined();
  });
});
