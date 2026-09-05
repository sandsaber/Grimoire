import { Notice } from 'obsidian';
import * as path from 'path';

import type { AttachmentStore } from '../../../core/attachments/AttachmentStore';
import { prepareImageForStore } from '../../../core/attachments/prepareImage';
import type { ImageAttachment, ImageMediaType } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { closeTopmostImageViewer, registerOpenImageViewer } from './imageViewerStack';

/** Largest attachment that may be stored and sent. */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
/**
 * Largest file worth opening at all.
 *
 * Scaling happens before the stored size is judged, so a 15 MB screenshot is
 * now fine - it becomes a few hundred kilobytes. This cap only keeps a file
 * that could never help from being read into memory to find that out.
 */
const MAX_SOURCE_IMAGE_SIZE = 25 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, ImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const ALLOWED_IMAGE_MEDIA_TYPES = new Set<ImageMediaType>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export interface ImageContextCallbacks {
  onImagesChanged: () => void;
}

export class ImageContextManager {
  private callbacks: ImageContextCallbacks;
  private containerEl: HTMLElement;
  private previewContainerEl: HTMLElement;
  private imagePreviewEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private dropOverlay: HTMLElement | null = null;
  private attachedImages: Map<string, ImageAttachment> = new Map();
  private enabled = true;
  private fullImageClose: (() => void) | null = null;
  private readonly attachments: AttachmentStore | null;

  constructor(
    containerEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    callbacks: ImageContextCallbacks,
    previewContainerEl?: HTMLElement,
    attachments?: AttachmentStore,
  ) {
    this.attachments = attachments ?? null;
    this.containerEl = containerEl;
    this.previewContainerEl = previewContainerEl ?? containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;

    // Create image preview in previewContainerEl, before file indicator if present
    const fileIndicator = this.previewContainerEl.querySelector('.grimoire-file-indicator');
    this.imagePreviewEl = this.previewContainerEl.createDiv({ cls: 'grimoire-image-preview' });
    if (fileIndicator && fileIndicator.parentElement === this.previewContainerEl) {
      this.previewContainerEl.insertBefore(this.imagePreviewEl, fileIndicator);
    }

    this.setupDragAndDrop();
    this.setupPasteHandler();
  }

