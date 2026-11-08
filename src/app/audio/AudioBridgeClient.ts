import { type ChildProcessWithoutNullStreams,spawn } from 'node:child_process';
import { accessSync,constants } from 'node:fs';
import { resolve } from 'node:path';
import { TextDecoder } from 'node:util';

import { getEnhancedPath } from '../../utils/env';
import { resolveCliExecutable, resolveCliFile } from '../../utils/resolveCliExecutable';

export interface AudioMessage {
  v: number;
  id?: number;
  event: string;
  code?: string;
  text?: string;
  provider?: string;
  status?: { ready?: boolean; provider?: string; phase?: string; client?: unknown; hasResult?: boolean; listening?: boolean };
}

const errors: Record<string, string> = {
  busy: 'Grimoire Audio is busy with another request.',
  not_ready: 'Prepare a local model in Grimoire Audio, then try again.',
  not_owner: 'This dictation no longer owns the Audio request.',
  unavailable: 'Grimoire Audio is unavailable.',
  recognition_failed: 'Audio could not recognize speech. Check Grimoire Audio and try again.',
  provider_mismatch: 'Select Local recognition in Grimoire Audio to use dictation here.',
};

class AudioRequestError extends Error {
  constructor(readonly code: string) { super(errors[code] ?? 'Audio could not complete the request.'); }
}

export function resolveAudioExecutable(configured = ''): string {
  const file = configured.trim()
    ? resolveCliFile(configured)
    : resolveCliExecutable('grimoire-audio', [], '', {
      fallbackPaths: process.platform === 'darwin'
        ? ['/Applications/Grimoire Audio Prototype.app/Contents/MacOS/grimoire-audio'] : [],
    });
  if (!file) throw new Error('Install Grimoire Audio or set its executable in Grimoire settings.');
  if (process.platform === 'win32' && !file.toLowerCase().endsWith('.exe')) {
    throw new Error('Select the native Grimoire Audio .exe file.');
  }
  try { accessSync(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK); }
  catch { throw new Error('The Grimoire Audio executable is not accessible.'); }
  return resolve(file);
}

interface Pending {
  resolve: (value: AudioMessage) => void;
  reject: (error: Error) => void;
  accepted?: () => void;
  timer: number;
}

/** One bridge connection owns one dictation. Never replay an accepted request. */
export class AudioBridgeClient {
  private child: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private sequence = 0;
  private job: number | null = null;
  private buffer = '';
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private closed = false;

  constructor(executable: string) {
    this.child = spawn(executable, ['--bridge'], {
      shell: false, windowsHide: true, stdio: 'pipe',
      env: { ...process.env, PATH: getEnhancedPath() },
    });
    this.child.stdout.on('data', (chunk: Buffer) => this.read(chunk));
    // Stderr is not recognized text and can contain sensitive native diagnostics.
    this.child.stderr.resume();
    this.child.on('error', () => this.fail('Could not start Grimoire Audio. Check its executable.'));
    this.child.stdin.on('error', () => this.fail('The Audio connection closed. Start a new dictation.'));
    this.child.on('exit', () => this.fail('The Audio connection closed. Start a new dictation.'));
  }

