import { ApplicationIdentityFactory } from '@/app/runtime/ApplicationIdentityFactory';

describe('ApplicationIdentityFactory', () => {
  it('creates contract-valid typed and application identifiers', () => {
    let value = 0;
    const identities = new ApplicationIdentityFactory(
      () => (++value).toString(16).padStart(32, '0'),
    );

    expect(identities.nextExecutionSessionId()).toMatch(/^es-[0-9a-f]{32}$/);
    expect(identities.nextSessionInstanceId()).toMatch(/^si-[0-9a-f]{32}$/);
    expect(identities.nextRunId()).toMatch(/^run-[0-9a-f]{32}$/);
    expect(identities.nextInteractionId()).toMatch(/^ix-[0-9a-f]{32}$/);
    expect(identities.nextLeaseId()).toMatch(/^lease-[0-9a-f]{32}$/);
    expect(identities.nextRequestRef()).toMatch(/^req-[0-9a-f]{32}$/);
    expect(identities.nextTransactionId()).toMatch(/^tx-[0-9a-f]{32}$/);
    expect(identities.nextShutdownCheckpointId()).toMatch(/^sd-[0-9a-f]{32}$/);
    expect(identities.nextCommandId()).toMatch(/^cmd-[0-9a-f]{32}$/);
  });

  it('rejects malformed entropy before constructing an identity', () => {
    const identities = new ApplicationIdentityFactory(() => 'not-random');
    expect(() => identities.nextRequestRef()).toThrow('32 lowercase hex digits');
  });
});
