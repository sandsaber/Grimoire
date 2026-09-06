import { JsonRpcErrorResponse } from '@/providers/acp/AcpJsonRpcTransport';
import {
  isAcpMissingSessionError,
  isAcpSessionGone,
} from '@/providers/acp/acpSessionResume';

/**
 * What is left of this module after the legacy runtimes went: the one decision
 * a failed `session/load` still needs. The wipe policy, the persist fields and
 * the debug event were the old resume path's, and their tests went with them.
 */
describe('acpSessionResume', () => {
  describe('isAcpSessionGone', () => {
    // Captured from the shipped CLIs by loading a session id they never had.
    // None of them says so in the error, which is the whole reason the listing
    // is consulted; they are kept verbatim so a CLI that starts answering
    // properly shows up here as a change.
    const REAL_LOAD_FAILURES: Array<[string, JsonRpcErrorResponse]> = [
      ['MiMoCode 0.1.13', new JsonRpcErrorResponse('session/load', -32603, 'Internal error', {})],
      ['OpenCode 1.18.18', new JsonRpcErrorResponse(
        'session/load',
        -32603,
        'Internal error: OpenCode service failure',
        { service: 'session' },
      )],
    ];

    it.each(REAL_LOAD_FAILURES)('asks the agent when %s does not say why the load failed', async (_label, error) => {
      expect(isAcpMissingSessionError(error)).toBe(false);

      await expect(isAcpSessionGone({
        error,
        listSessions: async () => ({ sessions: [{ sessionId: 'other-session' }] }),
        sessionId: 'session-1',
      })).resolves.toBe(true);

      await expect(isAcpSessionGone({
        error,
        listSessions: async () => ({ sessions: [{ sessionId: 'session-1' }] }),
        sessionId: 'session-1',
      })).resolves.toBe(false);
    });

    it('recognises a session the agent does name, without spending a listing', async () => {
      const listSessions = jest.fn();

      await expect(isAcpSessionGone({
        error: new JsonRpcErrorResponse('session/load', -32602, 'Invalid params: Unknown sessionId: session-1', {}),
        listSessions,
        sessionId: 'session-1',
      })).resolves.toBe(true);
      expect(listSessions).not.toHaveBeenCalled();
    });

    it('keeps the binding when the agent cannot list sessions', async () => {
      await expect(isAcpSessionGone({
        error: new JsonRpcErrorResponse('session/load', -32000, 'Authentication failed'),
        listSessions: async () => { throw new JsonRpcErrorResponse('session/list', -32601, 'Method not found'); },
        sessionId: 'session-1',
      })).resolves.toBe(false);
    });

    it('keeps the binding when the failure was not the agent answering', async () => {
      const listSessions = jest.fn();

      await expect(isAcpSessionGone({
        error: new Error('write EPIPE'),
        listSessions,
        sessionId: 'session-1',
      })).resolves.toBe(false);
      expect(listSessions).not.toHaveBeenCalled();
    });
  });
});
