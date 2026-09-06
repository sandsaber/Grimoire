import '@/providers';

import { createAcpLaunchMockPlugin, WINDOWS_UNICODE_VAULT } from '@test/helpers/acpLaunchMocks';

import type { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import { MimocodeExecution } from '@/providers/mimocode/execution/MimocodeExecutionComposition';
import { prepareMimocodeLaunchArtifacts } from '@/providers/mimocode/runtime/MimocodeLaunchArtifacts';

jest.mock('@/providers/mimocode/runtime/MimocodeLaunchArtifacts', () => {
  const actual = jest.requireActual('@/providers/mimocode/runtime/MimocodeLaunchArtifacts');
  return {
    ...actual,
    prepareMimocodeLaunchArtifacts: jest.fn(),
  };
});

const mockPrepareMimocodeLaunchArtifacts = prepareMimocodeLaunchArtifacts as jest.MockedFunction<
typeof prepareMimocodeLaunchArtifacts
>;

/**
 * How a vault path reaches MiMoCode, on the platform that punishes getting it
 * wrong.
 *
 * A Windows path with spaces and non-ASCII characters passed as an argument is
 * a launch that fails or, worse, one that starts in the wrong directory. It is
 * the working directory of the process and the `cwd` of the session, and never
 * a word on the command line — the flip moved where that is decided, not
 * whether it still has to be true.
 */
describe('MiMoCode ACP launch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrepareMimocodeLaunchArtifacts.mockResolvedValue({
      configPath: 'C:\\tmp\\grimoire-mimocode\\config.json',
      configContent: '{}\n',
      databasePath: null,
      launchKey: 'launch-key',
      systemPromptPath: 'C:\\tmp\\grimoire-mimocode\\system.md',
    });
  });

  it('does not pass the workspace path through MiMoCode CLI arguments', async () => {
    const execution = new MimocodeExecution(
      createAcpLaunchMockPlugin({ cliPath: 'C:\\Tools\\mimocode.exe', providerId: 'mimocode' }),
      {} as unknown as ExecutionLifecycleRegistry,
    );

    const invocation = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'what now?' }],
    }));
    const launch = await execution.turnRequests.resolveLaunch(invocation.startupRef);

    expect(launch).toMatchObject({
      arguments: ['acp'],
      cwd: WINDOWS_UNICODE_VAULT,
      executable: 'C:\\Tools\\mimocode.exe',
    });
    expect(invocation.cwd).toBe(WINDOWS_UNICODE_VAULT);
    // The vault path is the working directory and nothing else; a path with
    // spaces and non-ASCII characters on a command line is a launch that
    // starts somewhere else or not at all.
    expect(launch.arguments).toEqual(['acp']);
    execution.dispose();
  });
});
