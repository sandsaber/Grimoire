import {
  type CodexConversationBinding,
  readCodexConversationBinding,
  toCodexThreadIntent,
} from '@/providers/codex/execution/CodexConversationBinding';

/**
 * Which thread the next Codex turn belongs to.
 *
 * The legacy runtime decided this in `syncConversationState` and the flip has
 * to decide it identically, because getting it wrong is not a visible error: a
 * fork downgraded to a resume answers on the wrong thread, and a resume
 * downgraded to a new thread loses the conversation while looking like a
 * perfectly good reply.
 */
describe('Codex conversation binding', () => {
  function binding(conversation: unknown): CodexConversationBinding {
    return readCodexConversationBinding(conversation as never);
  }

  it('starts a new thread when the conversation has none', () => {
    expect(binding(null)).toEqual({ kind: 'none' });
    expect(binding({ id: 'c1' })).toEqual({ kind: 'none' });
    expect(binding({ id: 'c1', sessionId: null, providerState: {} })).toEqual({ kind: 'none' });
  });

  it('resumes the thread the conversation remembers', () => {
    expect(binding({ id: 'c1', providerState: { threadId: 'thread-7' } }))
      .toEqual({ kind: 'thread', threadId: 'thread-7' });
    // The neutral column carries it for conversations written before the
    // provider kept its own copy.
    expect(binding({ id: 'c1', sessionId: 'thread-8', providerState: {} }))
      .toEqual({ kind: 'thread', threadId: 'thread-8' });
    // Where both exist the provider's own copy wins, because that is the one
    // Codex can act on.
    expect(binding({ id: 'c1', sessionId: 'stale', providerState: { threadId: 'thread-9' } }))
      .toEqual({ kind: 'thread', threadId: 'thread-9' });
  });

  it('takes a pending fork before anything reads a thread id', () => {
    expect(binding({
      id: 'c1',
      sessionId: null,
      providerState: { forkSource: { sessionId: 'source-thread', resumeAt: 'turn-4' } },
    })).toEqual({ kind: 'fork', sourceThreadId: 'source-thread', resumeAtTurnId: 'turn-4' });
  });

  it('maps each binding to the intent the backend acts on', () => {
    const params = {
      start: { model: 'gpt-5.3-codex', cwd: '/vault', approvalPolicy: 'never', sandbox: 'danger' },
      resume: { model: 'gpt-5.3-codex', baseInstructions: 'be brief' },
    };

    expect(toCodexThreadIntent({ kind: 'none' }, params))
      .toEqual({ kind: 'new', params: params.start });
    expect(toCodexThreadIntent({ kind: 'thread', threadId: 'thread-7' }, params))
      .toEqual({ kind: 'resume', threadId: 'thread-7', params: params.resume });
    expect(toCodexThreadIntent(
      { kind: 'fork', sourceThreadId: 'source', resumeAtTurnId: 'turn-4' },
      params,
    )).toEqual({
      kind: 'fork',
      sourceThreadId: 'source',
      resumeAtTurnId: 'turn-4',
      resumeParams: params.resume,
    });
  });

  it('leaves "already loaded" to the backend rather than deciding it here', () => {
    // The legacy runtime had a third branch — bound thread already loaded in
    // this daemon, so start a turn without resuming — and the backend now owns
    // that, tracking which thread its session loaded. Deciding it here too
    // would be a second opinion about state this module cannot see, and the two
    // would disagree the first time a daemon restarted under a live tab.
    const params = {
      start: { model: 'm', cwd: '/vault', approvalPolicy: 'never', sandbox: 'danger' },
      resume: {},
    };

    expect(toCodexThreadIntent({ kind: 'thread', threadId: 'thread-7' }, params).kind)
      .toBe('resume');
  });

  it('stops treating a fork as pending once its thread exists', () => {
    // The half that silently rots. A fork already taken must not be taken
    // again: the conversation would fork the source a second time, roll back
    // to the same checkpoint, and answer on a thread that is not the one the
    // user has been reading.
    const forked = {
      id: 'c1',
      sessionId: 'forked-thread',
      providerState: {
        threadId: 'forked-thread',
        forkSource: { sessionId: 'source-thread', resumeAt: 'turn-4' },
      },
    };

    expect(binding(forked)).toEqual({ kind: 'thread', threadId: 'forked-thread' });
    expect(binding({ ...forked, providerState: { forkSource: forked.providerState.forkSource } }))
      .toEqual({ kind: 'thread', threadId: 'forked-thread' });
  });
});
