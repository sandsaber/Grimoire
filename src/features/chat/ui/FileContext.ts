import type { App, EventRef } from 'obsidian';
import { Notice, TFile } from 'obsidian';

import { isPathInExcludedFolder } from '../../../core/context/exclusions';
import { t } from '../../../i18n/i18n';
import type { AgentMentionProvider } from '../../../shared/mention/MentionDropdownController';
import { MentionDropdownController } from '../../../shared/mention/MentionDropdownController';
import { VaultMentionDataProvider } from '../../../shared/mention/VaultMentionDataProvider';
import {
  createExternalContextLookupGetter,
  isMentionStart,
  resolveExternalMentionAtIndex,
} from '../../../utils/contextMentionResolver';
import { createDetachedEl } from '../../../utils/dom';
import { buildExternalContextDisplayEntries } from '../../../utils/externalContext';
import { externalContextScanner } from '../../../utils/externalContextScanner';
import { getVaultPath, normalizePathForVault as normalizePathForVaultUtil } from '../../../utils/path';
import type { ProviderMcpServerView } from '../tabs/tabSettings';
import { FileContextState } from './file-context/state/FileContextState';
import { FileChipsView } from './file-context/view/FileChipsView';

export interface FileContextCallbacks {
  getExcludedTags: () => string[];
  getExcludedFolders: () => string[];
  onChipsChanged?: () => void;
  getExternalContexts?: () => string[];
  /** Called when an agent is selected from the @ mention dropdown. */
  onAgentMentionSelect?: (agentId: string) => void;
  /** Called when a provider-neutral tool mention is selected. */
  onToolMentionSelect?: (toolId: 'vault') => void;
}

export class FileContextManager {
  private app: App;
  private callbacks: FileContextCallbacks;
  private chipsContainerEl: HTMLElement;
  private dropdownContainerEl: HTMLElement;
  private contextMemoryEl: HTMLElement | null;
  private inputEl: HTMLTextAreaElement;
  private state: FileContextState;
  private mentionDataProvider: VaultMentionDataProvider;
  private chipsView: FileChipsView;
  private mentionDropdown: MentionDropdownController;
  private deleteEventRef: EventRef | null = null;
  private renameEventRef: EventRef | null = null;

  // Current note (shown as chip)
  private currentNotePath: string | null = null;

  // MCP server support
  private onMcpMentionChange: ((servers: Set<string>) => void) | null = null;

