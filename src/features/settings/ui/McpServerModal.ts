import type { App } from 'obsidian';
import { Modal, Notice, Setting } from 'obsidian';

import type {
  ManagedMcpServer,
  McpHttpServerConfig,
  McpServerConfig,
  McpServerType,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../../../core/types';
import { DEFAULT_MCP_SERVER, getMcpServerType } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import { parseCommand } from '../../../utils/mcp';

export interface McpServerModalFeatures {
  contextSaving?: boolean;
  toolFiltering?: boolean;
}

export class McpServerModal extends Modal {
  private existingServer: ManagedMcpServer | null;
  private onSave: (server: ManagedMcpServer) => void;

  private serverName = '';
  private serverType: McpServerType = 'stdio';
  private enabled = DEFAULT_MCP_SERVER.enabled;
  private contextSaving = DEFAULT_MCP_SERVER.contextSaving;
  private command = '';
  private env = '';
  private url = '';
  private headers = '';
  private typeFieldsEl: HTMLElement | null = null;
  private nameInputEl: HTMLInputElement | null = null;
  private readonly features: Required<McpServerModalFeatures>;

  constructor(
    app: App,
    existingServer: ManagedMcpServer | null,
    onSave: (server: ManagedMcpServer) => void,
    initialType?: McpServerType,
    prefillConfig?: { name: string; config: McpServerConfig },
    features: McpServerModalFeatures = {},
  ) {
    super(app);
    this.existingServer = existingServer;
    this.onSave = onSave;
    this.features = {
      contextSaving: features.contextSaving ?? true,
      toolFiltering: features.toolFiltering ?? true,
    };

    if (existingServer) {
      this.serverName = existingServer.name;
      this.serverType = getMcpServerType(existingServer.config);
      this.enabled = existingServer.enabled;
      this.contextSaving = existingServer.contextSaving;
      this.initFromConfig(existingServer.config);
    } else if (prefillConfig) {
      this.serverName = prefillConfig.name;
      this.serverType = getMcpServerType(prefillConfig.config);
      this.initFromConfig(prefillConfig.config);
    } else if (initialType) {
      this.serverType = initialType;
    }

    if (!this.features.contextSaving) {
      this.contextSaving = false;
    }
  }

  private initFromConfig(config: McpServerConfig) {
    const type = getMcpServerType(config);
    if (type === 'stdio') {
      const stdioConfig = config as McpStdioServerConfig;
      if (stdioConfig.args && stdioConfig.args.length > 0) {
        this.command = stdioConfig.command + ' ' + stdioConfig.args.join(' ');
      } else {
        this.command = stdioConfig.command;
      }
      this.env = this.envRecordToString(stdioConfig.env);
    } else {
      const urlConfig = config as McpSSEServerConfig | McpHttpServerConfig;
      this.url = urlConfig.url;
      this.headers = this.envRecordToString(urlConfig.headers);
    }
  }

  onOpen() {
    this.setTitle(this.existingServer ? t('settings.mcp.modal.titleEdit') : t('settings.mcp.modal.titleAdd'));
    this.modalEl.addClass('grimoire-mcp-modal');

    const { contentEl } = this;

    new Setting(contentEl)
      .setName(t('settings.mcp.modal.serverName'))
      .setDesc(t('settings.mcp.modal.serverNameDesc'))
      .addText((text) => {
        this.nameInputEl = text.inputEl;
        text.setValue(this.serverName);
        text.setPlaceholder('My-mcp-server');
        text.onChange((value) => {
          this.serverName = value;
        });
        text.inputEl.addEventListener('keydown', (e) => this.handleKeyDown(e));
      });

    new Setting(contentEl)
      .setName(t('settings.mcp.modal.type'))
      .setDesc(t('settings.mcp.modal.typeDesc'))
      .addDropdown((dropdown) => {
        dropdown.addOption('stdio', t('settings.mcp.modal.stdio'));
        dropdown.addOption('sse', t('settings.mcp.modal.sse'));
        dropdown.addOption('http', t('settings.mcp.modal.http'));
        dropdown.setValue(this.serverType);
        dropdown.onChange((value) => {
          this.serverType = value as McpServerType;
          this.renderTypeFields();
        });
      });

    this.typeFieldsEl = contentEl.createDiv({ cls: 'grimoire-mcp-type-fields' });
    this.renderTypeFields();

    new Setting(contentEl)
      .setName(t('common.enabled'))
      .setDesc(t('settings.mcp.modal.enabledDesc'))
      .addToggle((toggle) => {
        toggle.setValue(this.enabled);
        toggle.onChange((value) => {
          this.enabled = value;
        });
      });

    if (this.features.contextSaving) {
      new Setting(contentEl)
        .setName(t('settings.mcp.modal.contextSaving'))
        .setDesc(t('settings.mcp.modal.contextSavingDesc'))
        .addToggle((toggle) => {
          toggle.setValue(this.contextSaving);
          toggle.onChange((value) => {
            this.contextSaving = value;
          });
        });
    }

    const buttonContainer = contentEl.createDiv({
      cls: 'grimoire-mcp-buttons grimoire-dialog-actions',
    });

    const cancelBtn = buttonContainer.createEl('button', {
      text: t('common.cancel'),
      cls: 'grimoire-cancel-btn',
    });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = buttonContainer.createEl('button', {
      text: this.existingServer ? t('settings.envSnippets.modal.update') : t('common.add'),
      cls: 'grimoire-save-btn mod-cta',
    });
    saveBtn.addEventListener('click', () => this.save());
  }

  private renderTypeFields() {
    if (!this.typeFieldsEl) return;
    this.typeFieldsEl.empty();

    if (this.serverType === 'stdio') {
      this.renderStdioFields();
    } else {
      this.renderUrlFields();
    }
  }

  private renderStdioFields() {
    if (!this.typeFieldsEl) return;

    const cmdSetting = new Setting(this.typeFieldsEl)
      .setName(t('settings.mcp.modal.command'))
      .setDesc(t('settings.mcp.modal.commandDesc'));
    cmdSetting.settingEl.addClass('grimoire-mcp-cmd-setting');

    const cmdTextarea = cmdSetting.controlEl.createEl('textarea', {
      cls: 'grimoire-mcp-cmd-textarea',
    });
    cmdTextarea.value = this.command;
    cmdTextarea.placeholder = 'Docker exec -i mcp-server python -m src.server';
    cmdTextarea.rows = 2;
    cmdTextarea.addEventListener('input', () => {
      this.command = cmdTextarea.value;
    });

    const envSetting = new Setting(this.typeFieldsEl)
      .setName(t('settings.providerTabs.environmentVariables'))
      .setDesc(t('settings.mcp.modal.environmentDesc'));
    envSetting.settingEl.addClass('grimoire-mcp-env-setting');

    const envTextarea = envSetting.controlEl.createEl('textarea', {
      cls: 'grimoire-mcp-env-textarea',
    });
    envTextarea.value = this.env;
    envTextarea.placeholder = 'API_key=your-key';
    envTextarea.rows = 2;
    envTextarea.addEventListener('input', () => {
      this.env = envTextarea.value;
    });
  }

  private renderUrlFields() {
    if (!this.typeFieldsEl) return;

    new Setting(this.typeFieldsEl)
      .setName(t('settings.mcp.modal.url'))
      .setDesc(this.serverType === 'sse' ? t('settings.mcp.modal.sseUrlDesc') : t('settings.mcp.modal.httpUrlDesc'))
      .addText((text) => {
        text.setValue(this.url);
        text.setPlaceholder('HTTP://localhost:3000/sse');
        text.onChange((value) => {
          this.url = value;
        });
        text.inputEl.addEventListener('keydown', (e) => this.handleKeyDown(e));
      });

    const headersSetting = new Setting(this.typeFieldsEl)
      .setName(t('settings.mcp.modal.headers'))
      .setDesc(t('settings.mcp.modal.headersDesc'));
    headersSetting.settingEl.addClass('grimoire-mcp-env-setting');

    const headersTextarea = headersSetting.controlEl.createEl('textarea', {
      cls: 'grimoire-mcp-env-textarea',
    });
    headersTextarea.value = this.headers;
    headersTextarea.placeholder = 'Authorization=bearer token\ncontent-type=application/JSON';
    headersTextarea.rows = 3;
    headersTextarea.addEventListener('input', () => {
      this.headers = headersTextarea.value;
    });
  }

  private handleKeyDown(e: KeyboardEvent) {
    // !e.isComposing for IME support
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this.save();
    } else if (e.key === 'Escape' && !e.isComposing) {
      e.preventDefault();
      this.close();
    }
  }

  private save() {
    const name = this.serverName.trim();
    if (!name) {
      new Notice(t('settings.mcp.modal.serverNameRequired'));
      this.nameInputEl?.focus();
      return;
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
      new Notice(t('settings.mcp.modal.serverNameInvalid'));
      this.nameInputEl?.focus();
      return;
    }

    let config: McpServerConfig;

    if (this.serverType === 'stdio') {
      const fullCommand = this.command.trim();
      if (!fullCommand) {
        new Notice(t('settings.mcp.modal.commandRequired'));
        return;
      }

      const { cmd, args } = parseCommand(fullCommand);
      const stdioConfig: McpStdioServerConfig = { command: cmd };

      if (args.length > 0) {
        stdioConfig.args = args;
      }

      const env = this.parseEnvString(this.env);
      if (Object.keys(env).length > 0) {
        stdioConfig.env = env;
      }

      config = stdioConfig;
    } else {
      const url = this.url.trim();
      if (!url) {
        new Notice(t('settings.mcp.modal.urlRequired'));
        return;
      }

      if (this.serverType === 'sse') {
        const sseConfig: McpSSEServerConfig = { type: 'sse', url };
        const headers = this.parseEnvString(this.headers);
        if (Object.keys(headers).length > 0) {
          sseConfig.headers = headers;
        }
        config = sseConfig;
      } else {
        const httpConfig: McpHttpServerConfig = { type: 'http', url };
        const headers = this.parseEnvString(this.headers);
        if (Object.keys(headers).length > 0) {
          httpConfig.headers = headers;
        }
        config = httpConfig;
      }
    }

    const server: ManagedMcpServer = {
      name,
      config,
      enabled: this.enabled,
      contextSaving: this.contextSaving,
      disabledTools: this.features.toolFiltering
        ? this.existingServer?.disabledTools
        : undefined,
    };

    this.onSave(server);
    this.close();
  }

  private parseEnvString(envStr: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!envStr.trim()) return result;

    for (const line of envStr.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;

      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();

      if (key) {
        result[key] = value;
      }
    }

    return result;
  }

  private envRecordToString(env: Record<string, string> | undefined): string {
    if (!env) return '';
    return Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
  }

  onClose() {
    this.contentEl.empty();
  }
}
