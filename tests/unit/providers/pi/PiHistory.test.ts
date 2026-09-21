import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Conversation } from '@/core/types';
import { hydratePiHistory, parsePiHistory } from '@/providers/pi/runtime/PiHistory';

describe('Pi native history', () => {
  const header = { type: 'session', version: 3, id: 'native', cwd: '/tmp/pi-vault' };
  const message = (id: string, parentId: string | null, role: string, content: unknown) => ({
    type: 'message', id, parentId, message: { role, content, timestamp: 1 },
  });
  const parse = (...rows: unknown[]) => parsePiHistory([header, ...rows].map(row => JSON.stringify(row)).join('\n'), '/tmp/pi-vault');

  it('follows the active branch and attaches tool results to their calls', () => {
    const messages = parse(message('u', null, 'user', 'Read'),
      message('abandoned', 'u', 'assistant', [{ type: 'text', text: 'Not current' }]),
      message('a', 'u', 'assistant', [{ type: 'toolCall', id: 't', name: 'read', arguments: { path: 'Note.md' } }]),
      { ...message('r', 'a', 'toolResult', [{ type: 'text', text: 'Contents' }]),
        message: { role: 'toolResult', toolCallId: 't', content: [{ type: 'text', text: 'Contents' }] } },
      message('done', 'r', 'assistant', [{ type: 'text', text: 'Done' }]));
    expect(messages.map(item => item.content)).toEqual(['Read', '', 'Done']);
    expect(messages[1].toolCalls).toEqual([expect.objectContaining({ id: 't', result: 'Contents', status: 'completed' })]);
  });

  it('refuses another vault, malformed data and broken ancestry', () => {
    expect(() => parsePiHistory(JSON.stringify(header), '/tmp/other')).toThrow();
    expect(() => parse(message('a', 'missing', 'assistant', []))).toThrow('Incomplete');
    expect(() => parsePiHistory('not JSON', '/tmp/pi-vault')).toThrow();
  });

  it('recovers through a vault symlink without replacing existing local messages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pi-history-'));
    try {
      const vault = join(root, 'vault');
      const alias = join(root, 'alias');
      mkdirSync(vault);
      symlinkSync(vault, alias, 'dir');
      const sessionFile = join(root, 'session.jsonl');
      writeFileSync(sessionFile, [{ ...header, cwd: vault }, message('u', null, 'user', 'Hello')].map(row => JSON.stringify(row)).join('\n'));
      const map = join(root, 'map.json');
      writeFileSync(map, JSON.stringify({ version: 1, sessions: { native: { cwd: alias, sessionFile } } }));
      const conversation = { sessionId: 'native', messages: [] } as unknown as Conversation;
      expect((await hydratePiHistory(conversation, alias, map)).outcome).toBe('recovered');
      expect(conversation.messages[0].content).toBe('Hello');
      conversation.messages[0].content = 'Local projection';
      expect((await hydratePiHistory(conversation, alias, map)).outcome).toBe('absent');
      expect(conversation.messages[0].content).toBe('Local projection');
      const other = { sessionId: 'native', messages: [] } as unknown as Conversation;
      expect((await hydratePiHistory(other, root, map)).outcome).toBe('absent');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
