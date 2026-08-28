import '@/providers';

import { createAcpLaunchMockPlugin, WINDOWS_UNICODE_VAULT } from '@test/helpers/acpLaunchMocks';

import type { ExecutionLifecycleRegistry } from '@/core/execution/ExecutionLifecycleRegistry';
import { KimicodeExecution } from '@/providers/kimicode/execution/KimicodeExecutionComposition';
import { prepareKimicodeLaunchArtifacts } from '@/providers/kimicode/runtime/KimicodeLaunchArtifacts';

jest.mock('@/providers/kimicode/runtime/KimicodeLaunchArtifacts', () => {
  const actual = jest.requireActual('@/providers/kimicode/runtime/KimicodeLaunchArtifacts');
  return {
    ...actual,
    prepareKimicodeLaunchArtifacts: jest.fn(),
  };
});

const mockPrepareKimicodeLaunchArtifacts = prepareKimicodeLaunchArtifacts as jest.MockedFunction<
typeof prepareKimicodeLaunchArtifacts
>;

/**
 * How a vault path reaches Kimi Code, on the platform that punishes getting it
 * wrong.
 *
 * A Windows path with spaces and non-ASCII characters passed as an argument is
 * a launch that fails or, worse, one that starts in the wrong directory. It is
 * the working directory of the process and the `cwd` of the session, and never
 * a word on the command line — the flip moved where that is decided, not
 * whether it still has to be true.
 */
describe('Kimi Code ACP launch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrepareKimicodeLaunchArtifacts.mockResolvedValue({
      configPath: 'C:\\tmp\\grimoire-kimicode\\config.json',
      configContent: '{}\n',
      databasePath: null,
      launchKey: 'launch-key',
      systemPromptPath: 'C:\\tmp\\grimoire-kimicode\\system.md',
    });
  });

  it('does not pass the workspace path through Kimi Code CLI arguments', async () => {
    const execution = new KimicodeExecution(
      createAcpLaunchMockPlugin({ cliPath: 'C:\\Tools\\kimicode.exe', providerId: 'kimicode' }),
      {} as unknown as ExecutionLifecycleRegistry,
    );

    const invocation = await execution.turnRequests.resolve(execution.turnRequests.reference({
      prompt: [{ type: 'text', text: 'what now?' }],
    }));
    const launch = await execution.turnRequests.resolveLaunch(invocation.startupRef);

    expect(launch).toMatchObject({
      arguments: ['acp'],
      cwd: WINDOWS_UNICODE_VAULT,
      executable: 'C:\\Tools\\kimicode.exe',
    });
    expect(invocation.cwd).toBe(WINDOWS_UNICODE_VAULT);
    // The vault path is the working directory and nothing else; a path with
    // spaces and non-ASCII characters on a command line is a launch that
    // starts somewhere else or not at all.
    expect(launch.arguments).toEqual(['acp']);
    execution.dispose();
  });
});
