import { setIcon } from 'obsidian';

import type { TodoItem } from '../../../core/tools/todo';
import { getToolIcon, MCP_ICON_MARKER } from '../../../core/tools/toolIcons';
import { extractResolvedAnswersFromResultText } from '../../../core/tools/toolInput';
import {
  isAgentLifecycleTool,
  TOOL_APPLY_PATCH,
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_ENTER_PLAN_MODE,
  TOOL_EXIT_PLAN_MODE,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_LS,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_TODO_WRITE,
  TOOL_TOOL_SEARCH,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
  TOOL_WRITE_STDIN,
} from '../../../core/tools/toolNames';
import { extractToolResultContent } from '../../../core/tools/toolResultContent';
import type { AskUserQuestionItem, ToolCallInfo } from '../../../core/types';
import type { DiffStats } from '../../../core/types/diff';
import { t } from '../../../i18n/i18n';
import { appendMcpIcon } from '../../../shared/icons';
import { parseApplyPatchDiffs, parseFileUpdateChangeDiffs } from '../../../utils/diff';
import { setupCollapsible } from './collapsible';
import { renderDiffContent, renderDiffStats } from './DiffRenderer';
import { renderTodoItems } from './todoUtils';

export function setToolIcon(el: HTMLElement, name: string): void {
  const icon = getToolIcon(name);
  if (icon === MCP_ICON_MARKER) {
    appendMcpIcon(el);
  } else {
    setIcon(el, icon);
  }
}

function stringifyToolValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';

  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function getInputText(input: Record<string, unknown>, key: string, fallback = ''): string {
  return stringifyToolValue(input[key]) || fallback;
}

export function getToolName(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_TODO_WRITE: {
      const todos = input.todos as Array<{ status: string }> | undefined;
      if (todos && Array.isArray(todos) && todos.length > 0) {
        const completed = todos.filter(t => t.status === 'completed').length;
        return t('chat.ui.tools.tasksProgress', { completed, total: todos.length });
      }
      return t('chat.ui.tools.tasks');
    }
    case TOOL_ENTER_PLAN_MODE:
      return t('chat.ui.tools.enteringPlanMode');
    case TOOL_EXIT_PLAN_MODE:
      return t('chat.ui.plan.complete');
    default:
      return name;
  }
}

function isMcpTool(name: string): boolean {
  return name.startsWith('mcp__');
}

function getMcpOperationName(name: string): string {
  const operation = name.split('__').pop() ?? name;
  return operation.replace(/^obsidian_/, '');
}

function getDefaultToolSummary(input: Record<string, unknown>): string {
  const preferredKeys = ['query', 'pattern', 'dirpath', 'filepath', 'file_path', 'path', 'url', 'command'];
  for (const key of preferredKeys) {
    const value = getInputText(input, key);
    if (value) return truncateText(value, 60);
  }

  const firstValue = Object.values(input).find(value => stringifyToolValue(value));
  return firstValue ? truncateText(stringifyToolValue(firstValue), 60) : '';
}

function isVaultSearchTool(toolCall: ToolCallInfo): boolean {
  if (toolCall.name === TOOL_GREP) return true;
  if (!isMcpTool(toolCall.name)) return false;

  const operation = getMcpOperationName(toolCall.name);
  return operation === 'simple_search'
    || operation === 'complex_search'
    || operation === 'list_files_in_dir';
}

function getToolGroupKey(toolCall: ToolCallInfo): string | null {
  if (isVaultSearchTool(toolCall)) return 'vault-search';
  if (toolCall.name === TOOL_WEB_SEARCH) return 'web-search';
  if (toolCall.name === TOOL_GLOB || toolCall.name === TOOL_LS) return 'file-discovery';
  return null;
}

export function canGroupToolCalls(toolCalls: ToolCallInfo[]): boolean {
  if (toolCalls.length < 2) return false;
  const key = getToolGroupKey(toolCalls[0]);
  return key !== null && toolCalls.every(toolCall => getToolGroupKey(toolCall) === key);
}

export function isToolCallGroupable(toolCall: ToolCallInfo): boolean {
  return getToolGroupKey(toolCall) !== null;
}

export function getToolDisplayName(toolCall: ToolCallInfo): string {
  switch (toolCall.name) {
    case TOOL_BASH:
      return toolCall.status === 'completed' ? t('chat.ui.tools.ranCommand') : t('chat.ui.tools.runCommand');
    case TOOL_READ:
      return toolCall.status === 'completed' ? t('chat.ui.tools.readNote') : t('chat.ui.tools.readingNote');
    case TOOL_WRITE:
      return toolCall.status === 'completed' ? t('chat.ui.tools.wroteFile') : t('chat.ui.tools.writingFile');
    case TOOL_EDIT:
      return toolCall.status === 'completed' ? t('chat.ui.tools.editedFile') : t('chat.ui.tools.editingFile');
    case TOOL_GLOB:
      return toolCall.status === 'running' ? t('chat.ui.tools.globbingFiles') : t('chat.ui.tools.globbedFiles');
    case TOOL_GREP:
      return toolCall.status === 'running' ? t('chat.ui.tools.searchingFiles') : t('chat.ui.tools.searchedFiles');
    case TOOL_LS:
      return toolCall.status === 'running' ? t('chat.ui.tools.listingFiles') : t('chat.ui.tools.listedFiles');
    case TOOL_WEB_SEARCH:
      return toolCall.status === 'running' ? t('chat.ui.tools.searchingWeb') : t('chat.ui.tools.searchedWeb');
    case TOOL_WEB_FETCH:
      return toolCall.status === 'running' ? t('chat.ui.tools.fetchingPage') : t('chat.ui.tools.fetchedPage');
    case TOOL_TOOL_SEARCH:
      return toolCall.status === 'running' ? t('chat.ui.tools.searchingTools') : t('chat.ui.tools.searchedTools');
    case TOOL_TODO_WRITE:
      return getToolName(toolCall.name, toolCall.input);
    case TOOL_APPLY_PATCH:
      return toolCall.status === 'running' ? t('chat.ui.tools.applyingPatch') : t('chat.ui.tools.appliedPatch');
    case TOOL_WRITE_STDIN:
      return t('chat.ui.tools.sentInput');
    case TOOL_SKILL:
      return t('chat.ui.tools.loadedSkill');
    default:
      if (isMcpTool(toolCall.name)) {
        return getMcpOperationName(toolCall.name);
      }
      if (isAgentLifecycleTool(toolCall.name)) {
        return getToolName(toolCall.name, toolCall.input);
      }
      return getToolName(toolCall.name, toolCall.input);
  }
}

