import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

import { t } from '../../../../i18n/i18n';
import { ContextAddPicker, type ContextPickerPlacement } from './ContextAddPicker';
import { ContextComposerView } from './ContextComposerView';
import type { ContextBudget, ContextItem } from './contextItems';
import { type ContextCandidate,ContextManagerModal } from './ContextManagerModal';
import { ContextStore } from './ContextStore';
import { estimateTokensFromBytes, estimateVaultFileTokens, listFolderFiles } from './tokenEstimate';

export interface ContextAttachmentsDeps {
  app: App;
  /** The note the conversation is bound to, attached automatically. */
  getOpenNotePath: () => string | null;
  /** Vault paths the reader mentioned or picked. */
  getVaultPaths: () => string[];
  /** Absolute paths from outside the vault. */
  getExternalPaths: () => string[];
  detachOpenNote: () => void;
  detachVaultPath: (path: string) => void;
  detachExternalPath: (path: string) => void;
  attachVaultPath: (path: string) => void;
  getBudget: () => ContextBudget;
  /** True while a turn is in flight, which freezes what that turn carries. */
  isStreaming: () => boolean;
  openPath: (path: string) => void;
  /** The composer card, whose border says when this message is over budget. */
  cardEl?: HTMLElement | null;
  /** The note the reader is looking at, as a quick source. */
  attachOpenFile?: () => void;
  /**
   * The native dialog for a path outside the vault, per target.
   *
   * Without it the picker searches only the vault, so the EXTERNAL group the
   * manage dialog draws had nothing in this surface that could fill it. A file
   * and a folder are asked for separately because Windows and Linux cannot
   * show one dialog that returns either.
   */
  browseExternal?: (target: 'file' | 'folder') => void;
}

const OPEN_NOTE_PREFIX = 'open-note:';
const VAULT_PREFIX = 'vault:';
const EXTERNAL_PREFIX = 'external:';

function basename(path: string): string {
  return path.replace(/\\/g, '/').split('/').pop() || path;
}

function parentFolder(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const at = normalized.lastIndexOf('/');
  return at <= 0 ? '' : `${normalized.slice(0, at)}/`;
}

/**
 * Binds the three places an attachment can come from to one list, and mounts
 * the three surfaces that read it.
 *
 * The open note, the mentioned vault paths and the external files each had
 * their own view before this, and none of the three could see the other two —
 * so "what is attached" was a question the interface could not answer.
 */
