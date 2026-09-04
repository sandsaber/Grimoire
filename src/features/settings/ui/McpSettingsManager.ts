import type { App } from 'obsidian';
import { Notice, setIcon } from 'obsidian';

import { asActivatable, markDecorative } from '@/shared/components/activatable';

import { tryParseClipboardConfig } from '../../../core/mcp/McpConfigParser';
import { testMcpServer } from '../../../core/mcp/McpTester';
import type { AppMcpStorage } from '../../../core/providers/types';
import type { ManagedMcpServer, McpServerConfig, McpServerType } from '../../../core/types';
import { DEFAULT_MCP_SERVER, getMcpServerType } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { confirmDelete } from '../../../shared/modals/ConfirmModal';
import { McpServerModal } from './McpServerModal';
import { McpTestModal } from './McpTestModal';

export interface McpSettingsManagerFeatures {
  contextSaving?: boolean;
  toolFiltering?: boolean;
}

export interface McpSettingsManagerDeps {
  app: App;
  mcpStorage: AppMcpStorage;
  broadcastMcpReload: () => Promise<void>;
  features?: McpSettingsManagerFeatures;
}

export class McpSettingsManager {
  private app: App;
  private containerEl: HTMLElement;
  private mcpStorage: AppMcpStorage;
  private broadcastMcpReload: () => Promise<void>;
  private servers: ManagedMcpServer[] = [];
  private documentClickHandler: (() => void) | null = null;
  private readonly features: Required<McpSettingsManagerFeatures>;

  constructor(containerEl: HTMLElement, deps: McpSettingsManagerDeps) {
    this.app = deps.app;
    this.containerEl = containerEl;
    this.mcpStorage = deps.mcpStorage;
    this.broadcastMcpReload = deps.broadcastMcpReload;
    this.features = {
      contextSaving: deps.features?.contextSaving ?? true,
      toolFiltering: deps.features?.toolFiltering ?? true,
    };
    void this.loadAndRender();
  }

  private async loadAndRender() {
    this.servers = await this.mcpStorage.load();
    this.render();
  }

