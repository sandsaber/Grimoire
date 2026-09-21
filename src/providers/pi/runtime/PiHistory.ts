import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { ProviderHistoryHydration } from '@/core/providers/ProviderModule';
import type { ChatMessage, ContentBlock, Conversation, ToolCallInfo } from '@/core/types';
import { isRecord } from '@/utils/records';

/** Recover only an empty local transcript; Grimoire's richer saved projection stays authoritative. */
export async function hydratePiHistory(conversation: Conversation, vaultPath: string | null,
  mapPath = join(homedir(), '.pi', 'pi-acp', 'session-map.json')): Promise<ProviderHistoryHydration> {
  if (!conversation.sessionId || conversation.messages.length) return { outcome: 'absent' };
  try {
    const map: unknown = JSON.parse(await readFile(mapPath, 'utf8'));
    if (!isRecord(map) || map.version !== 1 || !isRecord(map.sessions)) return { outcome: 'corrupt', reason: 'invalidSessionMap' };
    const entry = map.sessions[conversation.sessionId];
    if (!isRecord(entry) || typeof entry.sessionFile !== 'string' || typeof entry.cwd !== 'string'
      || !vaultPath || canonicalPath(entry.cwd) !== canonicalPath(vaultPath)) return { outcome: 'absent' };
    const messages = parsePiHistory(await readFile(entry.sessionFile, 'utf8'), vaultPath);
    if (!messages.length) return { outcome: 'absent' };
    conversation.messages = messages;
    return { outcome: 'recovered', reason: 'nativePiTranscript' };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { outcome: 'absent' } : { outcome: 'corrupt', reason: 'unreadablePiTranscript' };
  }
}

/** Pi v3 JSONL is a tree. Follow the latest entry's ancestry, never concatenate abandoned branches. */
export function parsePiHistory(text: string, cwd: string): ChatMessage[] {
  const rows: Record<string, unknown>[] = text.split('\n').filter(line => line.trim()).map(line => {
    const row: unknown = JSON.parse(line);
    if (!isRecord(row)) throw new Error('Invalid Pi session entry.');
    return row;
  });
  const header = rows[0];
  if (header?.type !== 'session' || header.version !== 3 || typeof header.cwd !== 'string'
    || canonicalPath(header.cwd) !== canonicalPath(cwd)) throw new Error('Unrecognized Pi session.');
  const entries = new Map(rows.slice(1).filter(row => typeof row.id === 'string').map(row => [row.id as string, row]));
  const branch: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let row = rows.at(-1);
  while (row && typeof row.id === 'string' && row.type !== 'session') {
    if (seen.has(row.id)) throw new Error('Cyclic Pi session.');
    seen.add(row.id); branch.push(row);
    if (row.parentId === null) break;
    if (typeof row.parentId !== 'string' || !entries.has(row.parentId)) throw new Error('Incomplete Pi session.');
    row = entries.get(row.parentId);
  }
  const messages: ChatMessage[] = [];
  const tools = new Map<string, ToolCallInfo>();
  for (const entry of branch.reverse()) {
    if (entry.type !== 'message' || !isRecord(entry.message)) continue;
    const message = entry.message;
    const blocks = Array.isArray(message.content) ? message.content.filter(isRecord) : [];
    const content = typeof message.content === 'string' ? message.content
      : blocks.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('');
    if (message.role === 'toolResult') {
      const tool = typeof message.toolCallId === 'string' ? tools.get(message.toolCallId) : undefined;
      if (tool) { tool.result = content; tool.status = message.isError ? 'error' : 'completed'; }
      continue;
    }
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const timestamp = typeof message.timestamp === 'number' ? message.timestamp : Date.parse(String(entry.timestamp));
    const projected: ChatMessage = { id: `pi-${String(entry.id)}`, role: message.role, content,
      timestamp: Number.isFinite(timestamp) ? timestamp : 0 };
    if (message.role === 'assistant') {
      projected.assistantMessageId = String(entry.id);
      projected.contentBlocks = blocks.flatMap((block): ContentBlock[] => {
        if (block.type === 'text' && typeof block.text === 'string') return [{ type: 'text' as const, content: block.text }];
        if (block.type === 'thinking' && typeof block.thinking === 'string') return [{ type: 'thinking' as const, content: block.thinking }];
        if (block.type === 'toolCall' && typeof block.id === 'string') return [{ type: 'tool_use' as const, toolId: block.id }];
        return [];
      });
      projected.toolCalls = blocks.flatMap(block => {
        if (block.type !== 'toolCall' || typeof block.id !== 'string' || typeof block.name !== 'string') return [];
        const tool: ToolCallInfo = { id: block.id, name: block.name,
          input: isRecord(block.arguments) ? block.arguments : {}, status: 'unfinished' };
        tools.set(tool.id, tool);
        return [tool];
      });
    } else {
      projected.userMessageId = String(entry.id);
      projected.images = blocks.flatMap((block, index) => {
        if (block.type !== 'image' || typeof block.data !== 'string'
          || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(String(block.mimeType))) return [];
        return [{ id: `pi-${String(entry.id)}-${index}`, name: 'Pi image', data: block.data,
          mediaType: block.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          size: Buffer.from(block.data, 'base64').length, source: 'file' as const }];
      });
    }
    messages.push(projected);
  }
  return messages;
}

function canonicalPath(path: string): string {
  try { return realpathSync(path); } catch { return resolve(path); }
}
