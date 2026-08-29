import {
  extractMimocodeSessionErrorFromMessage,
  formatMimocodeSessionError,
} from '@/providers/mimocode/history/MimocodeSessionErrorStore';

/**
 * What a MiMoCode turn says when the agent's own store recorded the failure.
 *
 * The row-array reader these tests used to enter through was a SQLite scan for
 * a session's latest error, and it went with the loader nothing called. The
 * behaviour that still ships is the same two steps on the message the history
 * store already holds: read the error out, and say it in words a person can act
 * on.
 */
describe('MimocodeSessionErrorStore', () => {
  it('turns a stored 401 into an actionable authentication error', () => {
    const error = extractMimocodeSessionErrorFromMessage({
      role: 'assistant',
      error: {
        name: 'APIError',
        data: {
          message: 'Invalid API Key: Please provide valid API Key',
          statusCode: 401,
        },
      },
    });

    expect(error).toEqual({
      message: 'Invalid API Key: Please provide valid API Key',
      name: 'APIError',
      statusCode: 401,
    });
    // The status code is what earns the instruction. A bare "request failed"
    // leaves a logged-out user with nothing to do.
    expect(formatMimocodeSessionError(error!)).toBe(
      'MiMo authentication failed: Invalid API Key. Run `mimo auth login` in a terminal, then retry.',
    );
  });

  it('returns a bounded provider error without exposing response metadata', () => {
    // `responseBody` is the upstream reply, which can carry anything the vendor
    // put in it. Only the message crosses into the transcript.
    const error = extractMimocodeSessionErrorFromMessage({
      role: 'assistant',
      error: {
        data: {
          message: 'Rate limit reached',
          responseBody: 'sensitive upstream body',
        },
      },
    });

    expect(error).toEqual({ message: 'Rate limit reached' });
    expect(formatMimocodeSessionError(error!)).toBe('MiMo request failed: Rate limit reached');
  });

  it('says nothing about a message that carries no error', () => {
    expect(extractMimocodeSessionErrorFromMessage({ role: 'assistant' })).toBeNull();
    expect(extractMimocodeSessionErrorFromMessage({
      role: 'assistant',
      error: { name: 'APIError' },
    })).toBeNull();
  });
});
