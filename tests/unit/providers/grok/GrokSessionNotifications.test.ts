import grokWire from '@test/fixtures/provider-traces/wire/grok-wire.json';

import { GrokSessionNotificationMirrorDeduplicator } from '@/providers/grok/runtime/GrokSessionNotificationMirrorDeduplicator';
import {
  GROK_SESSION_UPDATE_NOTIFICATION_METHODS,
  GROK_WRAPPED_SESSION_NOTIFICATION_METHOD,
  parseGrokSessionNotification,
} from '@/providers/grok/runtime/GrokSessionNotifications';

describe('GrokSessionNotifications', () => {
  const notification = {
    sessionId: 'session-1',
    update: {
      content: { text: 'hello', type: 'text' },
      sessionUpdate: 'agent_message_chunk',
    },
  };

  it.each(GROK_SESSION_UPDATE_NOTIFICATION_METHODS)(
    'accepts the direct %s session update alias',
    (method) => {
      expect(parseGrokSessionNotification(method, notification)).toEqual(notification);
    },
  );

  it('unwraps the xAI session notification envelope', () => {
    expect(parseGrokSessionNotification(GROK_WRAPPED_SESSION_NOTIFICATION_METHOD, {
      method: 'x.ai/session_notification',
      params: notification,
    })).toEqual(notification);
    // An envelope naming some other method is not this one, and its params are
    // not a notification either.
    expect(parseGrokSessionNotification(GROK_WRAPPED_SESSION_NOTIFICATION_METHOD, {
      method: '_x.ai/session_notification',
      params: notification,
    })).toBeNull();
  });

  it('accepts the shape the CLI actually sends', () => {
    // From `tests/fixtures/provider-traces/wire/grok-wire.json`: 1.0.5 sends the
    // notification directly as the params of `_x.ai/session_notification`, with
    // no inner `method` at all. Requiring one dropped every update Grok sends
    // this way — the turn's usage and its stop reason among them.
    const wrapped = readGrokWrappedNotifications();

    expect(wrapped.length).toBeGreaterThan(0);
    for (const params of wrapped) {
      expect(parseGrokSessionNotification(GROK_WRAPPED_SESSION_NOTIFICATION_METHOD, params))
        .toEqual(params);
    }
    expect(wrapped.map(entry => (entry.update as { sessionUpdate: string }).sessionUpdate))
      .toEqual(expect.arrayContaining(['model_changed', 'response_completed', 'turn_completed']));
  });

  it('rejects malformed and unrelated notifications', () => {
    expect(parseGrokSessionNotification('session/update', notification)).toBeNull();
    expect(parseGrokSessionNotification('_x.ai/session/update', {
      sessionId: 'session-1',
      update: null,
    })).toBeNull();
    expect(parseGrokSessionNotification('_x.ai/session/update', {
      sessionId: ' ',
      update: notification.update,
    })).toBeNull();
  });

});

describe('GrokSessionNotificationMirrorDeduplicator', () => {
  const notification = {
    sessionId: 'session-1',
    update: {
      content: { text: 'hello', type: 'text' },
      sessionUpdate: 'agent_message_chunk',
    },
  };

  it('suppresses copies mirrored across standard, direct, and wrapped channels', () => {
    const deduplicator = new GrokSessionNotificationMirrorDeduplicator();

    expect(deduplicator.shouldProcess(notification, 'standard')).toBe(true);
    expect(deduplicator.shouldProcess(notification, 'x.ai/session/update')).toBe(false);
    expect(deduplicator.shouldProcess(notification, '_x.ai/session_notification')).toBe(false);
  });

  it('preserves identical consecutive chunks from the same channel', () => {
    const deduplicator = new GrokSessionNotificationMirrorDeduplicator();

    expect(deduplicator.shouldProcess(notification, 'standard')).toBe(true);
    expect(deduplicator.shouldProcess(notification, 'standard')).toBe(true);
  });

  it('starts a fresh mirror candidate after reset', () => {
    const deduplicator = new GrokSessionNotificationMirrorDeduplicator();
    expect(deduplicator.shouldProcess(notification, 'standard')).toBe(true);
    deduplicator.reset();
    expect(deduplicator.shouldProcess(notification, 'x.ai/session/update')).toBe(true);
  });
});

/** Every `_x.ai/session_notification` the recording carried, as it carried it. */
function readGrokWrappedNotifications(): Array<{ sessionId: string; update: unknown }> {
  return grokWire.exchange.flatMap(entry => {
    const message = (entry as { message?: { method?: string; params?: unknown } }).message;
    return message?.method === '_x.ai/session_notification'
      ? [message.params as { sessionId: string; update: unknown }]
      : [];
  });
}
