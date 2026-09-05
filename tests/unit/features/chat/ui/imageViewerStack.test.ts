import {
  closeTopmostImageViewer,
  registerOpenImageViewer,
  resetOpenImageViewers,
} from '@/features/chat/ui/imageViewerStack';

describe('imageViewerStack', () => {
  beforeEach(() => {
    resetOpenImageViewers();
  });

  it('reports nothing to close on a quiet chat', () => {
    expect(closeTopmostImageViewer()).toBe(false);
  });

  it('closes a registered viewer and says so', () => {
    const close = jest.fn();
    registerOpenImageViewer(close);

    expect(closeTopmostImageViewer()).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes viewers one at a time, most recent first', () => {
    const order: string[] = [];
    const first = jest.fn(() => { order.push('first'); });
    const second = jest.fn(() => { order.push('second'); });
    registerOpenImageViewer(first);
    registerOpenImageViewer(second);

    expect(closeTopmostImageViewer()).toBe(true);
    expect(order).toEqual(['second']);

    expect(closeTopmostImageViewer()).toBe(true);
    expect(order).toEqual(['second', 'first']);

    expect(closeTopmostImageViewer()).toBe(false);
  });

  it('stops reporting a viewer that closed itself', () => {
    const unregister = registerOpenImageViewer(jest.fn());
    unregister();

    expect(closeTopmostImageViewer()).toBe(false);
  });

  it('tolerates a repeated unregister', () => {
    const unregister = registerOpenImageViewer(jest.fn());
    unregister();

    expect(() => unregister()).not.toThrow();
    expect(closeTopmostImageViewer()).toBe(false);
  });

  it('does not keep a dead entry when a viewer fails to unregister itself', () => {
    // The production `close` unregisters first, but a stale entry would make
    // every later Escape close a phantom and stop cancelling the turn.
    registerOpenImageViewer(jest.fn());

    expect(closeTopmostImageViewer()).toBe(true);
    expect(closeTopmostImageViewer()).toBe(false);
  });

  it('drops only the viewer it closed when that viewer unregisters itself', () => {
    const first = jest.fn();
    registerOpenImageViewer(first);
    let unregisterSecond = (): void => {};
    const second = jest.fn(() => { unregisterSecond(); });
    unregisterSecond = registerOpenImageViewer(second);

    expect(closeTopmostImageViewer()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);

    expect(closeTopmostImageViewer()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
  });
});
