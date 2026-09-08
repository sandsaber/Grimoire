import { describeAcpSessionOpenFailure } from '@/providers/acp/execution/describeAcpSessionOpenFailure';

describe('describeAcpSessionOpenFailure', () => {
  it('offers a new chat when the session a resumed conversation needs is gone', () => {
    const said = describeAcpSessionOpenFailure('Gemini');

    expect(said).toContain('Gemini');
    expect(said).toContain('starting a new chat will create one');
  });

  it('repeats what the agent said about a session it would not load', () => {
    const said = describeAcpSessionOpenFailure('Kimi Code', 'Authentication required');

    expect(said).toContain('Kimi Code said: Authentication required.');
  });

  // The sentence a first-run user actually met: a conversation created seconds
  // earlier, with no saved session behind it, told that its saved session may
  // no longer exist. The advice is unusable — the new chat it recommends fails
  // the same way — and it hides the startup that never finished.
  it('does not offer a new chat when the provider never finished starting', () => {
    const said = describeAcpSessionOpenFailure(
      'Gemini',
      'Managed ACP initialize timed out.',
      'startup',
    );

    expect(said).toContain('Gemini');
    expect(said).not.toContain('starting a new chat will create one');
    expect(said).not.toContain('session may no longer exist');
    expect(said).toContain('a new chat will not help');
  });
});
