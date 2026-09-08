import { setIcon } from 'obsidian';

import type { ApprovalDecisionOption } from '../../../core/runtime/types';
import { t } from '../../../i18n/i18n';
import { setToolIcon } from './ToolCallRenderer';

export interface InlinePermissionRequestConfig {
  toolName: string;
  input: Record<string, unknown>;
  description: string;
  decisionOptions: ApprovalDecisionOption[];
  decisionReason?: string;
  blockedPath?: string;
  target?: string;
  agentID?: string;
  resolve: (value: string | null) => void;
}

type PermissionAction = 'allow' | 'always' | 'reject' | 'other';

let permissionDialogSequence = 0;

export class InlinePermissionRequest {
  private containerEl: HTMLElement;
  private config: InlinePermissionRequestConfig;
  private resolved = false;
  private rootEl!: HTMLElement;
  private readonly titleId = `grimoire-permission-title-${++permissionDialogSequence}`;
  private boundKeyDown: (event: KeyboardEvent) => void;

  constructor(containerEl: HTMLElement, config: InlinePermissionRequestConfig) {
    this.containerEl = containerEl;
    this.config = config;
    this.boundKeyDown = (event) => this.handleKeyDown(event);
  }

  render(): void {
    this.rootEl = this.containerEl.createDiv({ cls: 'grimoire-permission-anchor' });

    const cardEl = this.rootEl.createDiv({ cls: 'grimoire-permission-request' });
    cardEl.setAttribute('role', 'dialog');
    cardEl.setAttribute('aria-labelledby', this.titleId);
    cardEl.setAttribute('tabindex', '-1');

    this.renderHeader(cardEl);
    this.renderBody(cardEl);
    this.renderActions(cardEl);

    const ownerDocument = this.rootEl.ownerDocument ?? window.document;
    ownerDocument.addEventListener('keydown', this.boundKeyDown);

    window.requestAnimationFrame(() => {
      cardEl.focus();
    });
  }

  destroy(): void {
    this.handleResolve(null);
  }

  private renderHeader(cardEl: HTMLElement): void {
    const headEl = cardEl.createDiv({ cls: 'grimoire-permission-head' });
    const shieldEl = headEl.createSpan({ cls: 'grimoire-permission-shield' });
    setIcon(shieldEl, 'shield-check');

    const titleEl = headEl.createDiv({ cls: 'grimoire-permission-title-block' });
    titleEl.createEl('strong', {
      cls: 'grimoire-permission-title',
      text: t('chat.ui.permission.required'),
      attr: { id: this.titleId },
    });
    titleEl.createSpan({
      cls: 'grimoire-permission-subtitle',
      text: this.getSubtitle(),
    });

    const toolEl = headEl.createSpan({ cls: 'grimoire-permission-tool grimoire-ask-approval-tool' });
    const command = this.getCommandText();
    if (command) {
      toolEl.setAttribute('title', command);
      toolEl.setAttribute('aria-label', t('chat.ui.permission.commandPreview', { command }));
    }
    const iconEl = toolEl.createSpan({ cls: 'grimoire-ask-approval-icon' });
    setToolIcon(iconEl, command ? 'bash' : this.config.toolName);
    toolEl.createSpan({
      cls: 'grimoire-permission-tool-label grimoire-ask-approval-tool-name',
      text: this.getToolLabel(),
    });
  }

