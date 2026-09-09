import { createDevinWorkspaceServices } from '@/providers/devin/app/DevinWorkspaceServices';

describe('createDevinWorkspaceServices', () => {
  it('registers a usage provider for ACP cost updates', async () => {
    const services = await createDevinWorkspaceServices({} as any, {} as any);

    expect(services.commandCatalog).toBeDefined();
    expect(services.usageProvider).toBeDefined();
  });
});