  destroy(): void {
    this.fullImageClose?.();
    this.fullImageClose = null;
    this.attachedImages.clear();
    this.imagePreviewEl.remove();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.attachedImages.size > 0) {
      this.clearImages();
    }
  }

  getAttachedImages(): ImageAttachment[] {
    return Array.from(this.attachedImages.values());
  }

  hasImages(): boolean {
    return this.attachedImages.size > 0;
  }

  clearImages() {
    this.attachedImages.clear();
    this.updateImagePreview();
    this.callbacks.onImagesChanged();
  }

  /** Sets images directly (used for queued messages). */
  setImages(images: ImageAttachment[]) {
    this.attachedImages.clear();
    for (const image of images) {
      this.attachedImages.set(image.id, image);
    }
    this.updateImagePreview();
    this.callbacks.onImagesChanged();
  }

  private setupDragAndDrop() {
    const inputWrapper = this.containerEl.querySelector('.grimoire-input-wrapper') as HTMLElement;
    if (!inputWrapper) return;

    this.dropOverlay = inputWrapper.createDiv({ cls: 'grimoire-drop-overlay' });
    const dropContent = this.dropOverlay.createDiv({ cls: 'grimoire-drop-content' });
    const svg = dropContent.createSvg('svg', {
      attr: {
        viewBox: '0 0 24 24',
        width: '32',
        height: '32',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2',
      },
    });
    svg.createSvg('path', {
      attr: { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' },
    });
    svg.createSvg('polyline', { attr: { points: '17 8 12 3 7 8' } });
    svg.createSvg('line', {
      attr: { x1: '12', y1: '3', x2: '12', y2: '15' },
    });
    dropContent.createSpan({ text: t('chat.ui.images.dropHere') });

    const dropZone = inputWrapper;

    dropZone.addEventListener('dragenter', (e) => this.handleDragEnter(e));
    dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
    dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
    dropZone.addEventListener('drop', (e) => {
      void this.handleDrop(e);
    });
  }

  private handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer?.types.includes('Files')) {
      this.dropOverlay?.addClass('visible');
    }
  }

  private handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  private handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    const inputWrapper = this.containerEl.querySelector('.grimoire-input-wrapper');
    if (!inputWrapper) {
      this.dropOverlay?.removeClass('visible');
      return;
    }

    const rect = inputWrapper.getBoundingClientRect();
    if (
      e.clientX <= rect.left ||
      e.clientX >= rect.right ||
      e.clientY <= rect.top ||
      e.clientY >= rect.bottom
    ) {
      this.dropOverlay?.removeClass('visible');
    }
  }

  private async handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dropOverlay?.removeClass('visible');

    const files = e.dataTransfer?.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (this.isImageFile(file)) {
        await this.addImageFromFile(file, 'drop');
      }
    }
  }

  private setupPasteHandler() {
    this.inputEl.addEventListener('paste', (e) => {
      void (async (): Promise<void> => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              files.push(file);
            }
          }
        }

        if (files.length === 0) return;

        e.preventDefault();
        for (const file of files) {
          await this.addImageFromFile(file, 'paste');
        }
      })();
    });
  }

  private isImageFile(file: File): boolean {
    return file.type.startsWith('image/') && this.getMediaType(file.name) !== null;
  }

  private getMediaType(filename: string): ImageMediaType | null {
    const ext = path.extname(filename).toLowerCase();
    return IMAGE_EXTENSIONS[ext] || null;
  }

  private resolveMediaType(file: File): ImageMediaType | null {
    const fromName = this.getMediaType(file.name);
    if (fromName) {
      return fromName;
    }

    if (ALLOWED_IMAGE_MEDIA_TYPES.has(file.type as ImageMediaType)) {
      return file.type as ImageMediaType;
    }

    return null;
  }

  private async addImageFromFile(file: File, source: 'paste' | 'drop'): Promise<boolean> {
    if (!this.enabled) {
      new Notice(t('chat.ui.images.unsupportedProvider'));
      return false;
    }

    if (file.size > MAX_SOURCE_IMAGE_SIZE) {
      this.notifyImageError(t('chat.ui.images.sizeLimit', { size: this.formatSize(MAX_SOURCE_IMAGE_SIZE) }));
      return false;
    }

    const mediaType = this.resolveMediaType(file);
    if (!mediaType) {
      this.notifyImageError(t('chat.ui.images.unsupportedType'));
      return false;
    }

    try {
      const attachment = await this.buildAttachment(file, mediaType, source);
      if (!attachment) {
        // Scaling could not bring it under the limit - a format we must not
        // re-encode, or an image whose pixels are simply that heavy.
        this.notifyImageError(t('chat.ui.images.sizeLimit', { size: this.formatSize(MAX_IMAGE_SIZE) }));
        return false;
      }

      this.attachedImages.set(attachment.id, attachment);
      this.updateImagePreview();
      this.callbacks.onImagesChanged();
      return true;
    } catch (error) {
      this.notifyImageError(t('chat.ui.images.attachFailed'), error);
      return false;
    }
  }

  /**
   * Scales the image down to what a provider will actually look at, hands the
   * bytes to the store, and keeps only a reference plus an in-memory copy.
   *
   * Without a store - the shape the unit tests construct - the attachment keeps
   * the original bytes and behaves as it always did.
   */
  private async buildAttachment(
    file: File,
    mediaType: ImageMediaType,
    source: 'paste' | 'drop',
  ): Promise<ImageAttachment | null> {
    const name = file.name || `image-${Date.now()}.${mediaType.split('/')[1]}`;

    if (!this.attachments) {
      if (file.size > MAX_IMAGE_SIZE) {
        return null;
      }
      const bytes = await file.arrayBuffer();
      return {
        id: this.generateId(),
        name,
        mediaType,
        data: Buffer.from(bytes).toString('base64'),
        size: file.size,
        source,
      };
    }

    const prepared = await prepareImageForStore(await file.arrayBuffer(), mediaType);
    if (prepared.bytes.byteLength > MAX_IMAGE_SIZE) {
      return null;
    }

    const stored = await this.attachments.put(prepared.bytes, prepared.mediaType);

    return {
      id: this.generateId(),
      name: prepared.rescaled ? renameForMediaType(name, prepared.mediaType) : name,
      mediaType: prepared.mediaType,
      data: Buffer.from(prepared.bytes).toString('base64'),
      hash: stored.hash,
      size: stored.size,
      width: prepared.width,
      height: prepared.height,
      source,
    };
  }

  // ============================================
  // Private: Image Preview
  // ============================================

  private updateImagePreview() {
    this.imagePreviewEl.empty();

    if (this.attachedImages.size === 0) {
      this.imagePreviewEl.removeClass('grimoire-visible-flex');
      this.imagePreviewEl.addClass('grimoire-hidden');
      return;
    }

    this.imagePreviewEl.addClass('grimoire-visible-flex');
    this.imagePreviewEl.removeClass('grimoire-hidden');

    for (const [id, image] of this.attachedImages) {
      this.renderImagePreview(id, image);
    }
  }

  private renderImagePreview(id: string, image: ImageAttachment) {
    const previewEl = this.imagePreviewEl.createDiv({ cls: 'grimoire-image-chip' });

    const thumbEl = previewEl.createDiv({ cls: 'grimoire-image-thumb' });
    thumbEl.createEl('img', {
      attr: {
        src: `data:${image.mediaType};base64,${image.data}`,
        alt: image.name,
      },
    });

    const infoEl = previewEl.createDiv({ cls: 'grimoire-image-info' });
    const nameEl = infoEl.createSpan({ cls: 'grimoire-image-name' });
    nameEl.setText(this.truncateName(image.name, 20));
    nameEl.setAttribute('title', image.name);

    const sizeEl = infoEl.createSpan({ cls: 'grimoire-image-size' });
    sizeEl.setText(this.formatSize(image.size));

    const removeEl = previewEl.createEl('button', {
      cls: 'grimoire-image-remove',
      attr: {
        type: 'button',
        'aria-label': t('chat.ui.images.remove'),
      },
    });
    removeEl.setText('\u00D7');

    removeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.attachedImages.delete(id);
      this.updateImagePreview();
      this.callbacks.onImagesChanged();
    });

    thumbEl.addEventListener('click', () => {
      this.showFullImage(image);
    });
  }

  private showFullImage(image: ImageAttachment) {
    this.fullImageClose?.();

    const ownerDocument = this.containerEl.ownerDocument ?? window.document;
    const overlay = ownerDocument.body.createDiv({ cls: 'grimoire-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'grimoire-image-modal' });

    modal.createEl('img', {
      attr: {
        src: `data:${image.mediaType};base64,${image.data}`,
        alt: image.name,
      },
    });

    const closeBtn = modal.createEl('button', {
      cls: 'grimoire-image-modal-close',
      attr: {
        type: 'button',
        'aria-label': t('chat.ui.images.remove'),
      },
    });
    closeBtn.setText('\u00D7');

    // Escape closes the viewer and must not also cancel the streaming turn.
    // The stack, not this listener, decides which viewer closes: every viewer
    // registers one of these on the same document, and `stopImmediatePropagation`
    // keeps the siblings from closing a second viewer on one key press.
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      closeTopmostImageViewer();
    };

    const unregisterViewer = registerOpenImageViewer(() => close());

    const close = () => {
      unregisterViewer();
      ownerDocument.removeEventListener('keydown', handleEsc, true);
      overlay.remove();
      if (this.fullImageClose === close) {
        this.fullImageClose = null;
      }
    };

    this.fullImageClose = close;
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    ownerDocument.addEventListener('keydown', handleEsc, true);
  }

  private generateId(): string {
    return `img-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private truncateName(name: string, maxLen: number): string {
    if (name.length <= maxLen) return name;
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    const truncatedBase = base.slice(0, maxLen - ext.length - 3);
    return `${truncatedBase}...${ext}`;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private notifyImageError(message: string, error?: unknown) {
    let userMessage = message;
    if (error instanceof Error) {
      if (error.message.includes('ENOENT') || error.message.includes('no such file')) {
        userMessage = `${message} ${t('chat.ui.images.fileNotFound')}`;
      } else if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
        userMessage = `${message} ${t('chat.ui.images.permissionDenied')}`;
      }
    }
    new Notice(userMessage);
  }
}

/** Keeps the displayed file name honest when a re-encode changed the format. */
function renameForMediaType(name: string, mediaType: ImageMediaType): string {
  const extension = mediaType.split('/')[1];
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}.${extension}` : `${name}.${extension}`;
}
