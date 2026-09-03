import { recordAcpWire } from '@test/helpers/recordAcpWire';

/**
 * The wire recordings each flip is blocked on.
 *
 * The plan puts a recording before a flip. Wave 6 needed two — MiMoCode's was
 * partial and Kimi Code's was absent — and wave 7 needs two more: neither Qwen
 * Code nor Gemini CLI has ever been recorded. Off by default because it starts
 * a CLI and spends whatever the account has; run it with
 * `GRIMOIRE_WIRE_RECORD=1`, and it rewrites the fixtures in place.
 *
 * Recording *is* the assertion here. A recording of nothing would be worse than
 * none, because it would look taken — so each row requires the CLI to have
 * answered, and the recorder writes down which half of the protocol the account
 * could reach rather than letting a thin capture read as a whole one.
 */
const record = process.env.GRIMOIRE_WIRE_RECORD === '1' ? describe : describe.skip;

record('ACP wire recordings', () => {
  // A row is one handshake plus one turn, and the turn's own bound is ten
  // minutes: a Gemini turn has really taken five, and a run that cut one off
  // wrote down that the account could not generate.
  jest.setTimeout(900_000);

  it('records what MiMoCode answers', async () => {
    const recording = await recordAcpWire({
      providerId: 'mimocode',
      command: process.env.GRIMOIRE_MIMOCODE_CLI ?? 'mimo',
      args: ['acp'],
      transport: 'stdio JSON-RPC 2.0 (`mimo acp`)',
    });

    expect((recording.exchange as unknown[]).length).toBeGreaterThan(1);
    expect(recording.recordedAgainst).toMatch(/\d+\.\d+/);
  });

  it('records what Kimi Code answers', async () => {
    const recording = await recordAcpWire({
      providerId: 'kimicode',
      command: process.env.GRIMOIRE_KIMICODE_CLI ?? 'kimi',
      args: ['acp'],
      transport: 'stdio JSON-RPC 2.0 (`kimi acp`)',
    });

    expect((recording.exchange as unknown[]).length).toBeGreaterThan(1);
    expect(recording.recordedAgainst).toMatch(/\d+\.\d+/);
  });

  // Wave 7's two, and the first difference between the waves is on the command
  // line: these are spoken to through a *flag* rather than a subcommand.
  it('records what Qwen Code answers', async () => {
    const recording = await recordAcpWire({
      providerId: 'qwen',
      command: process.env.GRIMOIRE_QWEN_CLI ?? 'qwen',
      args: ['--acp'],
      transport: 'stdio JSON-RPC 2.0 (`qwen --acp`)',
    });

    expect((recording.exchange as unknown[]).length).toBeGreaterThan(1);
    expect(recording.recordedAgainst).toMatch(/\d+\.\d+/);
  });

  it('records what Gemini CLI answers', async () => {
    const recording = await recordAcpWire({
      providerId: 'gemini',
      command: process.env.GRIMOIRE_GEMINI_CLI ?? 'gemini',
      args: ['--acp'],
      transport: 'stdio JSON-RPC 2.0 (`gemini --acp`)',
    });

    expect((recording.exchange as unknown[]).length).toBeGreaterThan(1);
    expect(recording.recordedAgainst).toMatch(/\d+\.\d+/);
  });
});