export function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_READ:
    case TOOL_WRITE:
    case TOOL_EDIT: {
      const filePath = getInputText(input, 'file_path');
      return fileNameOnly(filePath);
    }
    case TOOL_BASH: {
      const cmd = getInputText(input, 'command');
      return truncateText(cmd, 60);
    }
    case TOOL_GLOB:
    case TOOL_GREP:
      return getInputText(input, 'pattern');
    case TOOL_WEB_SEARCH:
      return getWebSearchSummary(input, 60);
    case TOOL_WEB_FETCH:
      return truncateText(getInputText(input, 'url'), 60);
    case TOOL_LS:
      return fileNameOnly(getInputText(input, 'path', '.'));
    case TOOL_SKILL:
      return getInputText(input, 'skill');
    case TOOL_TOOL_SEARCH:
      return truncateText(parseToolSearchQuery(getInputText(input, 'query')), 60);
    case TOOL_TODO_WRITE:
      return '';
    case TOOL_APPLY_PATCH:
      return getApplyPatchSummary(input);
    case TOOL_WRITE_STDIN:
      return getWriteStdinSummary(input);
    default:
      if (isMcpTool(name)) {
        return getDefaultToolSummary(input);
      }
      if (isAgentLifecycleTool(name)) {
        return getAgentLifecycleSummary(name, input);
      }
      return '';
  }
}

/** Combined name+summary for ARIA labels (collapsible regions need a single descriptive phrase). */
export function getToolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case TOOL_READ:
      return `Read: ${shortenPath(getInputText(input, 'file_path')) || 'file'}`;
    case TOOL_WRITE:
      return `Write: ${shortenPath(getInputText(input, 'file_path')) || 'file'}`;
    case TOOL_EDIT:
      return `Edit: ${shortenPath(getInputText(input, 'file_path')) || 'file'}`;
    case TOOL_BASH: {
      const cmd = getInputText(input, 'command', 'command');
      return `Bash: ${cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd}`;
    }
    case TOOL_GLOB:
      return `Glob: ${getInputText(input, 'pattern', 'files')}`;
    case TOOL_GREP:
      return `Grep: ${getInputText(input, 'pattern', 'pattern')}`;
    case TOOL_WEB_SEARCH: {
      return getWebSearchLabel(input, 40);
    }
    case TOOL_WEB_FETCH: {
      const url = getInputText(input, 'url', 'url');
      return `WebFetch: ${url.length > 40 ? url.substring(0, 40) + '...' : url}`;
    }
    case TOOL_LS:
      return `LS: ${shortenPath(getInputText(input, 'path')) || '.'}`;
    case TOOL_TODO_WRITE: {
      const todos = input.todos as Array<{ status: string }> | undefined;
      if (todos && Array.isArray(todos)) {
        const completed = todos.filter(t => t.status === 'completed').length;
        return `Tasks (${completed}/${todos.length})`;
      }
      return 'Tasks';
    }
    case TOOL_SKILL: {
      const skillName = getInputText(input, 'skill', 'skill');
      return `Skill: ${skillName}`;
    }
    case TOOL_TOOL_SEARCH: {
      const tools = parseToolSearchQuery(getInputText(input, 'query'));
      return `ToolSearch: ${tools || 'tools'}`;
    }
    case TOOL_ENTER_PLAN_MODE:
      return 'Entering plan mode';
    case TOOL_EXIT_PLAN_MODE:
      return 'Plan complete';
    case TOOL_APPLY_PATCH: {
      const summary = getApplyPatchSummary(input);
      return summary ? `apply_patch: ${summary}` : 'apply_patch';
    }
    case TOOL_WRITE_STDIN: {
      const summary = getWriteStdinSummary(input);
      return summary ? `write_stdin: ${summary}` : 'write_stdin';
    }
    default:
      if (isAgentLifecycleTool(name)) {
        const summary = getAgentLifecycleSummary(name, input);
        return summary ? `${name}: ${summary}` : name;
      }
      return name;
  }
}

export function fileNameOnly(filePath: string): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? normalized;
}

function getApplyPatchSummary(input: Record<string, unknown>): string {
  // Extract file paths from patch text markers
  const patchText = typeof input.patch === 'string' ? input.patch : '';
  const patchFiles = [...patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
    .map(m => m[1]?.trim() ?? '');

  // Also check changes array
  const changes = input.changes;
  const changeFiles = Array.isArray(changes)
    ? (changes as Array<{ path?: string }>)
        .map(c => c.path)
        .filter((p): p is string => !!p)
    : [];

  const files = [...new Set([...patchFiles, ...changeFiles])];
  if (files.length === 0) return patchText ? 'patch' : '';
  if (files.length === 1) return fileNameOnly(files[0]);
  return `${files.length} files`;
}

function getWriteStdinSummary(input: Record<string, unknown>): string {
  const sessionId = stringifyToolValue(input.session_id ?? input.sessionId);
  const chars = typeof input.chars === 'string' ? input.chars.replace(/\n/g, '\\n') : '';
  if (chars) {
    const preview = chars.length > 24 ? `${chars.slice(0, 24)}...` : chars;
    return sessionId ? `#${sessionId} ${preview}` : preview;
  }
  return sessionId ? `#${sessionId}` : '';
}

function getAgentLifecycleSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'spawn_agent': {
      const msg = typeof input.message === 'string' ? input.message : '';
      return msg.length > 50 ? `${msg.slice(0, 50)}...` : msg;
    }
    case 'send_input': {
      const msg = typeof input.message === 'string' ? input.message : '';
      return msg.length > 40 ? `${msg.slice(0, 40)}...` : msg;
    }
    case 'wait': {
      const ids = Array.isArray(input.ids) ? input.ids.length : 0;
      const timeoutMs = typeof input.timeout_ms === 'number' ? input.timeout_ms : undefined;
      const parts: string[] = [];
      if (ids > 0) parts.push(`${ids} agent${ids === 1 ? '' : 's'}`);
      if (timeoutMs !== undefined) parts.push(`${Math.round(timeoutMs / 1000)}s`);
      return parts.join(', ');
    }
    case 'resume_agent':
    case 'close_agent':
      return '';
    default:
      return '';
  }
}

function shortenPath(filePath: string | undefined): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.length <= 3) return normalized;
  return '.../' + parts.slice(-2).join('/');
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function parseToolSearchQuery(query: string | undefined): string {
  if (!query) return '';
  const selectPrefix = 'select:';
  const body = query.startsWith(selectPrefix) ? query.slice(selectPrefix.length) : query;
  return body.split(',').map(s => s.trim()).filter(Boolean).join(', ');
}

interface WebSearchLink {
  title: string;
  url: string;
}

interface WebSearchDisplayData {
  actionType: string;
  query: string;
  queries: string[];
  url: string;
  pattern: string;
}

