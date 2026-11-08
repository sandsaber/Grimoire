import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { AudioBridgeClient } from '@/app/audio/AudioBridgeClient';

jest.mock('node:child_process', () => ({ spawn: jest.fn() }));
import { spawn } from 'node:child_process';

describe('Audio bridge framing and ownership', () => {
  let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: jest.Mock; exitCode: null };
  let client: AudioBridgeClient;
  let requests: Array<Record<string, unknown>>;
  beforeEach(() => {
    child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: jest.fn(), exitCode: null });
    requests = [];
    child.stdin.on('data', data => requests.push(JSON.parse(data.toString())));
    jest.mocked(spawn).mockReturnValue(child as never);
    client = new AudioBridgeClient('/native Audio');
  });
  afterEach(() => { client.close(); child.emit('exit', 0); });
  function reply(value: Record<string, unknown>) { child.stdout.write(JSON.stringify({ v: 1, ...value }) + '\n'); }
  it('spawns without a shell, handles split UTF-8 and stops only the original job', async () => {
    const accepted = jest.fn(); const result = client.start(accepted);
    reply({ id: 1, event: 'accepted' }); expect(accepted).not.toHaveBeenCalled();
    reply({ id: 2, event: 'status', status: { listening: true } }); await Promise.resolve();
    expect(accepted).toHaveBeenCalledTimes(1);
    const stop = client.stop(); expect(requests[2]).toMatchObject({ id: 3, op: 'stop', job: 1 });
    reply({ id: 3, event: 'accepted' }); await stop;
    const bytes = Buffer.from(JSON.stringify({ v: 1, id: 1, event: 'result', provider: 'local', text: '🙂中文' }) + '\n');
    for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
    await expect(result).resolves.toBe('🙂中文');
    expect(spawn).toHaveBeenCalledWith('/native Audio', ['--bridge'], expect.objectContaining({ shell: false }));
    expect(requests[0]).toMatchObject({ provider: 'local' });
  });
  it('tracks actual capture ending before the terminal result', async () => {
    jest.useFakeTimers();
    try {
      const listening = jest.fn(); const processing = jest.fn();
      const result = client.start(listening, processing);
      reply({ id: 1, event: 'accepted' });
      expect(listening).not.toHaveBeenCalled();
      reply({ id: 2, event: 'status', status: { listening: true } }); await Promise.resolve();
      expect(listening).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(200);
      reply({ id: 3, event: 'status', status: { listening: false, phase: 'processing' } }); await Promise.resolve();
      expect(processing).toHaveBeenCalledTimes(1);
      reply({ id: 1, event: 'result', provider: 'local', text: 'done' });
      await expect(result).resolves.toBe('done');
    } finally { jest.useRealTimers(); }
  });

  it('keeps the original result when Stop races with automatic capture completion', async () => {
    const result = client.start(jest.fn()); reply({ id: 1, event: 'accepted' });
    reply({ id: 2, event: 'status', status: { listening: true } }); await Promise.resolve();
    const stop = client.stop(); reply({ id: 3, event: 'error', code: 'invalid_state' }); await Promise.resolve();
    reply({ id: 4, event: 'status', status: { listening: false, phase: 'processing' } }); await stop;
    reply({ id: 1, event: 'result', provider: 'local', text: 'finished' });
    await expect(result).resolves.toBe('finished');
  });

  it('refuses cloud status before capture or provider changes', async () => {
    const ready = client.ready(); reply({ id: 1, event: 'status', status: { provider: 'openai', ready: true } });
    await expect(ready).rejects.toThrow('Local'); expect(requests).toHaveLength(1);
  });
  it.each(['malformed', 'oversized', 'identity', 'eof', 'remote', 'unaccepted'])('fails closed on %s without replay', async kind => {
    const work = client.start(jest.fn());
    if (kind === 'unaccepted') reply({ id: 1, event: 'result', provider: 'local', text: 'unexpected' });
    if (kind === 'malformed') child.stdout.write('not JSON\n');
    if (kind === 'oversized') child.stdout.write('x'.repeat(65537));
    if (kind === 'identity') reply({ id: 7, event: 'accepted' });
    if (kind === 'eof') child.emit('exit', 1);
    if (kind === 'remote') { reply({ id: 1, event: 'accepted' }); reply({ id: 1, event: 'result', provider: 'openai', text: 'remote' }); }
    await expect(work).rejects.toThrow(); expect(requests.filter(request => request.op !== 'status')).toHaveLength(1);
  });
  it('refuses an older status schema before starting capture', async () => {
    const ready = client.ready(); reply({ id: 1, event: 'status', status: { provider: 'local', ready: true } });
    await expect(ready).rejects.toThrow('Update Grimoire Audio'); expect(requests).toHaveLength(1);
  });

  it('maps busy to static copy without exposing native payloads', async () => {
    const work = client.start(jest.fn()); reply({ id: 1, event: 'error', code: 'busy', message: 'private native payload' });
    await expect(work).rejects.toThrow('busy');
  });
});
