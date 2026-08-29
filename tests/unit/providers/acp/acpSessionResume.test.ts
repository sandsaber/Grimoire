import { JsonRpcErrorResponse } from '@/providers/acp/AcpJsonRpcTransport';
import {
  buildAcpPersistedSessionFields,
  buildAcpSessionLoadFailureDebugEvent,
  clearAcpManagedSessionState,
  isAcpMissingSessionError,
  isAcpSessionGone,
  markAcpSessionLoadFailed,
} from '@/providers/acp/acpSessionResume';

describe('acpSessionResume', () => {
  it('clears session bindings while optionally preserving the database path', () => {
    const state = {
      currentDatabasePath: '/data/opencode.db',
      loadedSessionId: 'loaded-1',
      sessionId: 'session-1',
      sessionInvalidated: false,
    };

    clearAcpManagedSessionState(state, { preserveDatabasePath: true });
    expect(state).toEqual({
      currentDatabasePath: '/data/opencode.db',
      loadedSessionId: null,
      sessionId: null,
      sessionInvalidated: false,
    });

    clearAcpManagedSessionState(state);
    expect(state.currentDatabasePath).toBeNull();
  });

  it('marks a failed load as invalidated without dropping the database path', () => {
    const state = {
      currentDatabasePath: '/data/opencode.db',
      loadedSessionId: 'loaded-1',
      sessionId: 'session-1',
      sessionInvalidated: false,
    };

    markAcpSessionLoadFailed(state);
    expect(state.sessionInvalidated).toBe(true);
    expect(state.sessionId).toBeNull();
    expect(state.currentDatabasePath).toBe('/data/opencode.db');
  });

  it('keeps databasePath when persisting an invalidated session without a replacement id', () => {
    expect(buildAcpPersistedSessionFields({
      conversationDatabasePath: '/old/opencode.db',
      currentDatabasePath: null,
      sessionId: null,
      sessionInvalidated: true,
    })).toEqual({
      databasePath: '/old/opencode.db',
      sessionDropped: true,
      sessionId: null,
    });

    expect(buildAcpPersistedSessionFields({
      conversationDatabasePath: '/old/opencode.db',
      currentDatabasePath: '/new/opencode.db',
      sessionId: 'session-2',
      sessionInvalidated: false,
    })).toEqual({
      databasePath: '/new/opencode.db',
      sessionDropped: false,
      sessionId: 'session-2',
    });
  });

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

  it('carries a dropped session across saves until a replacement is persisted', () => {
    // The first save consumes the in-memory flag, so every later save reports
    // false; the marker has to keep the answer until a real session lands.
    const afterDrop = buildAcpPersistedSessionFields({
      conversationDatabasePath: '/old/opencode.db',
      currentDatabasePath: null,
      sessionId: null,
      sessionInvalidated: true,
    });
    expect(afterDrop.sessionDropped).toBe(true);

    const afterSecondSave = buildAcpPersistedSessionFields({
      conversationDatabasePath: '/old/opencode.db',
      conversationSessionDropped: afterDrop.sessionDropped,
      currentDatabasePath: null,
      sessionId: null,
      sessionInvalidated: false,
    });
    expect(afterSecondSave.sessionDropped).toBe(true);

    const afterReplacement = buildAcpPersistedSessionFields({
      conversationDatabasePath: '/old/opencode.db',
      conversationSessionDropped: true,
      currentDatabasePath: null,
      sessionId: 'session-2',
      sessionInvalidated: false,
    });
    expect(afterReplacement.sessionDropped).toBe(false);
    expect(afterReplacement.sessionId).toBe('session-2');
  });

  it('builds a structured debug event for session load failures', () => {
    const event = buildAcpSessionLoadFailureDebugEvent({
      cwd: '/vault',
      databasePath: '/data/opencode.db',
      error: new Error('session missing'),
      providerId: 'opencode',
      sessionId: 'abcdefghijklmno',
      stderr: 'boom',
    });

    expect(event.event).toBe('session.load_failed');
    expect(event.level).toBe('warn');
    expect(event.scope).toBe('provider.opencode');
    expect(event.data).toEqual(expect.objectContaining({
      cwdLabel: '/vault',
      errorSummary: 'session missing',
      provider: 'opencode',
      reason: 'session_load_failed',
      status: 'abcdefghijkl',
      stderrPreview: 'boom',
    }));
  });

  it.each([
    new JsonRpcErrorResponse('session/load', -32001, 'Session not found: session-1'),
    new JsonRpcErrorResponse('loadSession', -32000, 'Unable to load session', {
      reason: 'session_not_found',
    }),
    new JsonRpcErrorResponse('session/load', -32602, 'Invalid session id'),
  ])('recognizes explicit missing-session JSON-RPC errors', (error) => {
    expect(isAcpMissingSessionError(error)).toBe(true);
  });

  it.each([
    new JsonRpcErrorResponse('session/load', -32000, 'Authentication failed'),
    new JsonRpcErrorResponse('session/load', -32000, 'Connection timed out'),
    new JsonRpcErrorResponse('session/new', -32001, 'Session not found'),
    new Error('Session not found'),
  ])('does not classify transient or unrelated failures as missing sessions', (error) => {
    expect(isAcpMissingSessionError(error)).toBe(false);
  });
});
