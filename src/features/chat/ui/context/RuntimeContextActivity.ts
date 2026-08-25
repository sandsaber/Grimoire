import { providerCatalog } from '../../../../core/providers/ProviderCatalog';
import { TOOL_BASH, TOOL_READ } from '../../../../core/tools/toolNames';
import type { ChatMessage, ProviderId, ToolCallInfo } from '../../../../core/types';
import { t } from '../../../../i18n/i18n';

export type RuntimeContextLoadMethod = 'read note' | 'shell' | 'tool';
export type RuntimeContextLoadStatus = 'loading' | 'loaded' | 'failed';

export interface RuntimeContextLoadEvent {
  id: string;
  path: string;
  providerId: ProviderId;
  method: RuntimeContextLoadMethod;
  status: RuntimeContextLoadStatus;
}

interface ExtractRuntimeContextLoadEventOptions {
  providerId: ProviderId;
  toolCall: ToolCallInfo;
}

function normalizeStatus(status: ToolCallInfo['status']): RuntimeContextLoadStatus {
  if (status === 'completed') return 'loaded';
  if (status === 'error' || status === 'blocked') return 'failed';
  return 'loading';
}

function didShellReadProduceOutput(toolCall: ToolCallInfo): boolean {
  if (toolCall.status !== 'error' || !toolCall.result?.trim()) {
    return false;
  }

  return !/^(?:cat|sed|nl):/mu.test(toolCall.result);
}

function getStringInput(input: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function normalizeDisplayPath(path: string): string {
  return path.trim().replace(/\\/g, '/');
}

function stripShellQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function extractMarkdownPathFromShell(command: string): string | null {
  const readSegment = command
    .split(/\s*(?:&&|;)\s*/u)
    .map(segment => segment.trim())
    .find(segment => /^(?:cat|sed|nl)\b/.test(segment));
  if (!readSegment) return null;

  const markdownPathMatch = readSegment.match(/(["'])([^"']+\.md)\1|([^\s"'`;&|]+\.md)/u);
  const rawPath = markdownPathMatch?.[2] ?? markdownPathMatch?.[3] ?? '';
  const path = stripShellQuotes(rawPath);
  return path ? normalizeDisplayPath(path) : null;
}

export function extractRuntimeContextLoadEvent(
  options: ExtractRuntimeContextLoadEventOptions,
): RuntimeContextLoadEvent | null {
  const { providerId, toolCall } = options;

  if (toolCall.name === TOOL_READ) {
    const path = getStringInput(toolCall.input, 'file_path', 'filepath', 'filePath', 'path');
    if (!path) {
      return null;
    }
    return {
      id: toolCall.id,
      path: normalizeDisplayPath(path),
      providerId,
      method: 'read note',
      status: normalizeStatus(toolCall.status),
    };
  }

  if (toolCall.name === TOOL_BASH) {
    const command = getStringInput(toolCall.input, 'command');
    const path = command ? extractMarkdownPathFromShell(command) : null;
    if (!path) {
      return null;
    }
    return {
      id: toolCall.id,
      path,
      providerId,
      method: 'shell',
      status: didShellReadProduceOutput(toolCall) ? 'loaded' : normalizeStatus(toolCall.status),
    };
  }

  return null;
}

export class RuntimeContextActivityState {
  private entriesByPath = new Map<string, RuntimeContextLoadEvent>();

  record(event: RuntimeContextLoadEvent): void {
    const key = normalizeDisplayPath(event.path).toLowerCase();
    this.entriesByPath.set(key, {
      ...event,
      path: normalizeDisplayPath(event.path),
    });
  }

  getEntries(): RuntimeContextLoadEvent[] {
    return [...this.entriesByPath.values()];
  }

  clear(): void {
    this.entriesByPath.clear();
  }
}

function getFileName(path: string): string {
  return normalizeDisplayPath(path).split('/').pop() || path;
}

function getProviderLabel(providerId: ProviderId): string {
  return providerCatalog().displayNameOrId(providerId);
}

export class RuntimeContextActivityView {
  private readonly state = new RuntimeContextActivityState();

  constructor(private readonly containerEl: HTMLElement) {
    this.render();
  }

  recordToolCall(providerId: ProviderId, toolCall: ToolCallInfo): void {
    const event = extractRuntimeContextLoadEvent({ providerId, toolCall });
    if (!event) {
      return;
    }
    this.state.record(event);
    this.render();
  }

  clear(): void {
    this.state.clear();
    this.render();
  }

  hydrateFromMessages(providerId: ProviderId, messages: ChatMessage[]): void {
    this.state.clear();
    for (const message of messages) {
      for (const toolCall of message.toolCalls ?? []) {
        const event = extractRuntimeContextLoadEvent({ providerId, toolCall });
        if (event) {
          this.state.record(event);
        }
      }
    }
    this.render();
  }

  recordPreloadedFile(providerId: ProviderId, filePath: string): void {
    const normalizedPath = normalizeDisplayPath(filePath);
    if (!normalizedPath) {
      return;
    }

    this.state.record({
      id: `preload:${normalizedPath.toLowerCase()}`,
      path: normalizedPath,
      providerId,
      method: 'read note',
      status: 'loaded',
    });
    this.render();
  }

  getEntries(): RuntimeContextLoadEvent[] {
    return this.state.getEntries();
  }

  private render(): void {
    this.containerEl.empty();
    const entries = this.state.getEntries();
    this.containerEl.classList.toggle('grimoire-hidden', entries.length === 0);
    if (entries.length === 0) {
      return;
    }

    const section = this.containerEl.createDiv({
      cls: 'grimoire-context-section grimoire-context-loaded-files',
    });
    section.createDiv({
      cls: 'grimoire-context-section-title',
      text: t('chat.ui.context.loadedThisSession'),
    });

    for (const entry of entries) {
      const row = section.createDiv({ cls: 'grimoire-context-file-row grimoire-context-loaded-row' });
      const body = row.createDiv({ cls: 'grimoire-context-file-body' });
      body.createDiv({ cls: 'grimoire-context-file-title', text: getFileName(entry.path) });
      body.createDiv({ cls: 'grimoire-context-file-path', text: entry.path });
      const meta = row.createDiv({ cls: 'grimoire-context-file-meta' });
      meta.createSpan({
        cls: 'grimoire-context-file-badge',
        text: getProviderLabel(entry.providerId),
      });
      meta.createSpan({
        cls: `grimoire-context-file-status grimoire-context-file-status-${entry.status}`,
        text: entry.status,
      });
      meta.createSpan({
        cls: 'grimoire-context-file-method',
        text: entry.method,
      });
    }
  }
}
