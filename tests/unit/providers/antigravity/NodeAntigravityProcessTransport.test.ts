import { PassThrough, Writable } from 'node:stream';

import type {
  LocalProcessSystem,
  SpawnedLocalProcess,
} from '@/app/execution/local/NodeLocalShellProcessAdapter';
import { NodeAntigravityProcessTransport } from '@/providers/antigravity/execution/NodeAntigravityProcessTransport';

describe('NodeAntigravityProcessTransport', () => {
  it('closes stdin even when the write never reports back', async () => {
    // **EOF is the end of the protocol, not a reward for a clean write.** The
    // stream-json turn is one line and then EOF, and a live `agy` whose stdin
    // stays open answers and then never leaves — verified against the CLI. When
    // the close was made conditional on the write callback, a callback that
    // never fires meant EOF never sent, and the turn stayed open with no
    // terminal frame until a timer ended it (#139). 1.3.2 closed unconditionally.
    const stdin = new SilentWritable();
    const transport = new NodeAntigravityProcessTransport(systemWith(stdin), 'posix');

    const child = transport.launch(SPEC);
    // Never awaited: the write callback is the thing that does not come back.
    void child.sendInput?.('{"event":"user"}\n');
    await flush();

    expect(stdin.ended).toBe(true);
  });

  it('closes stdin when the write fails outright', async () => {
    // The other way the callback never resolves: a child that already left, so
    // the pipe rejects the write. The prompt is lost either way, but a lost
    // prompt is a failed turn — a missing EOF is a turn that never ends.
    const stdin = new FailingWritable();
    const transport = new NodeAntigravityProcessTransport(systemWith(stdin), 'posix');

    const child = transport.launch(SPEC);
    await expect(child.sendInput?.('{"event":"user"}\n')).rejects.toThrow('broken pipe');
    await flush();

    expect(stdin.ended).toBe(true);
  });
});

const SPEC = {
  args: ['--input-format', 'stream-json'],
  command: '/usr/local/bin/agy',
  cwd: '/vault',
  environment: { PATH: '/usr/local/bin' },
  shell: false,
  stdin: 'pipe' as const,
};

/** Accepts the bytes and never calls the callback, the way a full pipe stalls. */
class SilentWritable extends Writable {
  ended = false;

  override _write(): void {
    // No callback: the write is accepted and never acknowledged.
  }

  override end(...args: unknown[]): this {
    this.ended = true;
    return super.end(...(args as []));
  }
}

class FailingWritable extends Writable {
  ended = false;

  override _write(
    _chunk: unknown,
    _encoding: unknown,
    callback: (error?: Error | null) => void,
  ): void {
    callback(new Error('broken pipe'));
  }

  override end(...args: unknown[]): this {
    this.ended = true;
    return super.end(...(args as []));
  }
}

function systemWith(stdin: Writable): LocalProcessSystem {
  const spawned: SpawnedLocalProcess = {
    termination: { kind: 'posix-process-group', pid: 4242 },
    stdin,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    started: Promise.resolve(),
    exited: new Promise(() => {}),
  };
  return {
    spawn: () => spawned,
    processGroupExists: () => true,
    signalProcessGroup: () => undefined,
    windowsJobTerminated: () => true,
    terminateWindowsJob: async () => true,
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}
