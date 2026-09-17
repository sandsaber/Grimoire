import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CommandcodeStream } from '@/providers/commandcode/runtime/CommandcodeStream';

describe('Command Code NDJSON stream', () => {
  it('replays the observed CLI tool trace without mistaking max_turns for success', () => {
    const events: Record<string, unknown>[] = [];
    const stream = new CommandcodeStream(event => events.push(event));
    const trace = readFileSync(join(__dirname, '../../../fixtures/commandcode/headless.ndjson'), 'utf8');
    for (const line of trace.trim().split('\n')) stream.accept(line);
    expect(stream.sessionId).toBe('00000000-0000-4000-8000-000000000001');
    expect(stream.result?.subtype).toBe('max_turns');
    expect(events.find(event => event.type === 'tool_completed')).toMatchObject({
      toolName: 'read_file', result: [{ type: 'text', text: 'Read 1/1 file, 1 line\n1: COMMANDCODE_FILE_OK' }],
    });
    expect(events.map(event => event.type)).toEqual(['model_request_end', 'tool_queued', 'tool_running', 'tool_completed']);
  });

  it('streams deltas once and requires the final result, not run_end', () => {
    const events: unknown[] = [];
    const stream = new CommandcodeStream(event => events.push(event));
    for (const frame of [
      { type: 'event', event: { type: 'text_delta', delta: 'Hello' } },
      { type: 'event', event: { type: 'message_update', content: [{ type: 'text', text: 'Hello' }] } },
      { type: 'event', event: { type: 'run_end', result: { finalText: 'Hello', nextState: { secret: 'not forwarded' } } } },
    ]) stream.accept(JSON.stringify(frame));
    expect(events).toEqual([{ type: 'text_delta', delta: 'Hello' }]);
    expect(stream.result).toBeUndefined();
    stream.accept(JSON.stringify({ type: 'result', subtype: 'success', finalText: 'Hello', sessionId: 'native-session' }));
    expect(stream.result?.subtype).toBe('success');
    expect(stream.sessionId).toBe('native-session');
  });

  it('preserves max-turn failure even when a partial answer exists', () => {
    const stream = new CommandcodeStream(() => undefined);
    stream.accept(JSON.stringify({ type: 'result', subtype: 'max_turns', finalText: 'Partial answer' }));
    expect(stream.result?.subtype).toBe('max_turns');
  });

  it('ignores unknown event types and rejects malformed final results', () => {
    const events: unknown[] = [];
    const stream = new CommandcodeStream(event => events.push(event));
    stream.accept(JSON.stringify({ type: 'event', event: { type: 'future_event' } }));
    expect(events).toEqual([]);
    expect(() => stream.accept('{broken')).toThrow();
    expect(() => stream.accept(JSON.stringify({ type: 'result', subtype: 'success' }))).toThrow();
  });
});
