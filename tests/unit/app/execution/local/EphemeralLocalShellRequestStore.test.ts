import { EphemeralLocalShellRequestStore } from '@/app/execution/local/EphemeralLocalShellRequestStore';

describe('EphemeralLocalShellRequestStore', () => {
  it('resolves raw shell input exactly once and clears it on disposal', async () => {
    const store = new EphemeralLocalShellRequestStore();
    const environment = { TOKEN: 'secret' };
    store.register('shell-request-1', {
      command: 'printf private',
      cwd: '/private/workspace',
      environment,
    });
    environment.TOKEN = 'changed';

    await expect(store.resolve('shell-request-1')).resolves.toEqual({
      command: 'printf private',
      cwd: '/private/workspace',
      environment: { TOKEN: 'secret' },
    });
    await expect(store.resolve('shell-request-1')).rejects.toThrow('absent');

    store.register('shell-request-2', { command: 'never-dispatched' });
    store.dispose();
    await expect(store.resolve('shell-request-2')).rejects.toThrow('disposed');
  });
});
