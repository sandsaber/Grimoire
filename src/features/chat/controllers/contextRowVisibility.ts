export function updateContextRowHasContent(contextRowEl: HTMLElement): void {
  const editorIndicator = contextRowEl.querySelector('.grimoire-selection-indicator');
  const browserIndicator = contextRowEl.querySelector('.grimoire-browser-selection-indicator');
  const canvasIndicator = contextRowEl.querySelector('.grimoire-canvas-indicator');
  const attachments = contextRowEl.querySelector('.grimoire-context-attachments');
  const imagePreview = contextRowEl.querySelector('.grimoire-image-preview');

  const hasEditorSelection = !!editorIndicator && !editorIndicator.hasClass('grimoire-hidden');
  const hasBrowserSelection = !!browserIndicator && !browserIndicator.hasClass('grimoire-hidden');
  const hasCanvasSelection = !!canvasIndicator && !canvasIndicator.hasClass('grimoire-hidden');
  // One list now, across vault files, the open note and external paths: two
  // chip rows that each counted only their own half is what this replaced.
  const hasAttachments = !!attachments && !attachments.hasClass('grimoire-hidden');
  const hasImageChips = !!imagePreview && imagePreview.hasClass('grimoire-visible-flex');

  contextRowEl.classList.toggle(
    'has-content',
    hasEditorSelection || hasBrowserSelection || hasCanvasSelection || hasAttachments || hasImageChips
  );
}