function normalizeWebSearchDisplayData(input: Record<string, unknown>): WebSearchDisplayData {
  const queries = Array.isArray(input.queries)
    ? input.queries
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map(entry => entry.trim())
    : [];

  const query = typeof input.query === 'string' && input.query.trim()
    ? input.query.trim()
    : queries[0] ?? '';
  const url = typeof input.url === 'string' && input.url.trim() ? input.url.trim() : '';
  const pattern = typeof input.pattern === 'string' && input.pattern.trim() ? input.pattern.trim() : '';

  const explicitActionType = typeof input.actionType === 'string' && input.actionType.trim()
    ? input.actionType.trim()
    : '';
  const actionType = explicitActionType
    || (url && pattern ? 'find_in_page' : url ? 'open_page' : (query || queries.length > 0) ? 'search' : '');

  return { actionType, query, queries, url, pattern };
}

function getWebSearchSummary(input: Record<string, unknown>, maxLength: number): string {
  const data = normalizeWebSearchDisplayData(input);

  switch (data.actionType) {
    case 'open_page':
      return truncateText(`Open ${data.url || 'page'}`, maxLength);
    case 'find_in_page': {
      const target = data.pattern ? `Find "${data.pattern}"` : 'Find in page';
      const suffix = data.url ? ` in ${data.url}` : '';
      return truncateText(target + suffix, maxLength);
    }
    case 'search':
      return truncateText(data.query || data.queries[0] || '', maxLength);
    default:
      return truncateText(data.query || data.url || data.pattern || '', maxLength);
  }
}

function getWebSearchLabel(input: Record<string, unknown>, maxLength: number): string {
  const summary = getWebSearchSummary(input, maxLength);
  return `WebSearch: ${summary || 'search'}`;
}

/**
 * Only http(s) URLs are safe to expose as a navigable href. Tool inputs and
 * web-search result bodies are model-controlled, so schemes such as
 * `javascript:` or `file:` must never reach an anchor's href.
 */
function isSafeLinkUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function appendToolLink(parent: HTMLElement, title: string, url: string): void {
  const linkEl = parent.createEl('a', { cls: 'grimoire-tool-link' });
  if (isSafeLinkUrl(url)) {
    linkEl.setAttribute('href', url);
    linkEl.setAttribute('target', '_blank');
    linkEl.setAttribute('rel', 'noopener noreferrer');
  }

  const iconEl = linkEl.createSpan({ cls: 'grimoire-tool-link-icon' });
  setIcon(iconEl, 'external-link');

  linkEl.createSpan({ cls: 'grimoire-tool-link-title', text: title });
}

function isPlaceholderWebSearchResult(result: string | undefined): boolean {
  if (!result) return true;
  const normalized = result.trim().toLowerCase();
  return normalized === '' || normalized === 'search complete';
}

function parseWebSearchResult(result: string): { links: WebSearchLink[]; summary: string } | null {
  const linksMatch = result.match(/Links:\s*(\[[\s\S]*?\])(?:\n|$)/);
  if (!linksMatch) return null;

  try {
    const parsed = JSON.parse(linksMatch[1]) as WebSearchLink[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const linksEndIndex = result.indexOf(linksMatch[0]) + linksMatch[0].length;
    const summary = result.slice(linksEndIndex).trim();
    return { links: parsed.filter(l => l.title && l.url), summary };
  } catch {
    return null;
  }
}

function renderWebSearchActionExpanded(container: HTMLElement, input: Record<string, unknown>): boolean {
  const data = normalizeWebSearchDisplayData(input);
  const hasStructuredData = Boolean(data.actionType || data.query || data.queries.length || data.url || data.pattern);
  if (!hasStructuredData) {
    return false;
  }

  const linesEl = container.createDiv({ cls: 'grimoire-tool-lines' });

  switch (data.actionType) {
    case 'open_page':
      linesEl.createDiv({ cls: 'grimoire-tool-line', text: t('chat.ui.tools.openPage') });
      if (data.url) {
        appendToolLink(linesEl, data.url, data.url);
      } else {
        linesEl.createDiv({ cls: 'grimoire-tool-line', text: t('chat.ui.tools.urlUnavailable') });
      }
      return true;

    case 'find_in_page':
      linesEl.createDiv({ cls: 'grimoire-tool-line', text: t('chat.ui.tools.findInPage') });
      if (data.url) {
        appendToolLink(linesEl, data.url, data.url);
      } else {
        linesEl.createDiv({ cls: 'grimoire-tool-line', text: t('chat.ui.tools.urlUnavailable') });
      }
      if (data.pattern) {
        linesEl.createDiv({ cls: 'grimoire-tool-line', text: t('chat.ui.tools.pattern', { pattern: data.pattern }) });
      }
      return true;

    case 'search':
    default: {
      const primaryQuery = data.query || data.queries[0];
      linesEl.createDiv({
        cls: 'grimoire-tool-line',
        text: primaryQuery
          ? t('chat.ui.tools.query', { query: primaryQuery })
          : t('chat.ui.tools.searchWeb'),
      });

      const alternateQueries = data.queries.filter(query => query !== primaryQuery);
      for (const query of alternateQueries.slice(0, 4)) {
        linesEl.createDiv({ cls: 'grimoire-tool-line', text: t('chat.ui.tools.altQuery', { query }) });
      }
      if (alternateQueries.length > 4) {
        linesEl.createDiv({
          cls: 'grimoire-tool-truncated',
          text: t('chat.ui.tools.moreQueries', { count: alternateQueries.length - 4 }),
        });
      }
      return true;
    }
  }
}

function renderWebSearchExpanded(
  container: HTMLElement,
  input: Record<string, unknown>,
  result: string | undefined,
): void {
  const parsed = result ? parseWebSearchResult(result) : null;
  if (parsed && parsed.links.length > 0) {
    const linksEl = container.createDiv({ cls: 'grimoire-tool-lines' });
    for (const link of parsed.links) {
      appendToolLink(linksEl, link.title, link.url);
    }

    if (parsed.summary) {
      const summaryEl = container.createDiv({ cls: 'grimoire-tool-web-summary' });
      summaryEl.setText(parsed.summary.length > 800 ? parsed.summary.slice(0, 800) + '...' : parsed.summary);
    }
    return;
  }

  const data = normalizeWebSearchDisplayData(input);
  const shouldRenderAction = Boolean(data.actionType || data.query || data.queries.length || data.url || data.pattern)
    && (!result
      || isPlaceholderWebSearchResult(result)
      || data.actionType === 'open_page'
      || data.actionType === 'find_in_page');

  if (shouldRenderAction && renderWebSearchActionExpanded(container, input)) {
    if (result && !isPlaceholderWebSearchResult(result)) {
      renderLinesExpanded(container, result, 12);
    }
    return;
  }

  if (result) {
    renderLinesExpanded(container, result, 20);
    return;
  }

  if (renderWebSearchActionExpanded(container, input)) {
    return;
  }

  container.createDiv({ cls: 'grimoire-tool-empty', text: t('chat.ui.tools.noResult') });
}

function renderFileSearchExpanded(container: HTMLElement, result: string): void {
  const lines = result.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) {
    container.createDiv({ cls: 'grimoire-tool-empty', text: t('chat.ui.tools.noMatches') });
    return;
  }
  const partEl = createIoPart(container, 'MATCHED');
  renderLinesExpanded(partEl, result, 15, true);
}