  private render() {
    this.detachDocumentClickHandler();
    this.containerEl.empty();

    const headerEl = this.containerEl.createDiv({ cls: 'grimoire-mcp-header' });
    headerEl.createSpan({ text: t('settings.mcpServers.name'), cls: 'grimoire-mcp-label' });

    const addContainer = headerEl.createDiv({ cls: 'grimoire-mcp-add-container' });
    const addBtn = addContainer.createEl('button', {
      cls: 'grimoire-settings-action-btn',
      attr: { 'aria-label': t('common.add') },
    });
    setIcon(addBtn, 'plus');

    const dropdown = addContainer.createDiv({ cls: 'grimoire-mcp-add-dropdown' });

    // Icon plus label, because each of these is a choice with a consequence:
    // the icon speeds re-finding it, the word is what makes the choice. The
    // icon is decoration beside its own label, so it is not announced twice.
    const addOption = (icon: string, label: string, onActivate: () => void): void => {
      const option = dropdown.createDiv({ cls: 'grimoire-mcp-add-option' });
      const iconEl = option.createSpan({ cls: 'grimoire-mcp-add-option-icon' });
      setIcon(iconEl, icon);
      markDecorative(iconEl);
      option.createSpan({ text: label });
      asActivatable(option, { label, onActivate });
    };

    addOption('terminal', t('settings.mcp.addStdio'), () => {
      this.closeAddDropdown(dropdown);
      this.openModal(null, 'stdio');
    });
    addOption('globe', t('settings.mcp.addRemote'), () => {
      this.closeAddDropdown(dropdown);
      this.openModal(null, 'http');
    });
    addOption('clipboard-paste', t('settings.mcp.importClipboard'), () => {
      this.closeAddDropdown(dropdown);
      void this.importFromClipboard();
    });

    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const shouldOpen = !dropdown.hasClass('is-visible');
      if (!shouldOpen) {
        this.closeAddDropdown(dropdown);
        return;
      }
      dropdown.addClass('is-visible');
      const doc = this.containerEl.ownerDocument ?? window.document;
      this.documentClickHandler = () => this.closeAddDropdown(dropdown);
      doc.addEventListener('click', this.documentClickHandler);
    });

    if (this.servers.length === 0) {
      const emptyEl = this.containerEl.createDiv({ cls: 'grimoire-mcp-empty' });
      emptyEl.setText(t('settings.mcp.noServers'));
      return;
    }

    const listEl = this.containerEl.createDiv({ cls: 'grimoire-mcp-list' });
    for (const server of this.servers) {
      this.renderServerItem(listEl, server);
    }
  }

  private renderServerItem(listEl: HTMLElement, server: ManagedMcpServer) {
    const itemEl = listEl.createDiv({ cls: 'grimoire-mcp-item' });
    if (!server.enabled) {
      itemEl.addClass('grimoire-mcp-item-disabled');
    }

    const statusEl = itemEl.createDiv({ cls: 'grimoire-mcp-status' });
    statusEl.addClass(
      server.enabled ? 'grimoire-mcp-status-enabled' : 'grimoire-mcp-status-disabled'
    );

    const infoEl = itemEl.createDiv({ cls: 'grimoire-mcp-info' });

    const nameRow = infoEl.createDiv({ cls: 'grimoire-mcp-name-row' });

    const nameEl = nameRow.createSpan({ cls: 'grimoire-mcp-name' });
    nameEl.setText(server.name);

    const serverType = getMcpServerType(server.config);
    const typeEl = nameRow.createSpan({ cls: 'grimoire-mcp-type-badge' });
    typeEl.setText(serverType);

    if (this.features.contextSaving && server.contextSaving) {
      const csEl = nameRow.createSpan({ cls: 'grimoire-mcp-context-saving-badge' });
      csEl.setText('@');
      csEl.setAttribute('title', t('settings.mcp.contextSavingTitle', { server: server.name }));
    }

    const previewEl = infoEl.createDiv({ cls: 'grimoire-mcp-preview' });
    if (server.description) {
      previewEl.setText(server.description);
    } else {
      previewEl.setText(this.getServerPreview(server, serverType));
    }

    const actionsEl = itemEl.createDiv({ cls: 'grimoire-mcp-actions' });

    const testBtn = actionsEl.createEl('button', {
      cls: 'grimoire-mcp-action-btn',
      attr: { 'aria-label': t('settings.mcp.verify') },
    });
    setIcon(testBtn, 'zap');
    testBtn.addEventListener('click', () => {
      void this.testServer(server);
    });

    const toggleBtn = actionsEl.createEl('button', {
      cls: 'grimoire-mcp-action-btn',
      attr: {
        'aria-label': server.name,
        'aria-pressed': String(server.enabled),
        title: server.enabled ? t('common.enabled') : t('common.disabled'),
      },
    });
    setIcon(toggleBtn, server.enabled ? 'toggle-right' : 'toggle-left');
    toggleBtn.addEventListener('click', () => {
      void this.toggleServer(server);
    });

    const editBtn = actionsEl.createEl('button', {
      cls: 'grimoire-mcp-action-btn',
      attr: { 'aria-label': t('common.edit') },
    });
    setIcon(editBtn, 'pencil');
    editBtn.addEventListener('click', () => this.openModal(server));

    const deleteBtn = actionsEl.createEl('button', {
      cls: 'grimoire-mcp-action-btn grimoire-mcp-delete-btn',
      attr: { 'aria-label': t('common.delete') },
    });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.addEventListener('click', () => {
      void this.deleteServer(server);
    });
  }

  private async testServer(server: ManagedMcpServer) {
    const modal = this.features.toolFiltering
      ? new McpTestModal(
        this.app,
        server.name,
        server.disabledTools,
        async (toolName, enabled) => {
          await this.updateDisabledTool(server, toolName, enabled);
        },
        async (disabledTools) => {
          await this.updateAllDisabledTools(server, disabledTools);
        },
      )
      : new McpTestModal(this.app, server.name);
    modal.open();

    try {
      const result = await testMcpServer(server);
      modal.setResult(result);
    } catch (error) {
      modal.setError(error instanceof Error ? error.message : t('settings.mcp.verificationFailed'));
    }
  }

  /** Rolls back on save failure; warns on reload failure (since save succeeded). */
  private async updateServerDisabledTools(
    server: ManagedMcpServer,
    newDisabledTools: string[] | undefined
  ): Promise<void> {
    const previous = server.disabledTools ? [...server.disabledTools] : undefined;
    server.disabledTools = newDisabledTools;

    try {
      await this.mcpStorage.save(this.servers);
    } catch (error) {
      server.disabledTools = previous;
      throw error;
    }

    try {
      await this.broadcastMcpReload();
    } catch {
      // Save succeeded but reload failed - don't rollback since disk has correct state
      new Notice(t('settings.mcp.reloadFailed'));
    }
  }

  private async updateDisabledTool(
    server: ManagedMcpServer,
    toolName: string,
    enabled: boolean
  ) {
    const disabledTools = new Set(server.disabledTools ?? []);
    if (enabled) {
      disabledTools.delete(toolName);
    } else {
      disabledTools.add(toolName);
    }
    await this.updateServerDisabledTools(
      server,
      disabledTools.size > 0 ? Array.from(disabledTools) : undefined
    );
  }

  private async updateAllDisabledTools(server: ManagedMcpServer, disabledTools: string[]) {
    await this.updateServerDisabledTools(
      server,
      disabledTools.length > 0 ? disabledTools : undefined
    );
  }

  private getServerPreview(server: ManagedMcpServer, type: McpServerType): string {
    if (type === 'stdio') {
      const config = server.config as { command: string; args?: string[] };
      const args = config.args?.join(' ') || '';
      return args ? `${config.command} ${args}` : config.command;
    } else {
      const config = server.config as { url: string };
      return config.url;
    }
  }

  private openModal(existing: ManagedMcpServer | null, initialType?: McpServerType) {
    const modal = new McpServerModal(
      this.app,
      existing,
      (server) => {
        void this.saveServer(server, existing).catch((error: unknown) => {
          new Notice(error instanceof Error ? error.message : t('settings.mcp.saveFailed'));
        });
      },
      initialType,
      undefined,
      this.features,
    );
    modal.open();
  }

  private async importFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        new Notice(t('settings.mcp.clipboardEmpty'));
        return;
      }

      const parsed = tryParseClipboardConfig(text);
      if (!parsed || parsed.servers.length === 0) {
        new Notice(t('settings.mcp.clipboardInvalid'));
        return;
      }

      if (parsed.needsName || parsed.servers.length === 1) {
        const server = parsed.servers[0];
        const type = getMcpServerType(server.config);
        const modal = new McpServerModal(
          this.app,
          null,
          (savedServer) => {
            void this.saveServer(savedServer, null).catch((error: unknown) => {
              new Notice(error instanceof Error ? error.message : t('settings.mcp.saveFailed'));
            });
          },
          type,
          server, // Pre-fill with parsed config
          this.features,
        );
        modal.open();
        if (parsed.needsName) {
          new Notice(t('settings.mcp.enterServerName'));
        }
        return;
      }

      await this.importServers(parsed.servers);
    } catch {
      new Notice(t('settings.mcp.clipboardReadFailed'));
    }
  }

  private async saveServer(server: ManagedMcpServer, existing: ManagedMcpServer | null) {
    if (existing) {
      const index = this.servers.findIndex((s) => s.name === existing.name);
      if (index !== -1) {
        if (server.name !== existing.name) {
          const conflict = this.servers.find((s) => s.name === server.name);
          if (conflict) {
            new Notice(t('settings.mcp.serverExists', { name: server.name }));
            return;
          }
        }
        this.servers[index] = server;
      }
    } else {
      const conflict = this.servers.find((s) => s.name === server.name);
      if (conflict) {
        new Notice(t('settings.mcp.serverExists', { name: server.name }));
        return;
      }
      this.servers.push(server);
    }

    await this.mcpStorage.save(this.servers);
    await this.broadcastMcpReload();
    this.render();
    new Notice(existing
      ? t('settings.mcp.serverUpdated', { name: server.name })
      : t('settings.mcp.serverAdded', { name: server.name }));
  }

  private async importServers(servers: Array<{ name: string; config: McpServerConfig }>) {
    const added: string[] = [];
    const skipped: string[] = [];

    for (const server of servers) {
      const name = server.name.trim();
      if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
        skipped.push(server.name || t('settings.mcp.unnamed'));
        continue;
      }

      const conflict = this.servers.find((s) => s.name === name);
      if (conflict) {
        skipped.push(name);
        continue;
      }

      this.servers.push({
        name,
        config: server.config,
        enabled: DEFAULT_MCP_SERVER.enabled,
        contextSaving: this.features.contextSaving
          ? DEFAULT_MCP_SERVER.contextSaving
          : false,
      });
      added.push(name);
    }

    if (added.length === 0) {
      new Notice(t('settings.mcp.noNewServers'));
      return;
    }

    await this.mcpStorage.save(this.servers);
    await this.broadcastMcpReload();
    this.render();

    new Notice(skipped.length > 0
      ? t('settings.mcp.importedWithSkipped', { added: added.length, skipped: skipped.length })
      : t('settings.mcp.imported', { count: added.length }));
  }

  private async toggleServer(server: ManagedMcpServer) {
    server.enabled = !server.enabled;
    await this.mcpStorage.save(this.servers);
    await this.broadcastMcpReload();
    this.render();
    new Notice(server.enabled
      ? t('settings.mcp.serverEnabled', { name: server.name })
      : t('settings.mcp.serverDisabled', { name: server.name }));
  }

  private async deleteServer(server: ManagedMcpServer) {
    if (!(await confirmDelete(this.app, t('settings.mcp.deleteConfirm', { name: server.name })))) {
      return;
    }

    this.servers = this.servers.filter((s) => s.name !== server.name);
    await this.mcpStorage.save(this.servers);
    await this.broadcastMcpReload();
    this.render();
    new Notice(t('settings.mcp.serverDeleted', { name: server.name }));
  }

  /** Refresh the server list (call after external changes). */
  public refresh() {
    void this.loadAndRender();
  }

  /** Detach the document-level click handler. Call when the owner tears down. */
  public dispose() {
    this.detachDocumentClickHandler();
  }

  private closeAddDropdown(dropdown: HTMLElement): void {
    dropdown.removeClass('is-visible');
    this.detachDocumentClickHandler();
  }

  private detachDocumentClickHandler(): void {
    if (!this.documentClickHandler) return;
    (this.containerEl.ownerDocument ?? window.document).removeEventListener('click', this.documentClickHandler);
    this.documentClickHandler = null;
  }
}