  constructor(
    app: App,
    chipsContainerEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    callbacks: FileContextCallbacks,
    dropdownContainerEl?: HTMLElement,
    contextMemoryEl?: HTMLElement
  ) {
    this.app = app;
    this.chipsContainerEl = chipsContainerEl;
    this.dropdownContainerEl = dropdownContainerEl ?? chipsContainerEl;
    this.contextMemoryEl = contextMemoryEl ?? null;
    this.inputEl = inputEl;
    this.callbacks = callbacks;

    this.state = new FileContextState();
    this.mentionDataProvider = new VaultMentionDataProvider(this.app);
    this.mentionDataProvider.initializeInBackground();

    this.chipsView = new FileChipsView(this.chipsContainerEl, {
      onRemoveAttachment: (filePath) => {
        if (filePath === this.currentNotePath) {
          this.currentNotePath = null;
          this.state.detachFile(filePath);
          this.refreshCurrentNoteChip();
        }
      },
      onOpenFile: (filePath) => {
        void (async (): Promise<void> => {
          const file = this.app.vault.getAbstractFileByPath(filePath);
          if (!(file instanceof TFile)) {
            new Notice(t('chat.ui.errors.couldNotOpenFile', { path: filePath }));
            return;
          }
          try {
            await this.app.workspace.getLeaf().openFile(file);
          } catch (error) {
            new Notice(t('chat.ui.errors.openFileFailed', {
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        })();
      },
    });

    this.mentionDropdown = new MentionDropdownController(
      this.dropdownContainerEl,
      this.inputEl,
      {
        onAttachFile: (filePath) => {
          this.state.attachFile(filePath);
          this.renderContextMemory();
          this.callbacks.onChipsChanged?.();
        },
        onMcpMentionChange: (servers) => this.onMcpMentionChange?.(servers),
        onAgentMentionSelect: (agentId) => this.callbacks.onAgentMentionSelect?.(agentId),
        onToolMentionSelect: (toolId) => this.callbacks.onToolMentionSelect?.(toolId),
        getMentionedMcpServers: () => this.state.getMentionedMcpServers(),
        setMentionedMcpServers: (mentions) => this.state.setMentionedMcpServers(mentions),
        addMentionedMcpServer: (name) => this.state.addMentionedMcpServer(name),
        getExternalContexts: () => this.callbacks.getExternalContexts?.() || [],
        getCachedVaultFolders: () => this.mentionDataProvider.getCachedVaultFolders(),
        getCachedVaultFiles: () => this.mentionDataProvider.getCachedVaultFiles(),
        normalizePathForVault: (rawPath) => this.normalizePathForVault(rawPath),
      }
    );

    this.deleteEventRef = this.app.vault.on('delete', (file) => {
      if (file instanceof TFile) this.handleFileDeleted(file.path);
    });

    this.renameEventRef = this.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile) this.handleFileRenamed(oldPath, file.path);
    });

    this.renderContextMemory();
  }

  /** Returns the current note path (shown as chip). */
  getCurrentNotePath(): string | null {
    return this.currentNotePath;
  }

  getAttachedFiles(): Set<string> {
    return this.state.getAttachedFiles();
  }

  /** Checks whether current note should be sent for this session. */
  shouldSendCurrentNote(notePath?: string | null): boolean {
    const resolvedPath = notePath ?? this.currentNotePath;
    return !!resolvedPath && !this.state.hasSentCurrentNote();
  }

  /** Marks current note as sent (call after sending a message). */
  markCurrentNoteSent() {
    this.state.markCurrentNoteSent();
  }

  isSessionStarted(): boolean {
    return this.state.isSessionStarted();
  }

  startSession() {
    this.state.startSession();
  }

  /** Resets state for a new conversation. */
  resetForNewConversation() {
    this.currentNotePath = null;
    this.state.resetForNewConversation();
    this.refreshCurrentNoteChip();
  }

  /** Resets state for loading an existing conversation. */
  resetForLoadedConversation(hasMessages: boolean) {
    this.currentNotePath = null;
    this.state.resetForLoadedConversation(hasMessages);
    this.refreshCurrentNoteChip();
  }

  /** Sets current note (for restoring persisted state). */
  setCurrentNote(notePath: string | null) {
    this.currentNotePath = notePath;
    if (notePath) {
      this.state.attachFile(notePath);
    }
    this.refreshCurrentNoteChip();
  }

  /** Auto-attaches the currently focused file (for new sessions). */
  autoAttachActiveFile() {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && !this.isExcluded(activeFile)) {
      const normalizedPath = this.normalizePathForVault(activeFile.path);
      if (normalizedPath) {
        this.currentNotePath = normalizedPath;
        this.state.attachFile(normalizedPath);
        this.refreshCurrentNoteChip();
      }
    }
  }

  /** Handles file open event. */
  handleFileOpen(file: TFile) {
    const normalizedPath = this.normalizePathForVault(file.path);
    if (!normalizedPath) return;

    if (!this.state.isSessionStarted()) {
      this.state.clearAttachments();
      if (!this.isExcluded(file)) {
        this.currentNotePath = normalizedPath;
        this.state.attachFile(normalizedPath);
      } else {
        this.currentNotePath = null;
      }
      this.refreshCurrentNoteChip();
    }
  }

  markFileCacheDirty() {
    this.mentionDataProvider.markFilesDirty();
  }

  markFolderCacheDirty() {
    this.mentionDataProvider.markFoldersDirty();
  }

  /** Handles input changes to detect @ mentions. */
  handleInputChange() {
    this.mentionDropdown.handleInputChange();
  }

