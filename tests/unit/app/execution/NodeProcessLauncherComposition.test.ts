import { createNodeProcessLauncherComposition } from '@/app/execution/NodeProcessLauncherComposition';
import { ApplicationExecutionRequestBroker } from '@/app/runtime/ApplicationExecutionRequestBroker';
import { ApplicationIdentityFactory } from '@/app/runtime/ApplicationIdentityFactory';
import { EphemeralExecutionRequestStore } from '@/app/runtime/EphemeralExecutionRequestStore';

describe('createNodeProcessLauncherComposition', () => {
  it('constructs concrete Node process launchers for every topology', () => {
    const identities = new ApplicationIdentityFactory(() => '1'.repeat(32));
    const requests = new ApplicationExecutionRequestBroker(
      new EphemeralExecutionRequestStore(),
      identities,
    );
    const launchers = createNodeProcessLauncherComposition({
      requests,
      codexLaunchSpec: {
        command: 'codex',
        args: ['--app-server'],
        spawnCwd: '/vault',
        env: {},
      },
    });

    expect(launchers.antigravityTransport).toBeDefined();
    expect(typeof launchers.managedAcpLauncher.launch).toBe('function');
    expect(typeof launchers.codexProcessFactory.create).toBe('function');
  });
});
