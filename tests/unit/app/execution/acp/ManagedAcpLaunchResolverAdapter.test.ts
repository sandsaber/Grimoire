import {
  MANAGED_ACP_LAUNCH_REQUEST_KIND,
  ManagedAcpLaunchResolverAdapter,
} from '@/app/execution/acp/ManagedAcpLaunchResolverAdapter';
import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { ApplicationIdentityFactory } from '@/app/runtime/ApplicationIdentityFactory';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';

describe('ManagedAcpLaunchResolverAdapter', () => {
  it('resolves launch invocations through the request broker', async () => {
    const identities = new ApplicationIdentityFactory(() => '1'.repeat(32));
    const requests = new ApplicationExecutionRequestBroker(
      new EphemeralExecutionRequestStore(),
      identities,
    );
    const resolver = new ManagedAcpLaunchResolverAdapter(requests);

    const invocation = {
      executable: '/usr/bin/opencode',
      arguments: ['--mode', 'plan'],
      cwd: '/vault',
      environment: { PATH: '/usr/bin' },
    };
    const startupRef = requests.register(MANAGED_ACP_LAUNCH_REQUEST_KIND, invocation);
    await expect(resolver.resolve(startupRef)).resolves.toEqual(invocation);
  });

  it('throws when the startup ref does not match the launch kind', async () => {
    const identities = new ApplicationIdentityFactory(() => '2'.repeat(32));
    const requests = new ApplicationExecutionRequestBroker(
      new EphemeralExecutionRequestStore(),
      identities,
    );
    const resolver = new ManagedAcpLaunchResolverAdapter(requests);
    const startupRef = requests.register('wrong-kind', {});
    await expect(resolver.resolve(startupRef)).rejects.toThrow();
  });
});
