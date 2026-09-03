import {
  closeTopmostImageViewer,
  hasOpenImageViewer,
  registerOpenImageViewer,
  resetOpenImageViewers,
} from '@/features/chat/ui/imageViewerStack';

describe('imageViewerStack', () => {
  beforeEach(() => {
    resetOpenImageViewers();
  });

  it('reports no open viewer on a quiet chat', () => {
    expect(hasOpenImageViewer()).toBe(false);
    expect(closeTopmostImageViewer()).toBe(false);
  });

  it('closes a registered viewer and says so', () => {
    const close = jest.fn();
    registerOpenImageViewer(close);

    expect(hasOpenImageViewer()).toBe(true);
    expect(closeTopmostImageViewer()).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes viewers one at a time, most recent first', () => {
    const order: string[] = [];
    const first = jest.fn(() => { order.push('first'); });
    const second = jest.fn(() => { order.push('second'); });
    const unregisterFirst = registerOpenImageViewer(first);
    const unregisterSecond = registerOpenImageViewer(second);

    closeTopmostImageViewer();
    unregisterSecond();
    closeTopmostImageViewer();
    unregisterFirst();

    expect(order).toEqual(['second', 'first']);
    expect(hasOpenImageViewer()).toBe(false);
  });

  it('stops reporting a viewer that closed itself', () => {
    const unregister = registerOpenImageViewer(jest.fn());
    unregister();

    expect(hasOpenImageViewer()).toBe(false);
    expect(closeTopmostImageViewer()).toBe(false);
  });

  it('tolerates a repeated unregister', () => {
    const unregister = registerOpenImageViewer(jest.fn());
    unregister();

    expect(() => unregister()).not.toThrow();
    expect(hasOpenImageViewer()).toBe(false);
  });
});
