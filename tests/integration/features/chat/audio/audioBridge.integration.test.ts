/** @jest-environment jsdom */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { AudioBridgeClient } from '@/app/audio/AudioBridgeClient';
import { AudioDictation } from '@/features/chat/audio/AudioDictation';

const live = process.env.GRIMOIRE_AUDIO_ACCEPTANCE === '1' ? describe : describe.skip;

live('installed Audio bridge to the Grimoire composer without microphone', () => {
  jest.setTimeout(120000);
  const executable = '/usr/bin/grimoire-audio';
  const wav = process.env.GRIMOIRE_AUDIO_WAV!;
  const clients: AudioBridgeClient[] = [];
  const controllers: AudioDictation[] = [];
  const inputs: HTMLTextAreaElement[] = [];
  const metrics: Record<string, unknown> = {};
  function connect() { const client = new AudioBridgeClient(executable); clients.push(client); return client; }
  function status() {
    return JSON.parse(execFileSync(executable, ['status', '--json'], { encoding: 'utf8' })) as {
      pid: number; status: { engineLoads: number; listening: boolean; hasResult: boolean; client: unknown };
    };
  }
  afterAll(() => {
    controllers.forEach(controller => controller.dispose());
    clients.forEach(client => client.close()); inputs.forEach(input => input.remove());
    if (process.env.GRIMOIRE_AUDIO_METRICS) writeFileSync(process.env.GRIMOIRE_AUDIO_METRICS, JSON.stringify(metrics, null, 2));
  });

  it('inserts actual ASR into the bound draft and discards a cancelled late job', async () => {
    const first = connect(); await first.ready();
    const before = status();
    expect(before.pid === Number(process.env.GRIMOIRE_AUDIO_EXPECTED_PID)).toBe(true);
    const text = await first.transcribeFile(wav);
    expect(text.trim().length > 0).toBe(true);
    const input = document.createElement('textarea'); document.body.append(input); inputs.push(input);
    input.value = 'left 🙂 | right'; input.setSelectionRange(8, 8);
    const original = input.value; const caret = input.selectionStart;
    const submit = jest.fn(); const keyboard = jest.fn(); input.addEventListener('submit', submit); input.addEventListener('keydown', keyboard);
    const native = connect();
    const notices: string[] = [];
    const controller = new AudioDictation({ input, context: () => 'owned draft', available: () => true },
      () => ({ ready: () => native.ready(), start: accepted => { accepted(); return native.transcribeFile(wav); },
        stop: () => native.stop(), close: () => native.close() }), jest.fn(), message => notices.push(message));
    controllers.push(controller);
    await controller.toggle();
    expect(input.value === original.slice(0, caret) + text + original.slice(caret)).toBe(true);
    expect(input.selectionStart === caret + text.length && input.selectionEnd === input.selectionStart).toBe(true);
    expect(submit.mock.calls.length === 0 && keyboard.mock.calls.length === 0 && notices.length === 0).toBe(true);
    metrics.exactUnicodeDraftAndCaret = true; metrics.submitEvents = 0; metrics.keyboardEvents = 0;

    const cancelledClient = connect(); let accepted!: () => void;
    const started = new Promise<void>(resolve => { accepted = resolve; });
    const cancelled = new AudioDictation({ input, context: () => 'owned draft', available: () => true },
      () => ({ ready: () => cancelledClient.ready(), start: callback => {
        callback(); const response = cancelledClient.transcribeFile(wav); accepted(); return response;
      }, stop: () => cancelledClient.stop(), close: () => cancelledClient.close() }), jest.fn(), jest.fn());
    controllers.push(cancelled);
    const expected = input.value;
    const pending = cancelled.toggle(); await started;
    const admission = Date.now() + 5000;
    while (status().status.client == null && Date.now() < admission) await new Promise(resolve => window.setTimeout(resolve, 20));
    expect(status().status.client != null).toBe(true);
    cancelled.cancel(); await pending;
    expect(input.value === expected).toBe(true);
    // Wait until the shared core has released the cancelled job before a new request.
    const probe = connect(); await probe.ready().catch(() => undefined);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try { await probe.ready(); break; } catch { await new Promise(resolve => window.setTimeout(resolve, 50)); }
    }
    const recovered = await probe.transcribeFile(wav);
    expect(recovered === text).toBe(true);
    const after = status();
    expect(after.pid === before.pid && after.status.engineLoads === before.status.engineLoads && !after.status.listening).toBe(true);
    metrics.cancelSuppressesInsertion = true; metrics.recoveryAfterCancel = true;
    metrics.sameResidentGuiPid = true; metrics.engineLoads = after.status.engineLoads;
    metrics.microphone = false; metrics.transcriptRetained = false;
  });
});