  private renderBody(cardEl: HTMLElement): void {
    const command = this.getCommandText();
    const description = this.getDescription();
    const target = this.getRequestTarget();
    const showTarget = Boolean(target);
    if (!this.config.decisionReason && !this.config.blockedPath && !this.config.agentID && !command && !description && !showTarget) {
      return;
    }

    const bodyEl = cardEl.createDiv({ cls: 'grimoire-permission-body grimoire-ask-approval-info' });

    if (this.config.decisionReason) {
      bodyEl.createDiv({
        cls: 'grimoire-permission-reason grimoire-ask-approval-reason',
        text: this.config.decisionReason,
      });
    }

    if (this.config.blockedPath) {
      bodyEl.createDiv({
        cls: 'grimoire-permission-blocked-path grimoire-ask-approval-blocked-path',
        text: this.config.blockedPath,
      });
    }

    if (this.config.agentID) {
      bodyEl.createDiv({
        cls: 'grimoire-permission-agent grimoire-ask-approval-agent',
        text: t('chat.ui.permission.agent', { agent: this.config.agentID }),
      });
    }

    if (command) {
      const commandEl = bodyEl.createDiv({ cls: 'grimoire-permission-command' });
      commandEl.createSpan({ cls: 'grimoire-permission-dollar', text: '$' });
      commandEl.createEl('code', { cls: 'grimoire-permission-command-code', text: command });
    }

    if (showTarget && target) {
      bodyEl.createEl('code', { cls: 'grimoire-permission-target', text: target });
    }

    if (description) {
      bodyEl.createDiv({
        cls: 'grimoire-permission-description grimoire-ask-approval-desc',
        text: description,
      });
    }
  }

  private renderActions(cardEl: HTMLElement): void {
    const actionsEl = cardEl.createDiv({ cls: 'grimoire-permission-actions grimoire-ask-list' });

    /*
     * Numbered choices, the way every other decision surface numbers them: the
     * key that answers this row sits in a column of its own, and rejecting is
     * `esc` rather than the fourth number. Each row used to open with a 14px
     * accent glyph instead, which made the safe answer the loudest thing on a
     * card about caution.
     */
    for (const { key, option } of this.getKeyedOptions()) {
      const action = this.getAction(option);
      const buttonEl = actionsEl.createEl('button', {
        cls: [
          'grimoire-permission-button',
          'grimoire-ask-item',
          `grimoire-permission-button--${action}`,
        ].join(' '),
        attr: { type: 'button' },
      });

      buttonEl.createSpan({ cls: 'grimoire-permission-button-key', text: key });

      buttonEl.createSpan({
        cls: 'grimoire-permission-button-label',
        text: this.getDisplayLabel(option),
      });
      buttonEl.createSpan({
        cls: 'grimoire-ask-item-label grimoire-permission-compat-label',
        text: option.label,
      });
      if (option.description) {
        buttonEl.createSpan({
          cls: 'grimoire-ask-item-desc grimoire-permission-option-description',
          text: option.description,
        });
      }
      buttonEl.addEventListener('click', () => this.handleResolve(option.value));
    }
  }

  /**
   * Each choice with the key that answers it — one list, read by the drawing
   * and by the keyboard.
   *
   * They were two lists that disagreed. The card drew `1` and `2` and listened
   * for `Enter` and `a`, so the keys it advertised did nothing at all; and
   * every rejecting choice was drawn as `esc`, so a card offering two ways to
   * say no showed `esc` twice and `Escape` could only ever reach the first of
   * them. `esc` belongs to one row, the way the design draws it, and everything
   * else is numbered in the order it is listed.
   */
  private getKeyedOptions(): { key: string; option: ApprovalDecisionOption }[] {
    let escapeTaken = false;
    let choiceNumber = 0;
    return this.getOrderedOptions().map(option => {
      if (!escapeTaken && this.getAction(option) === 'reject') {
        escapeTaken = true;
        return { key: 'esc', option };
      }
      choiceNumber += 1;
      return { key: String(choiceNumber), option };
    });
  }

  private getOrderedOptions(): ApprovalDecisionOption[] {
    const actionOrder: Record<PermissionAction, number> = {
      allow: 0,
      always: 1,
      other: 2,
      reject: 3,
    };
    return this.config.decisionOptions
      .map((option, index) => ({ option, index }))
      .sort((left, right) => actionOrder[this.getAction(left.option)] - actionOrder[this.getAction(right.option)]
        || left.index - right.index)
      .map(({ option }) => option);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.resolved) return;