function createIoPart(container: HTMLElement, caption: string): HTMLElement {
  const ioEl = container.querySelector('.grimoire-tool-io') as HTMLElement
    ?? container.createDiv({ cls: 'grimoire-tool-io' });
  const partEl = ioEl.createDiv({ cls: 'grimoire-tool-io-part' });
  partEl.createDiv({ cls: 'grimoire-tool-io-caption', text: caption });
  return partEl;
}

function renderLinesExpanded(
  container: HTMLElement,
  result: string,
  maxLines: number,
  hoverable = false
): void {
  const lines = result.split(/\r?\n/);
  const truncated = lines.length > maxLines;
  const linesEl = container.createDiv({ cls: 'grimoire-tool-lines' });
  let showAll = false;

  const render = (): void => {
    linesEl.empty();
    const displayLines = truncated && !showAll ? lines.slice(0, maxLines) : lines;
    for (const line of displayLines) {
      const stripped = line.replace(/^\s*\d+→/, '');
      const lineEl = linesEl.createDiv({ cls: 'grimoire-tool-line' });
      if (hoverable) lineEl.addClass('hoverable');
      lineEl.setText(stripped || ' ');
    }

    if (truncated) {
      appendPreviewToggle(
        linesEl,
        showAll ? `${lines.length} total lines` : `... ${lines.length - maxLines} more lines`,
        showAll,
        () => {
          showAll = !showAll;
          render();
        },
      );
    }
  };

  render();
}

function renderToolSearchExpanded(container: HTMLElement, result: string): void {
  let toolNames: string[] = [];
  try {
    const parsed = JSON.parse(result) as Array<{ type: string; tool_name: string }>;
    if (Array.isArray(parsed)) {
      toolNames = parsed
        .filter(item => item.type === 'tool_reference' && item.tool_name)
        .map(item => item.tool_name);
    }
  } catch {
    // Fall back to showing raw result
  }

  if (toolNames.length === 0) {
    renderLinesExpanded(container, result, 20);
    return;
  }

  for (const name of toolNames) {
    const lineEl = container.createDiv({ cls: 'grimoire-tool-search-item' });
    const iconEl = lineEl.createSpan({ cls: 'grimoire-tool-search-icon' });
    setToolIcon(iconEl, name);
    lineEl.createSpan({ text: name });
  }
}

function renderWebFetchExpanded(container: HTMLElement, result: string): void {
  const maxChars = 500;
  const linesEl = container.createDiv({ cls: 'grimoire-tool-lines' });
  const lineEl = linesEl.createDiv({ cls: 'grimoire-tool-line grimoire-tool-line-wrap' });

  if (result.length > maxChars) {
    let showAll = false;
    const render = (): void => {
      lineEl.setText(showAll ? result : result.slice(0, maxChars));
      const previousAction = linesEl.querySelector('.grimoire-tool-truncation-action');
      previousAction?.remove();
      appendPreviewToggle(
        linesEl,
        showAll ? `${result.length} total characters` : `... ${result.length - maxChars} more characters`,
        showAll,
        () => {
          showAll = !showAll;
          render();
        },
      );
    };
    render();
  } else {
    lineEl.setText(result);
  }
}

function appendPreviewToggle(
  container: HTMLElement,
  label: string,
  showAll: boolean,
  onToggle: () => void,
): void {
  const actionEl = container.createDiv({ cls: 'grimoire-tool-truncation-action' });
  actionEl.createDiv({ cls: 'grimoire-tool-truncated', text: label });

  const buttonEl = actionEl.createEl('button', {
    cls: 'grimoire-tool-show-all',
    text: showAll ? t('chat.ui.tools.showPreview') : t('chat.ui.tools.showAll'),
  });
  buttonEl.setAttribute('type', 'button');
  buttonEl.setAttribute('aria-expanded', showAll ? 'true' : 'false');
  buttonEl.addEventListener('click', (event) => {
    event.stopPropagation();
    onToggle();
  });
}

function renderApplyPatchExpanded(
  container: HTMLElement,
  input: Record<string, unknown>,
  result: string | undefined,
): void {
  const patchText = typeof input.patch === 'string' ? input.patch : '';
  const parsedDiffs = getApplyPatchFileDiffs(input);

  if (result && /verification failed|^[Ee]rror:/.test(result.trim())) {
    renderLinesExpanded(container, result, 20);
  }

  if (parsedDiffs.length > 0) {
    renderApplyPatchDiffSections(container, parsedDiffs);
    return;
  }

  const changes = Array.isArray(input.changes) ? input.changes : [];
  if (changes.length > 0) {
    const linesEl = container.createDiv({ cls: 'grimoire-tool-lines' });
    for (const change of changes as unknown[]) {
      if (!change || typeof change !== 'object' || Array.isArray(change)) continue;
      const changeRecord = change as Record<string, unknown>;
      const path = typeof changeRecord.path === 'string' ? changeRecord.path : '';
      if (!path) continue;
      const movedTo = readMoveTarget(changeRecord.kind);
      const pathText = movedTo ? `${path} -> ${movedTo}` : path;
      linesEl.createDiv({ cls: 'grimoire-tool-line', text: pathText });
    }
    return;
  }

  if (patchText) {
    renderLinesExpanded(container, patchText, 80);
    return;
  }

  if (result) {
    const fileMatches = [...result.matchAll(/(?:update|add|delete|create|modify|Applied:\s*)(?:\w+:\s*)?([^\n,]+)/gi)];
    if (fileMatches.length > 0) {
      const linesEl = container.createDiv({ cls: 'grimoire-tool-lines' });
      for (const match of fileMatches) {
        const filePath = match[1]?.trim();
        if (filePath) {
          const lineEl = linesEl.createDiv({ cls: 'grimoire-tool-line' });
          lineEl.setText(filePath);
        }
      }
      return;
    }
    renderLinesExpanded(container, result, 20);
    return;
  }

  container.createDiv({ cls: 'grimoire-tool-empty', text: t('chat.ui.tools.noResult') });
}

function renderApplyPatchDiffSections(
  container: HTMLElement,
  fileDiffs: ReturnType<typeof parseApplyPatchDiffs>,
): void {
  for (const fileDiff of fileDiffs) {
    const sectionEl = container.createDiv({ cls: 'grimoire-tool-patch-section' });

    if (fileDiff.operation === 'delete' && fileDiff.diffLines.length === 0) {
      sectionEl.createDiv({ cls: 'grimoire-tool-empty', text: t('chat.ui.tools.fileDeleted') });
      continue;
    }

    if (fileDiff.diffLines.length === 0) {
      sectionEl.createDiv({ cls: 'grimoire-tool-empty', text: t('chat.ui.tools.noTextDiff') });
      continue;
    }

    const diffRow = sectionEl.createDiv({ cls: 'grimoire-write-edit-diff-row' });
    const diffEl = diffRow.createDiv({ cls: 'grimoire-write-edit-diff' });
    renderDiffContent(diffEl, fileDiff.diffLines);
  }
}

