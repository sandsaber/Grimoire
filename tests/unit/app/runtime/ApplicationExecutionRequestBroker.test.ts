import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';

describe('ApplicationExecutionRequestBroker', () => {
  it('generates a durable-safe ref and resolves sensitive input once', async () => {
    const requests = new EphemeralExecutionRequestStore();
    const broker = new ApplicationExecutionRequestBroker(requests, {
      nextRequestRef: () => `req-${'1'.repeat(32)}`,
    });
    const payload = { prompt: 'private prompt', environment: { TOKEN: 'secret' } };

    const requestRef = broker.register('provider-turn', payload);
    expect(requestRef).toBe(`req-${'1'.repeat(32)}`);
    await expect(broker.resolver<typeof payload>('provider-turn').resolve(requestRef))
      .resolves.toEqual(payload);
    await expect(broker.resolver('provider-turn').resolve(requestRef))
      .rejects.toThrow('unavailable');
  });
});
