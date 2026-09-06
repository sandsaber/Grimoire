import { setIcon } from 'obsidian';

import { t } from '../../../i18n/i18n';
import type { MessageQueue } from '../queue/MessageQueue';
import type { QueuedMessage } from '../state/types';

export interface QueueIndicatorCallbacks {
  onSteerHead: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onResume: () => void;
  onClearAll: () => void;
}

export interface QueueIndicatorOptions {
  containerEl: HTMLElement;
  queue: MessageQueue;
  pendingSteerMessage: QueuedMessage | null;
  canSteer: boolean;
  steerInFlight: boolean;
  callbacks: QueueIndicatorCallbacks;
}

const PREVIEW_LIMIT = 40;

/**
 * Preview of one queued message. Unchanged from the single-slot indicator this
 * replaces - the row is narrow whether there is one of them or six.
 */
function getQueuedMessageDisplay(message: QueuedMessage | null): string {
  if (!message) {
    return '';
  }

  const rawContent = message.content.trim();
  const preview = rawContent.length > PREVIEW_LIMIT
    ? rawContent.slice(0, PREVIEW_LIMIT) + '...'
    : rawContent;
  const hasImages = (message.images?.length ?? 0) > 0;

  if (hasImages) {
    return preview ? `${preview} [images]` : '[images]';
  }

  return preview;
}

function createIconButton(
  parentEl: HTMLElement,
  icon: string,
  label: string,
  onClick: () => void,
): HTMLElement {
  const button = parentEl.createEl('button', {
    cls: 'grimoire-queue-indicator-icon-action',
    attr: {
      'aria-label': label,
      title: label,
      type: 'button',
    },
  });
  setIcon(button, icon);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function createTextButton(
  parentEl: HTMLElement,
  label: string,
  onClick: () => void,
  disabled = false,
): HTMLElement {
  const button = parentEl.createEl('button', {
    cls: 'grimoire-queue-indicator-action',
    text: label,
  });
  button.setAttribute('type', 'button');
  if (disabled) {
    button.setAttribute('disabled', 'true');
    return button;
  }
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function hide(containerEl: HTMLElement): void {
  containerEl.removeClass('grimoire-visible-flex');
  containerEl.addClass('grimoire-hidden');
}

function show(containerEl: HTMLElement): void {
  containerEl.addClass('grimoire-visible-flex');
  containerEl.removeClass('grimoire-hidden');
}

function getHeaderText(queue: MessageQueue): string {
  if (queue.pauseReason === 'failed') {
    return t('chat.ui.queue.pausedFailed');
  }
  if (queue.pauseReason === 'cancelled') {
    return t('chat.ui.queue.pausedCancelled');
  }
  return t('chat.ui.queue.count', { count: queue.size });
}

export function renderQueueIndicator(options: QueueIndicatorOptions): void {
  const { callbacks, canSteer, containerEl, pendingSteerMessage, queue, steerInFlight } = options;

  containerEl.empty();

  if (queue.size === 0) {
    // A steer already handed off has left the queue but has not landed yet.
    // It stays visible so the message does not appear to vanish.
    if (pendingSteerMessage) {
      containerEl.createSpan({
        cls: 'grimoire-queue-indicator-text',
        text: `⌙ ${t('chat.ui.messages.steeringPrefix')}: ${getQueuedMessageDisplay(pendingSteerMessage)}`,
      });
      show(containerEl);
      return;
    }

    hide(containerEl);
    return;
  }

  // One waiting message keeps the single row it has always had: the common case
  // should not pay for the rare one.
  const needsHeader = queue.size > 1 || queue.isPaused;

  // A steer handed off while other messages still wait: say so once, above the
  // list, rather than pinning the label to a row that is not the steered one.
  if (pendingSteerMessage) {
    containerEl.createSpan({
      cls: 'grimoire-queue-indicator-text',
      text: `⌙ ${t('chat.ui.messages.steeringPrefix')}: ${getQueuedMessageDisplay(pendingSteerMessage)}`,
    });
  }

  if (needsHeader) {
    const headerEl = containerEl.createDiv({ cls: 'grimoire-queue-indicator-header' });
    headerEl.createSpan({
      cls: 'grimoire-queue-indicator-text',
      text: getHeaderText(queue),
    });

    const headerActionsEl = headerEl.createDiv({ cls: 'grimoire-queue-indicator-actions' });
    if (queue.isPaused) {
      createTextButton(headerActionsEl, t('chat.ui.queue.resume'), callbacks.onResume);
    }
    createTextButton(headerActionsEl, t('chat.ui.queue.clearAll'), callbacks.onClearAll);
  }

  queue.items.forEach((message, index) => {
    const itemEl = containerEl.createDiv({ cls: 'grimoire-queue-indicator-item' });

    if (queue.size > 1) {
      itemEl.createSpan({
        cls: 'grimoire-queue-indicator-index',
        text: `${index + 1}.`,
      });
    }

    itemEl.createSpan({
      cls: 'grimoire-queue-indicator-text',
      text: needsHeader
        ? getQueuedMessageDisplay(message)
        : `⌙ ${t('chat.ui.messages.queuedPrefix')}: ${getQueuedMessageDisplay(message)}`,
    });

    const actionsEl = itemEl.createDiv({ cls: 'grimoire-queue-indicator-actions' });

    // Steer takes the head and only the head, so the button belongs to the head
    // and nowhere else. Showing it on every row would offer an order the queue
    // does not honour.
    //
    // A steer already in flight has left the queue, so row 0 is the message
    // behind it, not the one being steered. Labelling that row "Steering" reads
    // as a state its own text is not in - it only gets the disabled button, and
    // the steer in flight is announced above the list instead.
    if (index === 0 && canSteer && !steerInFlight) {
      createTextButton(
        actionsEl,
        t('chat.ui.queue.steerNow'),
        callbacks.onSteerHead,
        false,
      );
    }

    createIconButton(
      actionsEl,
      'pencil',
      t('chat.ui.queue.editItem'),
      () => callbacks.onEdit(index),
    );
    createIconButton(
      actionsEl,
      'trash-2',
      t('chat.ui.queue.removeItem'),
      () => callbacks.onRemove(index),
    );
  });

  show(containerEl);
}
