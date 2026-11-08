import { Notice, setIcon, setTooltip } from 'obsidian';

import { AudioBridgeClient, resolveAudioExecutable } from '../../../app/audio/AudioBridgeClient';

export interface DictationSession {
  ready(): Promise<void>;
  start(accepted: () => void, processing?: () => void): Promise<string>;
  stop(): Promise<void>;
  close(): void;
}

export interface DictationTarget {
  input: HTMLTextAreaElement;
  context(): string;
  available(): boolean;
}

/** Owns the original draft/caret until one verified editor insertion or cancellation. */
export class AudioDictation {
  private generation = 0;
  private session: DictationSession | null = null;
  private phase: 'idle' | 'connecting' | 'recording' | 'processing' = 'idle';
  private snapshot: { text: string; caret: number; context: string } | null = null;
  private monitor: number | null = null;
  private inputChanged = () => { if (this.session) this.cancel(); };
  private selectionChanged = () => { if (this.session && !this.valid()) this.cancel(); };
  private disposed = false;

  constructor(private target: DictationTarget, private connect: () => DictationSession,
    private changed: (phase: string) => void, private notify: (message: string) => void,
    private cleanupUi: () => void = () => {}) {
    target.input.addEventListener('input', this.inputChanged);
    target.input.ownerDocument.addEventListener('selectionchange', this.selectionChanged);
  }

  private valid(): boolean {
    const { input } = this.target;
    return !!this.snapshot && !this.disposed && input.isConnected && !input.disabled && !input.readOnly &&
      this.target.available() && this.target.context() === this.snapshot.context && input.value === this.snapshot.text &&
      input.selectionStart === this.snapshot.caret && input.selectionEnd === this.snapshot.caret;
  }

  async toggle(): Promise<void> {
    if (this.phase === 'recording') {
      const generation = this.generation;
      this.phase = 'processing'; this.changed(this.phase);
      try { await this.session?.stop(); }
      catch (error) { if (generation === this.generation) this.failure(error); }
      return;
    }
    if (this.phase !== 'idle' || this.disposed) return;
    const { input } = this.target;
    if (!this.target.available() || input.disabled || input.readOnly || input.selectionStart !== input.selectionEnd) {
      this.notify('Place an empty caret in an editable draft before dictating.'); return;
    }
    const generation = ++this.generation;
    this.snapshot = { text: input.value, caret: input.selectionStart, context: this.target.context() };
    this.phase = 'connecting'; this.changed(this.phase);
    try {
      const session = this.connect();
      this.session = session;
      this.monitor = window.setInterval(this.selectionChanged, 100);
      await session.ready();
      if (generation !== this.generation || !this.valid()) return;
      const text = await session.start(() => {
        if (generation === this.generation && this.phase === 'connecting') { this.phase = 'recording'; this.changed(this.phase); }
      }, () => {
        if (generation === this.generation && this.phase !== 'processing') { this.phase = 'processing'; this.changed(this.phase); }
      });
      if (generation !== this.generation) return;
      if (!this.valid()) { this.notify('The draft or caret changed. Dictation was discarded.'); return; }
      const caret = this.snapshot.caret;
      if (input.maxLength >= 0 && input.value.length + text.length > input.maxLength) {
        throw new Error('The transcription exceeds this draft’s size limit.');
      }
      // No awaits between the final binding check and the editor operation.
      session.close();
      this.session = null;
      input.setRangeText(text, caret, caret, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (error) {
      if (generation === this.generation) this.notify(error instanceof Error ? error.message : 'Dictation failed.');
    } finally {
      if (generation === this.generation) this.cancel();
    }
  }

  isActive(): boolean { return this.phase !== 'idle'; }

  private failure(error: unknown): void {
    this.notify(error instanceof Error ? error.message : 'Dictation failed.');
    this.cancel();
  }

  cancel(): void {
    this.generation++;
    this.session?.close(); this.session = null;
    if (this.monitor !== null) window.clearInterval(this.monitor);
    this.monitor = null; this.snapshot = null; this.phase = 'idle'; this.changed(this.phase);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cancel();
    this.target.input.removeEventListener('input', this.inputChanged);
    this.target.input.ownerDocument.removeEventListener('selectionchange', this.selectionChanged);
    this.cleanupUi();
  }
}

export function mountAudioDictation(parent: HTMLElement, target: DictationTarget, executable: () => string): AudioDictation {
  const controls = parent.createDiv({ cls: 'grimoire-audio-controls' });
  const mic = controls.createEl('button', { cls: 'grimoire-icon-btn', attr: { type: 'button', 'aria-label': 'Start dictation with Grimoire Audio' } });
  const wrapper = target.input.parentElement ?? parent;
  const bar = wrapper.createDiv({ cls: 'grimoire-audio-status-row' });
  wrapper.insertBefore(bar, target.input.nextSibling);
  const status = bar.createSpan({ cls: 'grimoire-audio-status', attr: { role: 'status', 'aria-live': 'polite' } });
  const cancel = bar.createEl('button', { cls: 'grimoire-audio-cancel', text: 'Cancel dictation', attr: { type: 'button' } });
  const dictation = new AudioDictation(target, () => new AudioBridgeClient(resolveAudioExecutable(executable())), phase => {
    status.textContent = { idle: '', connecting: 'Preparing dictation…', recording: 'Dictating', processing: 'Recognizing…' }[phase] ?? '';
    mic.disabled = phase === 'connecting' || phase === 'processing';
    const label = phase === 'recording' ? 'Stop dictation' : phase === 'processing' ? 'Recognizing dictation' :
      phase === 'connecting' ? 'Preparing dictation' : 'Start dictation with Grimoire Audio';
    mic.setAttribute('aria-label', label); setTooltip(mic, label);
    setIcon(mic, phase === 'recording' ? 'square' : 'mic');
    cancel.hidden = phase === 'idle'; bar.hidden = phase === 'idle';
  }, message => { new Notice(message); }, () => { controls.remove(); bar.remove(); });
  for (const button of [mic, cancel]) button.addEventListener('mousedown', event => event.preventDefault());
  mic.addEventListener('click', () => { void dictation.toggle(); });
  cancel.addEventListener('click', () => dictation.cancel());
  setIcon(mic, 'mic'); setTooltip(mic, 'Start dictation with Grimoire Audio'); cancel.hidden = true; bar.hidden = true;
  return dictation;
}
