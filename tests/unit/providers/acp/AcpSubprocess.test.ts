import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

import { AcpSubprocess } from '@/providers/acp/AcpSubprocess';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

const spawnMock = spawn as jest.MockedFunction<typeof spawn>;

type MockChildProcess = EventEmitter & {
  exitCode: number | null;
  killed: boolean;
  kill: jest.Mock<boolean, [NodeJS.Signals]>;
  pid: number;
  stderr: Readable;
  stdin: Writable;
  stdout: Readable;
};

function createMockProcess(): ChildProcessWithoutNullStreams {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdin = new Writable({ write: (_chunk, _encoding, callback) => callback() });
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.exitCode = null;
  proc.killed = false;
  proc.kill = jest.fn().mockReturnValue(true);
  proc.pid = 12345;
  return proc as unknown as ChildProcessWithoutNullStreams;
}

function createLaunchSpec() {
  return {
    args: ['acp'],
    command: 'opencode.cmd',
    cwd: 'C:\\vault',
    env: { PATH: 'C:\\bin' },
  };
}

describe('AcpSubprocess', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    jest.useRealTimers();
    spawnMock.mockReset();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('enables shell support when spawning ACP commands on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const mockProc = createMockProcess();
    spawnMock.mockReturnValue(mockProc);

    new AcpSubprocess(createLaunchSpec()).start();

    expect(spawnMock).toHaveBeenCalledWith('opencode.cmd', ['acp'], expect.objectContaining({
      cwd: 'C:\\vault',
      env: { PATH: 'C:\\bin' },
      shell: true,
      stdio: 'pipe',
      windowsHide: true,
    }));
  });

  it('does not route absolute Windows executables through the shell', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const mockProc = createMockProcess();
    spawnMock.mockReturnValue(mockProc);

    new AcpSubprocess({
      ...createLaunchSpec(),
      command: 'C:\\Tools\\opencode.exe',
    }).start();

    expect(spawnMock).toHaveBeenCalledWith('C:\\Tools\\opencode.exe', ['acp'], expect.objectContaining({
      shell: false,
      windowsHide: true,
    }));
  });

  it('spawns relative Windows executables directly when the launch spec opts out of a shell', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const mockProc = createMockProcess();
    spawnMock.mockReturnValue(mockProc);

    new AcpSubprocess({
      ...createLaunchSpec(),
      command: 'wsl.exe',
      shell: false,
    }).start();

    expect(spawnMock).toHaveBeenCalledWith('wsl.exe', ['acp'], expect.objectContaining({
      shell: false,
      windowsHide: true,
    }));
  });

  it('keeps a hostile workspace path out of the .cmd command line and routes it via the cwd option', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const mockProc = createMockProcess();
    spawnMock.mockReturnValue(mockProc);
    const hostileCwd = 'C:\\Users\\Name\\OneDrive - 公司\\Vault 中文 (test)';

    new AcpSubprocess({
      args: ['acp'],
      command: 'opencode.cmd',
      cwd: hostileCwd,
      env: { PATH: 'C:\\bin' },
    }).start();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe('opencode.cmd');
    // The workspace path must never be appended to the args that cmd.exe would
    // tokenize; only the literal 'acp' subcommand is passed through.
    expect(args).toEqual(['acp']);
    expect(args.join(' ')).not.toContain(hostileCwd);
    expect(options).toEqual(expect.objectContaining({
      cwd: hostileCwd,
      shell: true,
      stdio: 'pipe',
      windowsHide: true,
    }));
  });

  it('does not enable shell support when spawning ACP commands on non-Windows platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const mockProc = createMockProcess();
    spawnMock.mockReturnValue(mockProc);

    new AcpSubprocess({
      args: ['--acp'],
      command: 'gemini',
      cwd: '/vault',
      env: { PATH: '/usr/bin' },
    }).start();

    expect(spawnMock).toHaveBeenCalledWith('gemini', ['--acp'], expect.objectContaining({
      cwd: '/vault',
      env: { PATH: '/usr/bin' },
      shell: false,
      stdio: 'pipe',
      windowsHide: true,
    }));
  });

  it('uses SIGINT first and taskkill fallback when Windows shutdown times out', async () => {
    jest.useFakeTimers();
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const mockProc = createMockProcess();
    spawnMock.mockReturnValue(mockProc);
    const subprocess = new AcpSubprocess(createLaunchSpec());
    subprocess.start();

    const shutdownPromise = subprocess.shutdown();
    jest.advanceTimersByTime(3_000);

    expect(mockProc.kill).toHaveBeenCalledWith('SIGINT');
    expect(mockProc.kill).not.toHaveBeenCalledWith('SIGTERM');
    expect(mockProc.kill).not.toHaveBeenCalledWith('SIGKILL');
    expect(spawnMock).toHaveBeenCalledWith('taskkill', ['/pid', '12345', '/f', '/t'], {
      windowsHide: true,
    });

    mockProc.emit('exit', 1, null);
    await shutdownPromise;
  });
});