    if (event.key === 'Enter') {
      const option = this.findOption('allow');
      if (option) {
        event.preventDefault();
        event.stopPropagation();
        this.handleResolve(option.value);
      }
      return;
    }

    if (event.key === 'a' || event.key === 'A') {
      const option = this.findOption('always');
      if (option) {
        event.preventDefault();
        event.stopPropagation();
        this.handleResolve(option.value);
      }
      return;
    }

    // The keys the card actually draws. Without this the numbers were decoration.
    const numbered = this.getKeyedOptions().find(entry => entry.key === event.key);
    if (numbered) {
      event.preventDefault();
      event.stopPropagation();
      this.handleResolve(numbered.option.value);
      return;
    }

    if (event.key === 'Escape') {
      const escaped = this.getKeyedOptions().find(entry => entry.key === 'esc');
      event.preventDefault();
      event.stopPropagation();
      this.handleResolve(escaped?.option.value ?? null);
    }
  }

  private findOption(action: PermissionAction): ApprovalDecisionOption | undefined {
    return this.config.decisionOptions.find(option => this.getAction(option) === action);
  }

  private getAction(option: ApprovalDecisionOption): PermissionAction {
    if (option.presentation) return option.presentation;
    if (option.decision === 'allow') return 'allow';
    if (option.decision === 'allow-always') return 'always';
    if (option.decision === 'deny' || option.decision === 'cancel') return 'reject';
    if (option.decision) return 'other';

    const normalized = option.label.trim().toLowerCase();
    if (/^(?:always allow|allow always)\b/.test(normalized)) return 'always';
    if (/^(?:allow|allow once|allow this time|allow now)$/.test(normalized)) return 'allow';
    if (/^(?:deny|reject|cancel)\b/.test(normalized)) {
      return 'reject';
    }
    return 'other';
  }

  private getDisplayLabel(option: ApprovalDecisionOption): string {
    const action = this.getAction(option);
    if (action === 'reject' && /^deny$/i.test(option.label)) {
      return t('chat.ui.permission.reject');
    }
    return option.label;
  }

  private getToolLabel(): string {
    const command = this.getCommandText();
    if (command) {
      return buildPermissionCommandSummary(command);
    }

    const toolName = this.config.toolName.trim() || t('chat.ui.permission.tool');
    if (/^(?:bash|execute|run)(?:\s|$)/i.test(toolName)) {
      return 'bash';
    }
    return toolName;
  }

  private getSubtitle(): string {
    if (this.getCommandText() || this.getToolLabel() === 'bash') {
      return t('chat.ui.permission.runShellCommand');
    }
    return t('chat.ui.permission.useTool', { tool: this.getToolLabel() });
  }

  private getCommandText(): string {
    const command = this.config.input.command ?? this.config.input.cmd;
    return typeof command === 'string' ? command : '';
  }

  private getRequestTarget(): string | null {
    if (this.getCommandText()) return null;

    const explicitTarget = this.config.target?.trim();
    if (explicitTarget && !this.matchesBlockedPath(explicitTarget)) {
      return explicitTarget;
    }

    for (const key of [
      'url',
      'uri',
      'host',
      'path',
      'filePath',
      'filepath',
      'file_path',
      'notebook_path',
    ]) {
      const value = this.config.input[key];
      if (typeof value === 'string' && value.trim() && !this.matchesBlockedPath(value)) {
        return value.trim();
      }
    }

    return [this.config.description, this.config.toolName]
      .map(value => value.match(/https?:\/\/[^\s`"')\]}]+/i)?.[0])
      .find((value): value is string => Boolean(value)) ?? null;
  }

  private matchesBlockedPath(value: string): boolean {
    return Boolean(this.config.blockedPath
      && this.config.blockedPath.trim() === value.trim());
  }

  private getDescription(): string | null {
    if (!this.getCommandText()) {
      const description = this.config.description.trim();
      return this.isRedundantToolDescription(description) ? null : description;
    }

    const providerRequest = this.config.description.match(/^(.+?) wants permission to use\b/i);
    if (providerRequest?.[1]) {
      return t('chat.ui.permission.providerRequestedCommand', { provider: providerRequest[1] });
    }

    const command = this.getCommandText().trim();
    const description = this.config.description.trim();
    const normalizedDescription = description
      .replace(/^(?:execute|run(?: command)?):?\s*/i, '')
      .trim();
    if (!description || description === command || normalizedDescription === command) {
      return null;
    }

    return description;
  }

  private isRedundantToolDescription(description: string): boolean {
    const toolName = this.config.toolName.trim();
    if (!toolName) return false;

    return normalizePermissionDescription(description)
      === normalizePermissionDescription(`${toolName} requests permission.`);
  }

  private handleResolve(value: string | null): void {
    if (this.resolved) return;
    this.resolved = true;

    const ownerDocument = this.rootEl?.ownerDocument ?? window.document;
    ownerDocument.removeEventListener('keydown', this.boundKeyDown);
    this.rootEl?.remove();
    this.config.resolve(value);
  }
}

export function buildPermissionCommandSummary(command: string): string {
  const tokens = tokenizeCommandPreview(command);
  const executableToken = tokens.shift();
  if (!executableToken) {
    return t('chat.ui.permission.shellCommand');
  }

  const executable = getPathBasename(executableToken) || executableToken;
  if (executable === 'find') {
    return buildFindCommandSummary(tokens);
  }

  const argumentLabels: string[] = [];
  let remainingArgumentCount = 0;

  for (const token of tokens) {
    if (isShellOperator(token)) {
      break;
    }
    if (token.startsWith('-') || isRedirectionToken(token)) {
      continue;
    }

    const label = summarizeCommandArgument(token);
    if (!label || argumentLabels.includes(label)) {
      continue;
    }
    if (argumentLabels.length < 2) {
      argumentLabels.push(label);
    } else {
      remainingArgumentCount += 1;
    }
  }

  if (argumentLabels.length === 0) {
    return truncateCommandSummary(executable, 44);
  }

  const suffix = remainingArgumentCount > 0 ? ` +${remainingArgumentCount}` : '';
  return truncateCommandSummary(
    `${executable} · ${argumentLabels.join(', ')}${suffix}`,
    64,
  );
}

function buildFindCommandSummary(tokens: string[]): string {
  const patterns: string[] = [];
  let remainingPatternCount = 0;

  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (!/^-i?name$/.test(tokens[index] ?? '')) {
      continue;
    }

    const pattern = summarizeCommandArgument(tokens[index + 1] ?? '');
    if (!pattern || patterns.includes(pattern)) {
      continue;
    }
    if (patterns.length < 2) {
      patterns.push(pattern);
    } else {
      remainingPatternCount += 1;
    }
  }

  if (patterns.length === 0) {
    return 'find';
  }

  const suffix = remainingPatternCount > 0 ? ` +${remainingPatternCount}` : '';
  return truncateCommandSummary(`find · ${patterns.join(', ')}${suffix}`, 64);
}

function tokenizeCommandPreview(command: string): string[] {
  return command
    .match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g)
    ?.map(token => token.replace(/^(?:"|')|(?:"|')$/g, ''))
    ?? [];
}

function summarizeCommandArgument(argument: string): string {
  const normalized = argument.replace(/[;,]+$/, '').replace(/[\\/]+$/, '');
  if (!normalized || normalized === '.') {
    return normalized;
  }

  return truncateCommandSummary(getPathBasename(normalized) || normalized, 22);
}

function getPathBasename(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function isShellOperator(token: string): boolean {
  return token === '&&' || token === '||' || token === '|' || token === ';';
}

function isRedirectionToken(token: string): boolean {
  return /^(?:\d*>|\d*>>|\d*<|\d*>&\d+|&>)/.test(token);
}

function truncateCommandSummary(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function normalizePermissionDescription(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    .toLowerCase();
}