  /** Handles keyboard navigation in mention dropdown. Returns true if handled. */
  handleMentionKeydown(e: KeyboardEvent): boolean {
    return this.mentionDropdown.handleKeydown(e);
  }

  isMentionDropdownVisible(): boolean {
    return this.mentionDropdown.isVisible();
  }

  hideMentionDropdown() {
    this.mentionDropdown.hide();
  }

  containsElement(el: Node): boolean {
    return this.mentionDropdown.containsElement(el);
  }

  transformContextMentions(text: string): string {
    const externalContexts = this.callbacks.getExternalContexts?.() || [];
    if (externalContexts.length === 0 || !text.includes('@')) return text;

    const contextEntries = buildExternalContextDisplayEntries(externalContexts)
      .sort((a, b) => b.displayNameLower.length - a.displayNameLower.length);
    const getContextLookup = createExternalContextLookupGetter(
      contextRoot => externalContextScanner.scanPaths([contextRoot])
    );

    let replaced = false;
    let cursor = 0;
    const chunks: string[] = [];

    for (let index = 0; index < text.length; index++) {
      if (!isMentionStart(text, index)) continue;

      const resolved = resolveExternalMentionAtIndex(text, index, contextEntries, getContextLookup);
      if (!resolved) continue;

      chunks.push(text.slice(cursor, index));
      chunks.push(`${resolved.resolvedPath}${resolved.trailingPunctuation}`);
      cursor = resolved.endIndex;
      index = resolved.endIndex - 1;
      replaced = true;
    }

    if (!replaced) return text;
    chunks.push(text.slice(cursor));
    return chunks.join('');
  }

  /** Cleans up event listeners (call on view close). */
  destroy() {
    if (this.deleteEventRef) this.app.vault.offref(this.deleteEventRef);
    if (this.renameEventRef) this.app.vault.offref(this.renameEventRef);
    this.mentionDropdown.destroy();
    this.chipsView.destroy();
  }

  /** Normalizes a file path to be vault-relative with forward slashes. */
  normalizePathForVault(rawPath: string | undefined | null): string | null {
    const vaultPath = getVaultPath(this.app);
    return normalizePathForVaultUtil(rawPath, vaultPath);
  }

  private refreshCurrentNoteChip(): void {
    this.chipsView.renderCurrentNote(this.currentNotePath);
    this.renderContextMemory();
    this.callbacks.onChipsChanged?.();
  }

  private renderContextMemory(): void {
    if (!this.contextMemoryEl) {
      return;
    }

    this.contextMemoryEl.empty();
    this.contextMemoryEl.classList.add('grimoire-hidden');

    const attachedFiles = Array.from(this.state.getAttachedFiles())
      .filter(filePath => filePath !== this.currentNotePath);
    if (attachedFiles.length === 0) {
      return;
    }

    this.contextMemoryEl.classList.remove('grimoire-hidden');

    const attachedSection = this.createMemoryText(
      'section',
      'grimoire-context-section grimoire-context-attached-files',
      '',
    );
    attachedSection.appendChild(this.createMemoryText(
      'div',
      'grimoire-context-section-title',
      'Pinned context',
    ));

    for (const filePath of attachedFiles) {
      attachedSection.appendChild(this.createNoteMemoryCard(filePath, 'Attached'));
    }
    this.contextMemoryEl.appendChild(attachedSection);
  }

