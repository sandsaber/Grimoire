import { PassThrough } from 'node:stream';

import { AcpJsonRpcTransport } from '@/providers/acp/AcpJsonRpcTransport';

/**
 * What the transport does when the stream says "not yet".
 *
 * `write` returning `false` is the only bound a pipe offers, and a transport
 * that writes anyway buffers without one. The first attempt at this recorded
 * the refusal in a field nothing read and wrote regardless — a flag beside the
 * same unbounded buffering. What has to hold is that the write waits, and that
 * what waited arrives in the order it was sent: a response that overtook its
 * request would be a reply to nothing.
 */
describe('ACP transport backpressure', () => {
  /**
   * An output stream that asks for a pause after the first line.
   *
   * Faithful to Node's contract, which is the part that matters here: a `false`
   * from `write` still means the chunk was taken — it is a request to stop
   * sending, not a rejection. A double that dropped what it refused would make
   * this suite assert a message loss the real stream does not have.
   */
  function createBlockedOutput(): {
    output: NodeJS.WritableStream;
    written: string[];
    drain: () => void;
  } {
    const written: string[] = [];
    let accepting = false;
    const listeners = new Set<() => void>();
    const output = {
      write: (chunk: string) => {
        written.push(chunk);
        return accepting;
      },
      once: (event: string, listener: () => void) => {
        if (event === 'drain') {
          listeners.add(listener);
        }
      },
      on: () => undefined,
      off: () => undefined,
      removeListener: () => undefined,
      end: () => undefined,
    } as unknown as NodeJS.WritableStream;
    return {
      output,
      written,
      drain: () => {
        accepting = true;
        for (const listener of [...listeners]) {
          listeners.delete(listener);
          listener();
        }
      },
    };
  }

  function createTransport(output: NodeJS.WritableStream): AcpJsonRpcTransport {
    return new AcpJsonRpcTransport({
      input: new PassThrough(),
      output,
      onClose: () => () => undefined,
    });
  }

  it('holds what the stream refused, and sends it in order once it drains', async () => {
    const blocked = createBlockedOutput();
    const transport = createTransport(blocked.output);
    transport.start();

    // The first is taken and asks for a pause; the two behind it must wait
    // rather than pile into a buffer nothing bounds.
    void transport.request('first', {}).catch(() => undefined);
    void transport.request('second', {}).catch(() => undefined);
    void transport.request('third', {}).catch(() => undefined);
    expect(blocked.written.map(line => (JSON.parse(line) as { method: string }).method))
      .toEqual(['first']);

    blocked.drain();

    // Everything arrives, in the order it was sent.
    const methods = blocked.written.map(line => (JSON.parse(line) as { method: string }).method);
    expect(methods).toEqual(['first', 'second', 'third']);
    transport.dispose();
  });

  it('writes straight through while the stream is accepting', () => {
    const output = {
      write: (chunk: string) => { written.push(chunk); return true; },
      once: () => undefined,
      on: () => undefined,
      off: () => undefined,
      removeListener: () => undefined,
      end: () => undefined,
    } as unknown as NodeJS.WritableStream;
    const written: string[] = [];
    const transport = createTransport(output);
    transport.start();

    void transport.request('first', {}).catch(() => undefined);
    void transport.request('second', {}).catch(() => undefined);

    expect(written.map(line => (JSON.parse(line) as { method: string }).method))
      .toEqual(['first', 'second']);
    transport.dispose();
  });
});
