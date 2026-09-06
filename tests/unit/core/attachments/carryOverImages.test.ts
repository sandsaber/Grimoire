import { carryOverImageAttachments } from '@/core/attachments/carryOverImages';
import type { ChatMessage, ImageAttachment } from '@/core/types';

function image(id: string): ImageAttachment {
  return {
    data: '',
    hash: id.repeat(8).slice(0, 64),
    id,
    mediaType: 'image/png',
    name: `${id}.png`,
    size: 1024,
    source: 'paste',
  };
}

function user(content: string, images?: ImageAttachment[]): ChatMessage {
  return {
    content,
    id: `msg-${content}-${images?.length ?? 0}`,
    role: 'user',
    timestamp: 0,
    ...(images ? { images } : {}),
  };
}

function assistant(content: string): ChatMessage {
  return { content, id: `a-${content}`, role: 'assistant', timestamp: 0 };
}

describe('carryOverImageAttachments', () => {
  it('re-attaches a stored image to the matching hydrated turn', () => {
    const stored = [user('describe this', [image('a')]), assistant('A cat.')];
    const hydrated = [user('describe this'), assistant('A cat.')];

    const result = carryOverImageAttachments(stored, hydrated);

    expect(result[0].images).toHaveLength(1);
    expect(result[0].images?.[0].id).toBe('a');
    expect(result[1].images).toBeUndefined();
  });

  it('returns the hydrated messages untouched when nothing stored carried an image', () => {
    const hydrated = [user('describe this'), assistant('A cat.')];

    expect(carryOverImageAttachments([user('describe this')], hydrated)).toBe(hydrated);
  });

  it('keeps a repeated prompt aligned so only the turn that had an image gets one', () => {
    const stored = [
      user('describe this'),
      assistant('Nothing attached.'),
      user('describe this', [image('b')]),
      assistant('A cat.'),
    ];
    const hydrated = [
      user('describe this'),
      assistant('Nothing attached.'),
      user('describe this'),
      assistant('A cat.'),
    ];

    const result = carryOverImageAttachments(stored, hydrated);

    expect(result[0].images).toBeUndefined();
    expect(result[2].images?.[0].id).toBe('b');
  });

  it('matches on the text the user typed rather than the sent prompt', () => {
    const stored = [{
      ...user('describe this', [image('c')]),
      content: 'describe this\n\n<current_note>\nnotes/cat.md\n</current_note>',
      displayContent: 'describe this',
    }];
    const hydrated = [user('describe this')];

    expect(carryOverImageAttachments(stored, hydrated)[0].images?.[0].id).toBe('c');
  });

  it('leaves a hydrated turn that already carries its own image alone', () => {
    const stored = [user('describe this', [image('d')])];
    const hydrated = [user('describe this', [image('e')])];

    expect(carryOverImageAttachments(stored, hydrated)[0].images?.[0].id).toBe('e');
  });

  it('does not reach past an unmatched turn to attach an image to the wrong one', () => {
    const stored = [user('first', [image('f')])];
    const hydrated = [user('second')];

    expect(carryOverImageAttachments(stored, hydrated)[0].images).toBeUndefined();
  });
});
