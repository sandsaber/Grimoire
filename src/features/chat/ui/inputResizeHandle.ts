import { t } from '../../../i18n/i18n';

export const INPUT_WRAPPER_MIN_HEIGHT = 106;
export const INPUT_WRAPPER_MAX_HEIGHT_RATIO = 0.7;
const INPUT_WRAPPER_HEIGHT_PROPERTY = '--grimoire-input-wrapper-height';

export interface InputResizeHandleOptions {
  inputWrapper: HTMLElement;
  viewport: HTMLElement;
}

export function createInputResizeHandle({
  inputWrapper,
  viewport,
}: InputResizeHandleOptions): () => void {
  const doc = inputWrapper.ownerDocument;
  const handle = inputWrapper.createDiv({ cls: 'grimoire-input-resize-handle' });
  handle.setAttribute('aria-label', t('chat.ui.composer.resizeInput'));
  inputWrapper.insertBefore(handle, inputWrapper.firstChild);

  let isDragging = false;
  let startY = 0;
  let startHeight = 0;
  let minimumHeight = INPUT_WRAPPER_MIN_HEIGHT;

  const clearDragState = () => {
    isDragging = false;
    doc.body?.classList.remove('grimoire-dragging-ns');
  };

  const onMouseMove = (event: MouseEvent) => {
    if (!isDragging) return;

    const maxHeight = Math.max(
      minimumHeight,
      viewport.clientHeight * INPUT_WRAPPER_MAX_HEIGHT_RATIO,
    );
    const nextHeight = Math.max(
      minimumHeight,
      Math.min(maxHeight, startHeight + startY - event.clientY),
    );

    inputWrapper.style.setProperty(INPUT_WRAPPER_HEIGHT_PROPERTY, `${nextHeight}px`);
  };

  const onMouseUp = () => {
    clearDragState();
    doc.removeEventListener('mousemove', onMouseMove);
    doc.removeEventListener('mouseup', onMouseUp);
  };

  const onMouseDown = (event: MouseEvent) => {
    event.preventDefault();
    isDragging = true;
    startY = event.clientY;
    startHeight = inputWrapper.offsetHeight;
    minimumHeight = measureInputWrapperMinimumHeight(inputWrapper);
    doc.body?.classList.add('grimoire-dragging-ns');
    doc.addEventListener('mousemove', onMouseMove);
    doc.addEventListener('mouseup', onMouseUp);
  };

  handle.addEventListener('mousedown', onMouseDown);

  return () => {
    handle.removeEventListener('mousedown', onMouseDown);
    doc.removeEventListener('mousemove', onMouseMove);
    doc.removeEventListener('mouseup', onMouseUp);
    clearDragState();
    handle.remove();
  };
}

function measureInputWrapperMinimumHeight(inputWrapper: HTMLElement): number {
  const explicitHeight = inputWrapper.style.getPropertyValue(INPUT_WRAPPER_HEIGHT_PROPERTY);
  const explicitHeightPriority = inputWrapper.style.getPropertyPriority(INPUT_WRAPPER_HEIGHT_PROPERTY);
  inputWrapper.style.removeProperty(INPUT_WRAPPER_HEIGHT_PROPERTY);

  const computedMinHeight = Number.parseFloat(
    inputWrapper.ownerDocument.defaultView?.getComputedStyle(inputWrapper).minHeight ?? '',
  );
  const minimumHeight = Math.max(
    INPUT_WRAPPER_MIN_HEIGHT,
    Number.isFinite(computedMinHeight) ? computedMinHeight : 0,
    inputWrapper.scrollHeight,
  );

  if (explicitHeight) {
    inputWrapper.style.setProperty(INPUT_WRAPPER_HEIGHT_PROPERTY, explicitHeight, explicitHeightPriority);
  }

  return Math.ceil(minimumHeight);
}