  private read(chunk: Buffer): void {
    if (this.closed) return;
    try { this.buffer += this.decoder.decode(chunk, { stream: true }); }
    catch { return this.fail('Audio returned invalid UTF-8.'); }
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (Buffer.byteLength(line) > 65536) return this.fail('Audio returned an oversized response.');
      let message: AudioMessage;
      try { message = JSON.parse(line) as AudioMessage; }
      catch { return this.fail('Audio returned an invalid response.'); }
      if (!message || message.v !== 1 || typeof message.event !== 'string' ||
          !Number.isSafeInteger(message.id) || !this.pending.has(message.id!)) {
        return this.fail('Audio returned an unexpected response.');
      }
      const pending = this.pending.get(message.id!)!;
      if (message.event === 'accepted' && pending.accepted) {
        pending.accepted();
        pending.accepted = undefined;
        continue;
      }
      if (pending.accepted && message.event !== 'error') return this.fail('Audio skipped request acceptance.');
      this.pending.delete(message.id!);
      window.clearTimeout(pending.timer);
      if (message.event === 'error' || message.event === 'protocol_error') {
        pending.reject(new AudioRequestError(message.code ?? 'unknown'));
      } else if (message.event === 'cancelled') {
        pending.reject(new Error('Dictation cancelled.'));
      } else pending.resolve(message);
    }
    if (Buffer.byteLength(this.buffer) > 65536) this.fail('Audio returned an oversized response.');
  }

  private request(op: string, fields: Record<string, unknown> = {}, accepted?: () => void): Promise<AudioMessage> {
    if (this.closed) return Promise.reject(new Error('The Audio connection is closed.'));
    const id = ++this.sequence;
    if (op === 'start' || op === 'transcribe_wav') this.job = id;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => this.fail('Audio timed out. Start a new dictation.'), accepted ? 300000 : 30000);
      this.pending.set(id, { resolve, reject, accepted, timer });
      this.child.stdin.write(JSON.stringify({ v: 1, id, op, ...fields }) + '\n');
    });
  }

  async ready(): Promise<void> {
    const deadline = Date.now() + 30000;
    do {
      const response = await this.request('status');
      if (response.event !== 'status' || !response.status) throw new Error('Audio returned an invalid status.');
      const status = response.status;
      if (status.phase === 'loading') {
        await new Promise(resolve => window.setTimeout(resolve, 100));
        continue;
      }
      if (status.provider !== 'local') throw new Error(errors.provider_mismatch);
      if (typeof status.listening !== 'boolean') throw new Error('Update Grimoire Audio before using dictation here.');
      if (status.client != null || status.hasResult) throw new Error(errors.busy);
      if (status.ready !== true) throw new Error(errors.not_ready);
      return;
    } while (Date.now() < deadline);
    throw new Error('Audio is still loading. Try again when it is ready.');
  }

  async start(accepted: () => void, processing?: () => void): Promise<string> {
    let finished = false;
    let listeningReported = false;
    let processingReported = false;
    let timer: number | null = null;
    const observe = async (): Promise<void> => {
      try {
        const status = await this.request('status');
        if (finished || this.closed) return;
        if (status.event !== 'status' || !status.status) throw new Error('Invalid capture status');
        if (status.status.listening === true && !listeningReported) { accepted(); listeningReported = true; }
        if (!status.status.listening && (listeningReported || status.status.phase === 'processing') && !processingReported) {
          processing?.(); processingReported = true;
        }
        timer = window.setTimeout(() => { void observe(); }, 200);
      } catch {
        if (!finished && !this.closed) this.fail('Could not confirm Audio capture activity.');
      }
    };
    try {
      return this.result(await this.request('start', { provider: 'local' }, () => { void observe(); }));
    } finally {
      finished = true;
      if (timer !== null) window.clearTimeout(timer);
    }
  }

  async stop(): Promise<void> {
    if (this.job === null) return;
    try {
      const response = await this.request('stop', { job: this.job });
      if (response.event !== 'accepted') throw new Error('Audio did not accept Stop.');
    } catch (error) {
      // The capture limit can finish capture just before the user's Stop arrives.
      if (error instanceof AudioRequestError && error.code === 'invalid_state' &&
          this.job !== null && this.pending.has(this.job)) {
        const state = await this.request('status');
        if (state.event === 'status' && state.status?.phase === 'processing' && !state.status.listening) return;
      }
      throw error;
    }
  }

  /** File-only acceptance uses the same response path; the product UI never invokes this. */
  async transcribeFile(path: string): Promise<string> {
    return this.result(await this.request('transcribe_wav', { path, provider: 'local' }, () => {}));
  }

  private result(response: AudioMessage): string {
    if (response.event !== 'result' || response.provider !== 'local' || typeof response.text !== 'string' ||
        !response.text.trim() || response.text.length > 65536) throw new Error('Audio returned no usable local transcription.');
    this.job = null;
    return response.text;
  }

  private fail(message: string): void {
    for (const pending of this.pending.values()) { window.clearTimeout(pending.timer); pending.reject(new Error(message)); }
    this.pending.clear();
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { window.clearTimeout(pending.timer); pending.reject(new Error('Dictation cancelled.')); }
    this.pending.clear();
    this.child.stdin.end(); // EOF cancels only this connection's unfinished job.
    const child = this.child;
    const timer = window.setTimeout(() => { if (child.exitCode === null) child.kill(); }, 1000);
    child.once('exit', () => window.clearTimeout(timer));
  }
}