export class ContextAttachments {
  readonly store = new ContextStore();
  private view: ContextComposerView | null = null;
  private picker: ContextAddPicker | null = null;
  private applying = false;
  private knownIds = new Set<string>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly composerEl: HTMLElement,
    private readonly deps: ContextAttachmentsDeps,
  ) {
    this.unsubscribe = this.store.subscribe(() => this.onStoreChanged());
    this.view = new ContextComposerView(this.composerEl, this.store, {
      onOpenManager: anchor => this.openManager(anchor),
      onOpenPicker: anchor => this.openPicker(anchor),
      onOpenItem: item => this.deps.openPath(item.path),
      cardEl: this.deps.cardEl ?? null,
    });
    this.sync();
  }

  destroy(): void {
    this.unsubscribe();
    this.picker?.close();
    this.picker = null;
    this.view?.destroy();
    this.view = null;
  }

  /**
   * Opens the manage dialog from outside the composer.
   *
   * The composer only offers a way in past four attachments, which is where
   * the design draws it - so with two files attached the dialog existed and
   * nothing could reach it.
   */
  manage(): void {
    this.openManager(this.composerEl);
  }

  /** Rebuilds the list from its sources, preserving each source's own order. */
  sync(): void {
    const streaming = this.deps.isStreaming();
    const items: ContextItem[] = [];

    const openNote = this.deps.getOpenNotePath();
    if (openNote) {
      items.push(this.describe(`${OPEN_NOTE_PREFIX}${openNote}`, openNote, 'open-note', 'auto', streaming));
    }
    for (const path of this.deps.getVaultPaths()) {
      if (path === openNote) continue;
      items.push(this.describe(`${VAULT_PREFIX}${path}`, path, 'vault-file', 'mention', streaming));
    }
    for (const path of this.deps.getExternalPaths()) {
      items.push(this.describe(`${EXTERNAL_PREFIX}${path}`, path, 'external-file', 'picker', streaming));
    }

    this.applying = true;
    this.store.replace(items);
    this.store.setBudget(this.deps.getBudget());
    this.knownIds = new Set(items.map(item => item.id));
    this.applying = false;
  }

  private describe(
    id: string,
    path: string,
    kind: ContextItem['kind'],
    addedBy: ContextItem['addedBy'],
    streaming: boolean,
  ): ContextItem {
    const vault = kind !== 'external-file';
    const exists = !vault || this.deps.app.vault.getAbstractFileByPath(path) instanceof TFile;
    return {
      id,
      kind,
      name: basename(path),
      detail: kind === 'external-file'
        ? t('chat.ui.contextManager.detailExternal')
        : kind === 'open-note'
          ? t('chat.ui.contextManager.detailOpenNote')
          : parentFolder(path),
      path,
      tokens: vault ? estimateVaultFileTokens(this.deps.app, path) : null,
      // An attachment that vanished is not silently dropped: it stays with its
      // reason until the reader removes it.
      state: exists ? 'loaded' : 'failed',
      ...(exists ? {} : { error: t('chat.ui.contextManager.missing') }),
      addedBy,
      inFlight: streaming,
    };
  }

  /** Whatever left the list was removed by the reader, so detach it at source. */
  private onStoreChanged(): void {
    if (this.applying) return;
    const current = new Set(this.store.getItems().map(item => item.id));
    for (const id of this.knownIds) {
      if (current.has(id)) continue;
      if (id.startsWith(OPEN_NOTE_PREFIX)) this.deps.detachOpenNote();
      else if (id.startsWith(VAULT_PREFIX)) this.deps.detachVaultPath(id.slice(VAULT_PREFIX.length));
      else if (id.startsWith(EXTERNAL_PREFIX)) this.deps.detachExternalPath(id.slice(EXTERNAL_PREFIX.length));
    }
    this.knownIds = current;
  }

  private openManager(anchor: HTMLElement): void {
    new ContextManagerModal(this.deps.app, this.store, {
      search: query => this.searchVault(query),
      attach: candidate => this.attach(candidate),
      openPicker: (mountEl, addButton) => this.openPicker(addButton, mountEl, 'below'),
      // The dialog empties itself on close, taking a picker it was hosting
      // with it - and a picker that was removed but not closed leaves its
      // outside-click listener on the document.
      onClosed: () => {
        this.picker?.close();
        this.picker = null;
      },
    }, anchor).open();
  }

  private openPicker(
    anchor: HTMLElement,
    parentEl: HTMLElement = this.composerEl,
    placement: ContextPickerPlacement = 'above',
  ): void {
    this.picker?.close();
    this.picker = new ContextAddPicker(parentEl, this.store, {
      search: query => this.searchVault(query),
      attach: candidate => this.attach(candidate),
      identify: candidate => `${VAULT_PREFIX}${candidate.path}`,
      quickSources: () => this.quickSources(),
    }, anchor, placement);
  }

  private quickSources(): Array<{ id: string; label: string; run: () => void }> {
    const sources: Array<{ id: string; label: string; run: () => void }> = [];
    if (this.deps.attachOpenFile) {
      sources.push({
        id: 'open-file',
        label: t('chat.ui.contextManager.quickOpenFile'),
        run: () => this.deps.attachOpenFile?.(),
      });
    }
    if (this.deps.browseExternal) {
      sources.push({
        id: 'browse-file',
        label: t('chat.ui.contextManager.quickBrowseFile'),
        run: () => this.deps.browseExternal?.('file'),
      });
      sources.push({
        id: 'browse-folder',
        label: t('chat.ui.contextManager.quickBrowseFolder'),
        run: () => this.deps.browseExternal?.('folder'),
      });
    }
    return sources;
  }

  private attach(candidate: ContextCandidate): void {
    if (candidate.folder) {
      // Expanded here rather than kept as a row, so what the list shows is
      // exactly what the turn will carry.
      for (const file of listFolderFiles(this.deps.app, candidate.path)) {
        this.deps.attachVaultPath(file.path);
      }
    } else {
      this.deps.attachVaultPath(candidate.path);
    }
    this.sync();
  }

  /**
   * Vault files matching a query, cheapest first to compute: name, then path.
   *
   * A folder is expanded to its files at attach time rather than attached as a
   * row of its own, because nothing downstream of the composer can take a
   * folder — a folder row that could not be sent would be a promise the
   * backend does not keep.
   */
  private searchVault(query: string): ContextCandidate[] {
    const needle = query.trim().toLowerCase();
    const files = this.deps.app.vault.getFiles?.() ?? [];
    const matches = needle
      ? files.filter(file => file.path.toLowerCase().includes(needle))
      : files.slice(0, 40);
    const candidates: ContextCandidate[] = matches.slice(0, 60).map(file => ({
      path: file.path,
      name: file.name,
      detail: parentFolder(file.path),
      tokens: estimateVaultFileTokens(this.deps.app, file.path),
    }));
    if (needle) candidates.unshift(...this.searchFolders(needle));
    return candidates;
  }

  /** Folders whose path matches, priced by the sum of what is inside them. */
  private searchFolders(needle: string): ContextCandidate[] {
    const roots = this.deps.app.vault.getAllLoadedFiles?.() ?? [];
    const folders = roots.filter((entry): entry is TFolder =>
      entry instanceof TFolder && entry.path.toLowerCase().includes(needle));
    return folders.slice(0, 5).map(folder => {
      const files = listFolderFiles(this.deps.app, folder.path);
      const bytes = files.reduce((sum, file) => sum + (file.stat?.size ?? 0), 0);
      return {
        path: folder.path,
        name: folder.name || folder.path,
        detail: t('chat.ui.contextManager.folderDetail', { count: files.length }),
        tokens: files.length > 0 ? estimateTokensFromBytes(bytes) : null,
        folder: true,
      };
    });
  }
}
