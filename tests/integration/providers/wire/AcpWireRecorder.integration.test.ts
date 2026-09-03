import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { recordAcpWire } from '@test/helpers/recordAcpWire';

/**
 * What the recorder writes down about a turn it did not see answered.
 *
 * `recordAcpWire` is the only thing standing between a CLI and a checked-in
 * fixture, and the fixture is read later as evidence. Its classification had
 * never been exercised: taking a recording costs an account a turn, so the one
 * test above it is gated off by default and asserts only that *something* came
 * back. That is how the recorder came to state, in the file it writes, a fact
 * it cannot observe — a turn that had not answered when it stopped waiting was
 * written down as an account that cannot generate.
 *
 * These rows drive the real recorder against a CLI that answers on demand, so
 * the three outcomes a turn actually has are separated without spending a turn
 * on anyone's account.
 */

/**
 * A CLI that speaks just enough ACP to be recorded, and stops where told.
 *
 * Written out rather than checked in because the whole of it is the three
 * behaviours under test: what it does after `session/prompt` is the argument.
 */
const FAKE_CLI = `
let buffered = '';
const mode = process.argv[2];
const send = message => process.stdout.write(JSON.stringify(message) + '\\n');

process.stdin.on('data', chunk => {
  buffered += String(chunk);
  let newline = buffered.indexOf('\\n');
  while (newline !== -1) {
    const line = buffered.slice(0, newline).trim();
    buffered = buffered.slice(newline + 1);
    newline = buffered.indexOf('\\n');
    if (!line) continue;
    const request = JSON.parse(line);
    if (request.method === 'initialize') {
      send({ jsonrpc: '2.0', id: request.id, result: {
        protocolVersion: 1,
        agentInfo: { name: 'fake-acp', version: '9.9.9' },
      } });
    }
    if (request.method === 'session/new') {
      send({ jsonrpc: '2.0', id: request.id, result: { sessionId: 'fake-session' } });
      send({ jsonrpc: '2.0', method: 'session/update', params: {
        sessionId: 'fake-session',
        update: { sessionUpdate: 'available_commands_update', availableCommands: [] },
      } });
    }
    if (request.method === 'session/prompt') {
      if (mode === 'silent') continue;
      if (mode === 'answers') {
        send({ jsonrpc: '2.0', method: 'session/update', params: {
          sessionId: 'fake-session',
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } },
        } });
      }
      send({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } });
    }
  }
});
`;

describe('the ACP wire recorder', () => {
  jest.setTimeout(60_000);

  let workspace: string;
  let script: string;
  let fixturePath: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'grimoire-wire-recorder-'));
    script = join(workspace, 'fake-acp-cli.js');
    fixturePath = join(workspace, 'fake-wire.json');
    writeFileSync(script, FAKE_CLI);
  });

  afterEach(() => {
    rmSync(workspace, { force: true, recursive: true });
  });

  /** Short enough to keep the suite quick; the recorder's own defaults are minutes. */
  const timings = { handshakeMs: 200, sessionMs: 400, configMs: 100, turnMs: 4_000, graceMs: 200 };

  function record(mode: 'answers' | 'empty' | 'silent'): Promise<Record<string, unknown>> {
    return recordAcpWire({
      providerId: 'fake',
      command: process.execPath,
      args: [script, mode],
      transport: 'stdio JSON-RPC 2.0 (fake)',
      fixturePath,
      timings,
    });
  }

  it('calls a turn that produced assistant content complete', async () => {
    const recording = await record('answers');

    expect(recording.coverage).toBe('complete');
    expect(recording.limitations).toBeUndefined();
    expect(recording.sessionUpdatesObserved).toContain('agent_message_chunk');
    expect(recording.recordedAgainst).toContain('9.9.9');
  });

  it('stops waiting as soon as the turn answers', async () => {
    // The recorder used to sleep a flat thirty seconds after the prompt, which
    // both overpaid for a fast turn and truncated a slow one. Answering ends
    // the wait; `turnMs` is only the bound on it.
    const started = Date.now();

    await record('answers');

    expect(Date.now() - started).toBeLessThan(timings.turnMs);
  });

  it('says the account cannot generate when the turn returned without content', async () => {
    const recording = await record('empty');

    expect(recording.coverage).toBe('partial');
    expect(recording.limitations).toEqual([
      'The turn returned without assistant content: this account cannot generate.',
      'The handshake is evidence; the prompt traffic still needs an account that generates.',
    ]);
  });

  it('does not blame the account for a turn that never came back', async () => {
    // The one this test was written for. A turn still running when the
    // recorder gives up is not an account that cannot generate, and the
    // fixture is read later by someone who was not there.
    const recording = await record('silent');

    expect(recording.coverage).toBe('partial');
    const limitations = recording.limitations as string[];
    expect(limitations.join(' ')).not.toContain('cannot generate');
    expect(limitations).toEqual([
      'The turn had not answered when the recorder stopped waiting, after 4 seconds. '
      + 'What the prompt would have produced is unrecorded, and unknown.',
      'The handshake is evidence; the turn needs a longer wait than this recording gave it.',
    ]);
  });

  it('writes the recording where it was told to', async () => {
    await record('answers');

    const written = JSON.parse(readFileSync(fixturePath, 'utf8')) as { providerId?: unknown };
    expect(written.providerId).toBe('fake');
  });
});