function readMoveTarget(kind: unknown): string | undefined {
  if (!kind || typeof kind !== 'object' || Array.isArray(kind)) {
    return undefined;
  }
  const record = kind as Record<string, unknown>;
  return typeof record.move_path === 'string' ? record.move_path : undefined;
}

function getApplyPatchFileDiffs(input: Record<string, unknown>): ReturnType<typeof parseApplyPatchDiffs> {
  const patchText = typeof input.patch === 'string' ? input.patch : '';
  const parsedDiffs = patchText ? parseApplyPatchDiffs(patchText) : [];
  return parsedDiffs.length > 0 ? parsedDiffs : parseFileUpdateChangeDiffs(input.changes);
}

function getApplyPatchDiffStats(input: Record<string, unknown>): DiffStats | undefined {
  const fileDiffs = getApplyPatchFileDiffs(input);
  if (fileDiffs.length === 0) return undefined;

  const stats = fileDiffs.reduce<DiffStats>(
    (acc, fileDiff) => ({
      added: acc.added + fileDiff.stats.added,
      removed: acc.removed + fileDiff.stats.removed,
    }),
    { added: 0, removed: 0 }
  );

  return stats.added > 0 || stats.removed > 0 ? stats : undefined;
}

function getDiffStatsAriaLabel(stats: DiffStats): string {
  return `Changes: +${stats.added} -${stats.removed}`;
}

function renderAgentLifecycleExpanded(container: HTMLElement, result: string): void {
  // Try to parse as JSON for structured display
  const trimmed = result.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const linesEl = container.createDiv({ cls: 'grimoire-tool-lines' });
      for (const [key, value] of Object.entries(parsed)) {
        const lineEl = linesEl.createDiv({ cls: 'grimoire-tool-line' });
        const displayValue = formatToolDisplayValue(value);
        lineEl.setText(`${key}: ${displayValue}`);
      }
      return;
    } catch { /* fall through to plain text */ }
  }
  renderLinesExpanded(container, result, 20);
}

function formatToolDisplayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`;
  }
  if (value === null || value === undefined) {
    return '';
  }
  return JSON.stringify(value);
}

export function renderExpandedContent(
  container: HTMLElement,
  toolName: string,
  result: string | undefined,
  input: Record<string, unknown> = {},
): void {
  if (!result && toolName !== TOOL_WEB_SEARCH && toolName !== TOOL_BASH && toolName !== TOOL_APPLY_PATCH) {
    container.createDiv({ cls: 'grimoire-tool-empty', text: t('chat.ui.tools.noResult') });
    return;
  }

  const resolvedResult = result ?? '';

  if (isAgentLifecycleTool(toolName)) {
    renderAgentLifecycleExpanded(container, resolvedResult);
    return;
  }

  switch (toolName) {
    case TOOL_BASH:
      renderBashContent(container, input, resolvedResult);
      break;
    case TOOL_WRITE_STDIN:
      renderLinesExpanded(container, resolvedResult, 20);
      break;
    case TOOL_READ:
      renderLinesExpanded(container, resolvedResult, 15);
      break;
    case TOOL_GLOB:
    case TOOL_GREP:
    case TOOL_LS:
      renderFileSearchExpanded(container, resolvedResult);
      break;
    case TOOL_WEB_SEARCH:
      renderWebSearchExpanded(container, input, result);
      break;
    case TOOL_WEB_FETCH:
      renderWebFetchExpanded(container, resolvedResult);
      break;
    case TOOL_TOOL_SEARCH:
      renderToolSearchExpanded(container, resolvedResult);
      break;
    case TOOL_APPLY_PATCH:
      renderApplyPatchExpanded(container, input, result);
      break;
    default:
      renderLinesExpanded(container, resolvedResult, 20);
      break;
  }
}

function getTodos(input: Record<string, unknown>): TodoItem[] | undefined {
  const todos = input.todos;
  if (!todos || !Array.isArray(todos)) return undefined;
  return todos as TodoItem[];
}

function getCurrentTask(input: Record<string, unknown>): TodoItem | undefined {
  const todos = getTodos(input);
  if (!todos) return undefined;
  return todos.find(t => t.status === 'in_progress');
}

function areAllTodosCompleted(input: Record<string, unknown>): boolean {
  const todos = getTodos(input);
  if (!todos || todos.length === 0) return false;
  return todos.every(t => t.status === 'completed');
}

function resetStatusElement(statusEl: HTMLElement, statusClass: string, ariaLabel: string): void {
  statusEl.className = 'grimoire-tool-status';
  statusEl.empty();
  statusEl.addClass(statusClass);
  statusEl.setAttribute('aria-label', ariaLabel);
}

const STATUS_ICONS: Record<string, string> = {
  completed: 'check',
  error: 'x',
  // A crossed shield is the permission vocabulary: it says somebody refused.
  blocked: 'shield-off',
  // A ring that was never closed, for the tool the turn ended underneath.
  unfinished: 'circle-dashed',
};

function setTodoWriteStatus(statusEl: HTMLElement, input: Record<string, unknown>): void {
  const isComplete = areAllTodosCompleted(input);
  const status = isComplete ? 'completed' : 'running';
  const ariaLabel = t('chat.ui.status.aria', {
    status: isComplete ? t('chat.ui.status.completed') : t('chat.ui.status.inProgress'),
  });
  resetStatusElement(statusEl, `status-${status}`, ariaLabel);
  if (isComplete) setIcon(statusEl, 'check');
}

function setToolStatus(statusEl: HTMLElement, status: ToolCallInfo['status']): void {
  const statusText = status === 'running'
    ? t('chat.ui.status.running')
    : status === 'completed'
      ? t('chat.ui.status.completed')
      : status === 'blocked'
        ? t('chat.ui.status.blocked')
        : status === 'unfinished'
          ? t('chat.ui.status.unfinished')
          : t('chat.ui.status.error');
  resetStatusElement(statusEl, `status-${status}`, t('chat.ui.status.aria', { status: statusText }));
  if (status === 'running') {
    statusEl.createSpan({ cls: 'grimoire-tool-spinner' });
    return;
  }
  const icon = STATUS_ICONS[status];
  if (icon) setIcon(statusEl, icon);
}

function setApplyPatchHeaderRight(statusEl: HTMLElement, toolCall: ToolCallInfo): void {
  const isError = toolCall.status === 'error' || toolCall.status === 'blocked';
  const stats = isError ? undefined : getApplyPatchDiffStats(toolCall.input);
  if (!stats) {
    setToolStatus(statusEl, toolCall.status);
    return;
  }

  statusEl.className = 'grimoire-tool-status grimoire-write-edit-stats';
  statusEl.empty();
  statusEl.setAttribute('aria-label', getDiffStatsAriaLabel(stats));
  renderDiffStats(statusEl, stats);
}

function setGenericToolHeaderRight(statusEl: HTMLElement, toolCall: ToolCallInfo): void {
  if (toolCall.name === TOOL_APPLY_PATCH) {
    setApplyPatchHeaderRight(statusEl, toolCall);
    return;
  }

  setToolStatus(statusEl, toolCall.status);
}

export function renderTodoWriteResult(
  container: HTMLElement,
  input: Record<string, unknown>
): void {
  container.empty();
  container.addClass('grimoire-todo-panel-content');
  container.addClass('grimoire-todo-list-container');

  const todos = input.todos as TodoItem[] | undefined;
  if (!todos || !Array.isArray(todos)) {
    const item = container.createSpan({ cls: 'grimoire-tool-result-item' });
    item.setText(t('chat.ui.tools.tasksUpdated'));
    return;
  }

  renderTodoItems(container, todos);
}

export function isBlockedToolResult(content: unknown, isError?: boolean): boolean {
  const lower = extractToolResultContent(content, { fallbackIndent: 2 }).toLowerCase();
  if (lower.includes('outside the vault')) return true;
  if (lower.includes('access denied')) return true;
  if (lower.includes('user denied')) return true;
  if (/\b(?:requires?|needs?) (?:user )?approval\b|\bapproval (?:is )?required\b/u.test(lower)) return true;
  if (isError && lower.includes('deny')) return true;
  return false;
}

interface ToolElementStructure {
  toolEl: HTMLElement;
  header: HTMLElement;
  iconEl: HTMLElement;
  nameEl: HTMLElement;
  summaryEl: HTMLElement;
  resultEl: HTMLElement;
  statusEl: HTMLElement;
  content: HTMLElement;
  currentTaskEl: HTMLElement | null;
}

function getResultLabel(toolCall: ToolCallInfo): string {
  if (toolCall.status === 'running') return '';
  if (toolCall.status === 'blocked') return t('chat.ui.tools.resultSkipped');
  if (toolCall.status === 'unfinished') return t('chat.ui.tools.resultStopped');

  const result = toolCall.result?.trim() ?? '';
  if (!result) return '';

  switch (toolCall.name) {
    case TOOL_GLOB:
    case TOOL_LS: {
      const count = countNonEmptyLines(result);
      return count > 0 ? `${count} ${count === 1 ? 'file' : 'files'}` : '';
    }
    case TOOL_GREP: {
      const count = countNonEmptyLines(result);
      return count > 0 ? `${count} ${count === 1 ? 'hit' : 'hits'}` : '';
    }
    case TOOL_BASH: {
      const count = countNonEmptyLines(result);
      return count > 0 ? `${count} ${count === 1 ? 'line' : 'lines'}` : '';
    }
    default:
      return '';
  }
}

function countNonEmptyLines(text: string): number {
  return text.split(/\r?\n/).filter(line => line.trim().length > 0).length;
}

function syncToolStateClasses(toolEl: HTMLElement, status: ToolCallInfo['status']): void {
  toolEl.toggleClass('is-running', status === 'running');
  toolEl.toggleClass('is-completed', status === 'completed');
  toolEl.toggleClass('is-error', status === 'error');
  toolEl.toggleClass('is-blocked', status === 'blocked');
  toolEl.toggleClass('is-unfinished', status === 'unfinished');
}

function syncToolHeaderText(
  toolEl: HTMLElement,
  toolCall: ToolCallInfo,
): void {
  const nameEl = toolEl.querySelector('.grimoire-tool-name');
  if (nameEl) {
    nameEl.setText(getToolDisplayName(toolCall));
  }

  const summaryEl = toolEl.querySelector('.grimoire-tool-summary');
  if (summaryEl) {
    summaryEl.setText(getToolSummary(toolCall.name, toolCall.input));
  }

  const resultEl = toolEl.querySelector('.grimoire-tool-result');
  if (resultEl) {
    resultEl.setText(getResultLabel(toolCall));
  }
}

function createToolElementStructure(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo
): ToolElementStructure {
  const toolEl = parentEl.createDiv({ cls: 'grimoire-tool-call grimoire-tool-step' });
  syncToolStateClasses(toolEl, toolCall.status);
  if (toolCall.name === TOOL_BASH) {
    toolEl.addClass('grimoire-tool-call-bash');
  }

  const header = toolEl.createDiv({ cls: 'grimoire-tool-header grimoire-tool-step-row' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');

  const iconEl = header.createSpan({ cls: 'grimoire-tool-icon grimoire-tool-icon-tile' });
  iconEl.setAttribute('aria-hidden', 'true');
  setToolIcon(iconEl, toolCall.name);

  const nameEl = header.createSpan({ cls: 'grimoire-tool-name' });
  nameEl.setText(getToolDisplayName(toolCall));

  const summaryEl = header.createSpan({ cls: 'grimoire-tool-summary' });
  summaryEl.setText(getToolSummary(toolCall.name, toolCall.input));

  const currentTaskEl = toolCall.name === TOOL_TODO_WRITE
    ? createCurrentTaskPreview(header, toolCall.input)
    : null;

  const resultEl = header.createSpan({ cls: 'grimoire-tool-result' });
  resultEl.setText(getResultLabel(toolCall));

  const statusEl = header.createSpan({ cls: 'grimoire-tool-status' });

  const content = toolEl.createDiv({ cls: 'grimoire-tool-content' });

  return { toolEl, header, iconEl, nameEl, summaryEl, resultEl, statusEl, content, currentTaskEl };
}

function resolveAskUserAnswers(toolCall: ToolCallInfo): Record<string, unknown> | undefined {
  if (toolCall.resolvedAnswers) return toolCall.resolvedAnswers;

  const parsed = extractResolvedAnswersFromResultText(toolCall.result);
  if (parsed) {
    toolCall.resolvedAnswers = parsed;
    return parsed;
  }

  return undefined;
}

function renderAskUserQuestionResult(container: HTMLElement, toolCall: ToolCallInfo): boolean {
  container.empty();
  const questions = toolCall.input.questions as AskUserQuestionItem[] | undefined;
  const answers = resolveAskUserAnswers(toolCall);
  if (!questions || !Array.isArray(questions) || !answers) return false;

  const qaEl = container.createDiv({ cls: 'grimoire-tool-io-qa' });
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const rawAnswer = (q.id ? answers[q.id] : undefined) ?? answers[q.question];
    const answerParts = Array.isArray(rawAnswer) ? rawAnswer : rawAnswer != null ? [rawAnswer] : [];
    if (answerParts.length === 0) continue;

    const pair = qaEl.createDiv();
    pair.createDiv({ text: q.question, cls: 'grimoire-tool-io-qa-q' });
    const answerRow = pair.createDiv({ cls: 'grimoire-tool-io-qa-a' });
    for (const part of answerParts) {
      const formatted = typeof part === 'string' ? part : String(part);
      if (formatted) {
        answerRow.createSpan({ text: formatted, cls: 'grimoire-tool-io-qa-tag' });
      }
    }
  }

  return true;
}

function renderAskUserQuestionFallback(container: HTMLElement, toolCall: ToolCallInfo, initialText?: string): void {
  container.empty();

  const questions = Array.isArray(toolCall.input.questions)
    ? toolCall.input.questions as AskUserQuestionItem[]
    : [];

  if (questions.length === 0) {
    contentFallback(container, initialText || toolCall.result || t('chat.ui.tools.waitingForAnswer'));
    return;
  }

  if (initialText || toolCall.result) {
    container.createDiv({
      text: initialText || toolCall.result || t('chat.ui.tools.waitingForAnswer'),
      cls: 'grimoire-tool-result-text',
    });
  }

  const qaEl = container.createDiv({ cls: 'grimoire-tool-io-qa' });
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const pair = qaEl.createDiv();
    pair.createDiv({ text: q.question, cls: 'grimoire-tool-io-qa-q' });
    if (Array.isArray(q.options) && q.options.length > 0) {
      const answerRow = pair.createDiv({ cls: 'grimoire-tool-io-qa-a' });
      for (const opt of q.options) {
        answerRow.createSpan({
          text: opt.label,
          cls: 'grimoire-tool-io-qa-tag',
        });
        answerRow.lastElementChild?.toggleClass('is-disabled', true);
      }
    }
  }
}

function contentFallback(container: HTMLElement, text: string): void {
  const resultRow = container.createDiv({ cls: 'grimoire-tool-result-row' });
  const resultText = resultRow.createSpan({ cls: 'grimoire-tool-result-text' });
  resultText.setText(text);
}

function renderBashContent(
  container: HTMLElement,
  input: Record<string, unknown>,
  result: string,
  initialText?: string,
): void {
  container.empty();
  const command = (input.command as string) || '';
  if (command) {
    const inputPartEl = createIoPart(container, 'INPUT');
    const cmdEl = inputPartEl.createDiv({ cls: 'grimoire-tool-io-code grimoire-tool-bash-command' });
    cmdEl.setText(`$ ${command}`);
  }
  if (initialText) {
    const statusPartEl = createIoPart(container, 'STATUS');
    const resultRow = statusPartEl.createDiv({ cls: 'grimoire-tool-result-row' });
    const resultText = resultRow.createSpan({ cls: 'grimoire-tool-result-text grimoire-tool-io-code' });
    resultText.setText(initialText);
  } else if (result) {
    const outputPartEl = createIoPart(container, 'OUTPUT');
    renderLinesExpanded(outputPartEl, result, 20);
  } else {
    container.createDiv({ cls: 'grimoire-tool-empty', text: t('chat.ui.tools.noResult') });
  }
}

function createCurrentTaskPreview(
  header: HTMLElement,
  input: Record<string, unknown>
): HTMLElement {
  const currentTaskEl = header.createSpan({ cls: 'grimoire-tool-current' });
  const currentTask = getCurrentTask(input);
  if (currentTask) {
    currentTaskEl.setText(currentTask.activeForm);
  }
  return currentTaskEl;
}

function createTodoToggleHandler(
  currentTaskEl: HTMLElement | null,
  statusEl: HTMLElement | null,
  onExpandChange?: (expanded: boolean) => void
): (expanded: boolean) => void {
  return (expanded: boolean) => {
    if (onExpandChange) onExpandChange(expanded);
    if (currentTaskEl) {
      currentTaskEl.toggleClass('grimoire-hidden', expanded);
    }
    if (statusEl) {
      statusEl.toggleClass('grimoire-hidden', expanded);
    }
  };
}

function renderToolContent(
  content: HTMLElement,
  toolCall: ToolCallInfo,
  initialText?: string
): void {
  if (toolCall.name === TOOL_TODO_WRITE) {
    content.addClass('grimoire-tool-content-todo');
    renderTodoWriteResult(content, toolCall.input);
  } else if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    content.addClass('grimoire-tool-content-ask');
    if (initialText) {
      renderAskUserQuestionFallback(content, toolCall, t('chat.ui.tools.waitingForAnswer'));
    } else if (!renderAskUserQuestionResult(content, toolCall)) {
      renderAskUserQuestionFallback(content, toolCall);
    }
  } else if (toolCall.name === TOOL_BASH) {
    renderBashContent(content, toolCall.input, toolCall.result ?? '', initialText);
  } else if (initialText) {
    contentFallback(content, initialText);
  } else {
    renderExpandedContent(content, toolCall.name, toolCall.result, toolCall.input);
  }
}

function getGroupStatus(toolCalls: ToolCallInfo[]): ToolCallInfo['status'] {
  if (toolCalls.some(toolCall => toolCall.status === 'running')) return 'running';
  if (toolCalls.some(toolCall => toolCall.status === 'error')) return 'error';
  if (toolCalls.some(toolCall => toolCall.status === 'blocked')) return 'blocked';
  if (toolCalls.some(toolCall => toolCall.status === 'unfinished')) return 'unfinished';
  return 'completed';
}

function getToolGroupName(toolCalls: ToolCallInfo[]): string {
  const key = getToolGroupKey(toolCalls[0]);
  const status = getGroupStatus(toolCalls);
  switch (key) {
    case 'vault-search':
      return status === 'running' ? t('chat.ui.tools.searchingVault') : t('chat.ui.tools.searchedVault');
    case 'web-search':
      return status === 'running' ? t('chat.ui.tools.searchingWeb') : t('chat.ui.tools.searchedWeb');
    case 'file-discovery':
      return status === 'running' ? t('chat.ui.tools.searchingFiles') : t('chat.ui.tools.searchedFiles');
    default:
      return status === 'running' ? t('chat.ui.tools.runningTools') : t('chat.ui.tools.ranTools');
  }
}

function getToolGroupIcon(toolCalls: ToolCallInfo[]): string {
  const key = getToolGroupKey(toolCalls[0]);
  switch (key) {
    case 'vault-search':
    case 'web-search':
      return 'search';
    case 'file-discovery':
      return 'folder-search';
    default:
      return 'wrench';
  }
}

function getToolGroupSummary(toolCalls: ToolCallInfo[]): string {
  const summaries = toolCalls
    .map(toolCall => getToolSummary(toolCall.name, toolCall.input))
    .filter(Boolean);
  return truncateText(summaries.join(', '), 72);
}

function getToolGroupCountLabel(toolCalls: ToolCallInfo[]): string {
  const key = getToolGroupKey(toolCalls[0]);
  const count = toolCalls.length;
  return key === 'vault-search' || key === 'web-search'
    ? t(count === 1 ? 'chat.ui.tools.queryCountOne' : 'chat.ui.tools.queryCountMany', { count })
    : t(count === 1 ? 'chat.ui.tools.stepCountOne' : 'chat.ui.tools.stepCountMany', { count });
}

function syncToolGroupStateClasses(groupEl: HTMLElement, status: ToolCallInfo['status']): void {
  groupEl.toggleClass('is-running', status === 'running');
  groupEl.toggleClass('is-completed', status === 'completed');
  groupEl.toggleClass('is-error', status === 'error');
  groupEl.toggleClass('is-blocked', status === 'blocked');
  groupEl.toggleClass('is-unfinished', status === 'unfinished');
}

function renderToolGroup(
  parentEl: HTMLElement,
  toolCalls: ToolCallInfo[],
  toolCallElements?: Map<string, HTMLElement>,
): HTMLElement {
  const groupEl = parentEl.createDiv({ cls: 'grimoire-tool-group grimoire-tool-step' });
  const status = getGroupStatus(toolCalls);
  syncToolGroupStateClasses(groupEl, status);

  const header = groupEl.createDiv({ cls: 'grimoire-tool-header grimoire-tool-group-header grimoire-tool-step-row' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');

  const iconEl = header.createSpan({ cls: 'grimoire-tool-icon grimoire-tool-icon-tile' });
  iconEl.setAttribute('aria-hidden', 'true');
  setIcon(iconEl, getToolGroupIcon(toolCalls));

  header.createSpan({ cls: 'grimoire-tool-name grimoire-tool-group-name', text: getToolGroupName(toolCalls) });
  header.createSpan({ cls: 'grimoire-tool-summary grimoire-tool-group-summary', text: getToolGroupSummary(toolCalls) });
  header.createSpan({ cls: 'grimoire-tool-count-chip', text: getToolGroupCountLabel(toolCalls) });

  const statusEl = header.createSpan({ cls: 'grimoire-tool-status' });
  setToolStatus(statusEl, status);
  header.createSpan({ cls: 'grimoire-tool-chevron' });

  const subEl = groupEl.createDiv({ cls: 'grimoire-tool-group-sub' });
  for (const toolCall of toolCalls) {
    const childEl = toolCallElements
      ? renderToolCall(subEl, toolCall, toolCallElements)
      : renderStoredToolCall(subEl, toolCall);
    childEl.addClass('grimoire-tool-sub-step');
  }

  const initiallyExpanded = toolCalls.some(toolCall => toolCall.isExpanded === true);
  const state = { isExpanded: false };
  setupCollapsible(groupEl, header, subEl, state, {
    initiallyExpanded,
    baseAriaLabel: `${getToolGroupName(toolCalls)}: ${getToolGroupSummary(toolCalls)}`,
  });

  return groupEl;
}

export function renderToolCallGroup(
  parentEl: HTMLElement,
  toolCalls: ToolCallInfo[],
  toolCallElements: Map<string, HTMLElement>,
): HTMLElement {
  return renderToolGroup(parentEl, toolCalls, toolCallElements);
}

export function renderStoredToolCallGroup(
  parentEl: HTMLElement,
  toolCalls: ToolCallInfo[],
): HTMLElement {
  return renderToolGroup(parentEl, toolCalls);
}

export function renderToolCall(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>
): HTMLElement {
  const { toolEl, header, statusEl, content, currentTaskEl } =
    createToolElementStructure(parentEl, toolCall);

  toolEl.dataset.toolId = toolCall.id;
  toolCallElements.set(toolCall.id, toolEl);

  setGenericToolHeaderRight(statusEl, toolCall);

  renderToolContent(content, toolCall, t('chat.ui.status.runningEllipsis'));

  const state = { isExpanded: false };
  toolCall.isExpanded = false;
  const todoStatusEl = toolCall.name === TOOL_TODO_WRITE ? statusEl : null;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    onToggle: createTodoToggleHandler(currentTaskEl, todoStatusEl, (expanded) => {
      toolCall.isExpanded = expanded;
    }),
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });

  return toolEl;
}

export function updateToolCallResult(
  toolId: string,
  toolCall: ToolCallInfo,
  toolCallElements: Map<string, HTMLElement>
) {
  const toolEl = toolCallElements.get(toolId);
  if (!toolEl) return;

  syncToolStateClasses(toolEl, toolCall.status);
  syncToolHeaderText(toolEl, toolCall);

  if (toolCall.name === TOOL_TODO_WRITE) {
    const statusEl = toolEl.querySelector('.grimoire-tool-status') as HTMLElement;
    if (statusEl) {
      setTodoWriteStatus(statusEl, toolCall.input);
    }
    const content = toolEl.querySelector('.grimoire-tool-content') as HTMLElement;
    if (content) {
      renderTodoWriteResult(content, toolCall.input);
    }
    const currentTaskEl = toolEl.querySelector('.grimoire-tool-current') as HTMLElement;
    if (currentTaskEl) {
      const currentTask = getCurrentTask(toolCall.input);
      currentTaskEl.setText(currentTask ? currentTask.activeForm : '');
    }
    return;
  }

  const statusEl = toolEl.querySelector('.grimoire-tool-status') as HTMLElement;
  if (statusEl) {
    setGenericToolHeaderRight(statusEl, toolCall);
  }

  if (toolCall.name === TOOL_ASK_USER_QUESTION) {
    const content = toolEl.querySelector('.grimoire-tool-content') as HTMLElement;
    if (content) {
      content.addClass('grimoire-tool-content-ask');
      if (!renderAskUserQuestionResult(content, toolCall)) {
        renderAskUserQuestionFallback(content, toolCall);
      }
    }
    return;
  }

  const content = toolEl.querySelector('.grimoire-tool-content') as HTMLElement;
  if (content) {
    content.empty();
    renderExpandedContent(content, toolCall.name, toolCall.result, toolCall.input);
  }
}

/** For stored (non-streaming) tool calls — collapsed by default. */
export function renderStoredToolCall(
  parentEl: HTMLElement,
  toolCall: ToolCallInfo
): HTMLElement {
  const { toolEl, header, statusEl, content, currentTaskEl } =
    createToolElementStructure(parentEl, toolCall);

  if (toolCall.name === TOOL_TODO_WRITE) {
    setTodoWriteStatus(statusEl, toolCall.input);
  } else {
    setGenericToolHeaderRight(statusEl, toolCall);
  }

  renderToolContent(content, toolCall);

  const state = { isExpanded: false };
  const todoStatusEl = toolCall.name === TOOL_TODO_WRITE ? statusEl : null;
  setupCollapsible(toolEl, header, content, state, {
    initiallyExpanded: false,
    onToggle: createTodoToggleHandler(currentTaskEl, todoStatusEl),
    baseAriaLabel: getToolLabel(toolCall.name, toolCall.input)
  });

  return toolEl;
}
