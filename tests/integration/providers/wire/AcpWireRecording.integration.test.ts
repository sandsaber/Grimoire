import { recordAcpWire } from '@test/helpers/recordAcpWire';

/**
 * The wire recordings wave 6 is blocked on.
 *
 * The plan puts a recording before a flip, and both providers of this wave
 * needed one: MiMoCode's was partial and Kimi Code's was absent. Off by
 * default because it starts a CLI and spends whatever the account has; run it
 * with `GRIMOIRE_WIRE_RECORD=1`, and it rewrites the fixtures in place.
 *
 * Recording *is* the assertion here. A recording of nothing would be worse than
 * none, because it would look taken — so each row requires the CLI to have
 * answered, and the recorder writes down which half of the protocol the account
 * could reach rather than letting a thin capture read as a whole one.
 */
const record = process.env.GRIMOIRE_WIRE_RECORD === '1' ? describe : describe.skip;

record('ACP wire recordings', () => {
  jest.setTimeout(180_000);

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
});
