/** @jest-environment jsdom */
import { AudioDictation } from '@/features/chat/audio/AudioDictation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('draft-bound Audio dictation', () => {
  let input: HTMLTextAreaElement;
  let controller: AudioDictation;
  let result: ReturnType<typeof deferred<string>>;
  let ready: ReturnType<typeof deferred<void>>;
  let context: string;
  let available: boolean;
  let close: jest.Mock;
  let stop: jest.Mock;
  let start: jest.Mock;
  let notice: jest.Mock;
  beforeEach(() => {
    input = document.createElement('textarea'); document.body.append(input);
    input.value = 'before 🙂 after'; input.setSelectionRange(9, 9);
    result = deferred<string>(); ready = deferred<void>(); context = 'draft-1'; available = true;
    close = jest.fn(); stop = jest.fn().mockResolvedValue(undefined); notice = jest.fn();
    start = jest.fn((accepted: () => void) => { accepted(); return result.promise; });
    controller = new AudioDictation({ input, context: () => context, available: () => available },
      () => ({ ready: () => ready.promise, start, close, stop }), jest.fn(), notice);
  });
  afterEach(() => { controller.dispose(); input.remove(); });

  it('inserts Unicode at the original caret, emits input and never emits submit or Enter', async () => {
    const original = input.value; const caret = input.selectionStart;
    const changed = jest.fn(); const key = jest.fn(); const submit = jest.fn();
    input.addEventListener('input', changed); input.addEventListener('keydown', key); input.addEventListener('submit', submit);
    const work = controller.toggle(); ready.resolve(); await Promise.resolve();
    await controller.toggle(); expect(stop).toHaveBeenCalledTimes(1);
    result.resolve('speech\n中文'); await work;
    expect(input.value).toBe(original.slice(0, caret) + 'speech\n中文' + original.slice(caret));
    expect(input.selectionStart).toBe(caret + 'speech\n中文'.length);
    expect(changed).toHaveBeenCalledTimes(1); expect(key).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each(['cancel', 'edit', 'caret', 'context', 'hidden', 'readonly', 'dispose'])(
    'discards a late result after %s', async kind => {
      const work = controller.toggle(); ready.resolve(); await Promise.resolve();
      if (kind === 'cancel') controller.cancel();
      if (kind === 'edit') { input.value += '!'; input.dispatchEvent(new Event('input')); }
      if (kind === 'caret') input.setSelectionRange(0, 0);
      if (kind === 'context') context = 'draft-2';
      if (kind === 'hidden') available = false;
      if (kind === 'readonly') input.readOnly = true;
      if (kind === 'dispose') controller.dispose();
      const expected = input.value;
      result.resolve('late'); await work;
      expect(input.value).toBe(expected); expect(close).toHaveBeenCalled();
    });

  it('cancels edit-and-restore rather than accepting the original value again', async () => {
    const original = input.value; const work = controller.toggle(); ready.resolve(); await Promise.resolve();
    input.value += 'x'; input.dispatchEvent(new Event('input'));
    input.value = original; result.resolve('late'); await work;
    expect(input.value).toBe(original);
  });

  it('cancel during initialization never starts capture', async () => {
    const work = controller.toggle(); controller.cancel(); ready.resolve(); await work;
    expect(start).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
  });

  it('refuses selection replacement and permits recovery after missing Audio', async () => {
    input.setSelectionRange(0, 2); await controller.toggle(); expect(start).not.toHaveBeenCalled();
    input.setSelectionRange(0, 0); const work = controller.toggle(); ready.reject(new Error('Audio missing')); await work;
    expect(notice).toHaveBeenCalledWith('Audio missing'); expect(controller.isActive()).toBe(false);
  });
});