  private createNoteMemoryCard(filePath: string, badge: string): HTMLElement {
    const card = this.createMemoryText('div', 'grimoire-context-file-row grimoire-note-memory-card', '');
    card.title = filePath;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const openFile = () => {
      void (async (): Promise<void> => {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
          new Notice(t('chat.ui.errors.couldNotOpenFile', { path: filePath }));
          return;
        }
        try {
          await this.app.workspace.getLeaf().openFile(file);
        } catch (error) {
          new Notice(t('chat.ui.errors.openFileFailed', {
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      })();
    };

    card.addEventListener('click', openFile);
    card.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openFile();
    });

    const normalizedPath = filePath.replace(/\\/g, '/');
    const filename = normalizedPath.split('/').pop() || filePath;
    const body = this.createMemoryText('span', 'grimoire-context-file-body', '');
    body.appendChild(this.createMemoryText('strong', 'grimoire-context-file-title grimoire-note-memory-title', filename));
    body.appendChild(this.createMemoryText('span', 'grimoire-context-file-path grimoire-note-memory-path', filePath));
    card.appendChild(body);
    card.appendChild(this.createMemoryText('span', 'grimoire-context-file-badge grimoire-note-memory-badge', badge.toLowerCase()));
    return card;
  }

  private createMemoryText<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    className: string,
    text: string,
  ): HTMLElementTagNameMap[K] {
    return createDetachedEl(this.contextMemoryEl?.ownerDocument ?? window.document, tagName, {
      cls: className,
      text,
    });
  }

  private handleFileRenamed(oldPath: string, newPath: string) {
    const normalizedOld = this.normalizePathForVault(oldPath);
    const normalizedNew = this.normalizePathForVault(newPath);
    if (!normalizedOld) return;

    let needsUpdate = false;

    // Update current note path if renamed
    if (this.currentNotePath === normalizedOld) {
      this.currentNotePath = normalizedNew;
      needsUpdate = true;
    }

    // Update attached files
    if (this.state.getAttachedFiles().has(normalizedOld)) {
      this.state.detachFile(normalizedOld);
      if (normalizedNew) {
        this.state.attachFile(normalizedNew);
      }
      needsUpdate = true;
    }

    if (needsUpdate) {
      this.refreshCurrentNoteChip();
    }
  }

  private handleFileDeleted(deletedPath: string): void {
    const normalized = this.normalizePathForVault(deletedPath);
    if (!normalized) return;

    let needsUpdate = false;

    // Clear current note if deleted
    if (this.currentNotePath === normalized) {
      this.currentNotePath = null;
      needsUpdate = true;
    }

    // Remove from attached files
    if (this.state.getAttachedFiles().has(normalized)) {
      this.state.detachFile(normalized);
      needsUpdate = true;
    }

    if (needsUpdate) {
      this.refreshCurrentNoteChip();
    }
  }

  // ========================================
  // MCP Server Support
  // ========================================

  setMcpManager(manager: ProviderMcpServerView | null): void {
    this.mentionDropdown.setMcpManager(manager);
  }

  setAgentService(agentService: AgentMentionProvider | null): void {
    this.mentionDropdown.setAgentService(agentService);
  }

  setOnMcpMentionChange(callback: (servers: Set<string>) => void): void {
    this.onMcpMentionChange = callback;
  }

  /**
   * Pre-scans external context paths in the background to warm the cache.
   * Should be called when external context paths are added/changed.
   */
  preScanExternalContexts(): void {
    this.mentionDropdown.preScanExternalContexts();
  }

  getMentionedMcpServers(): Set<string> {
    return this.state.getMentionedMcpServers();
  }

  clearMcpMentions(): void {
    this.state.clearMcpMentions();
  }

  updateMcpMentionsFromText(text: string): void {
    this.mentionDropdown.updateMcpMentionsFromText(text);
  }

  private isExcluded(file: TFile): boolean {
    if (isPathInExcludedFolder(file.path, this.callbacks.getExcludedFolders())) {
      return true;
    }

    const excludedTags = this.callbacks.getExcludedTags();
    if (excludedTags.length === 0) return false;

    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return false;

    const fileTags: string[] = [];

    if (cache.frontmatter?.tags) {
      const fmTags: unknown = cache.frontmatter.tags;
      if (Array.isArray(fmTags)) {
        fileTags.push(...fmTags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.replace(/^#/, '')));
      } else if (typeof fmTags === 'string') {
        fileTags.push(fmTags.replace(/^#/, ''));
      }
    }

    if (cache.tags) {
      fileTags.push(...cache.tags.map(t => t.tag.replace(/^#/, '')));
    }

    return fileTags.some(tag => excludedTags.includes(tag));
  }
}
