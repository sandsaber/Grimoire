import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { loadOpencodeSessionMessages } from '@/providers/opencode/history/OpencodeHistoryStore';
import { loadOpencodeSessionCost } from '@/providers/opencode/history/OpencodeUsageMetadataStore';

describe('OpenCode V2 native history', () => {
  let directory: string;
  let databasePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'grimoire-opencode-v2-history-'));
    databasePath = join(directory, 'opencode.db');
    const db = new DatabaseSync(databasePath);
    db.exec(`
      create table session_message (id text, session_id text, type text, seq integer, time_created integer, data text);
      create table session_v2 (id text, cost real);
      create table message (id text, session_id text, time_created integer, data text);
      create table part (id text, session_id text, message_id text, data text);
    `);
    const insert = db.prepare('insert into session_message values (?, ?, ?, ?, ?, ?)');
    // V2.0.16 stores role-specific data in session_message and tool results
    // inside assistant content; these shapes were observed in the live smoke.
    insert.run('v2-user', 'v2', 'user', 1, 1_000, JSON.stringify({
      time: { created: 1_000 }, text: 'Read Note.md', files: [],
    }));
    insert.run('v2-agent', 'v2', 'agent-switched', 2, 1_500, JSON.stringify({ agent: 'grimoire-safe' }));
    insert.run('v2-assistant', 'v2', 'assistant', 3, 2_000, JSON.stringify({
      time: { created: 2_000, completed: 5_000 }, cost: 1.25,
      content: [
        { type: 'reasoning', text: 'Checking the note.', time: { created: 2_000, completed: 3_000 } },
        { type: 'tool', id: 'read-1', name: 'read', state: {
          status: 'completed', input: { path: 'Note.md' }, content: [{ type: 'text', text: '# Note' }],
        } },
        { type: 'tool', id: 'write-1', name: 'write', state: {
          status: 'error', input: { path: 'Note.md', content: 'changed' },
          error: { type: 'aborted', message: 'The user declined this tool call' },
        } },
        { type: 'text', text: 'Done.' },
      ],
    }));
    db.prepare('insert into session_v2 values (?, ?)').run('v2', 1.25);
    db.prepare('insert into message values (?, ?, ?, ?)').run('v1-assistant', 'v1', 1_000,
      JSON.stringify({ role: 'assistant', cost: 0.5 }));
    db.prepare('insert into part values (?, ?, ?, ?)').run('v1-text', 'v1', 'v1-assistant',
      JSON.stringify({ type: 'text', text: 'V1 answer' }));
    db.close();
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('hydrates V2 text, reasoning and tool outcomes in session sequence order', async () => {
    const messages = await loadOpencodeSessionMessages('v2', { databasePath });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ id: 'v2-user', role: 'user', content: 'Read Note.md', timestamp: 1_000 });
    expect(messages[1]).toMatchObject({
      id: 'v2-assistant', role: 'assistant', content: 'Done.', durationSeconds: 3,
      contentBlocks: [
        { type: 'thinking', content: 'Checking the note.', durationSeconds: 1 },
        { type: 'tool_use', toolId: 'read-1' },
        { type: 'tool_use', toolId: 'write-1' },
        { type: 'text', content: 'Done.' },
      ],
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'Note.md' }, result: '# Note', status: 'completed' },
        { id: 'write-1', name: 'Write', input: { file_path: 'Note.md' }, result: 'The user declined this tool call', status: 'error' },
      ],
    });
    expect(await loadOpencodeSessionCost('v2', { databasePath })).toEqual({ amount: 1.25, currency: 'USD' });
  });

  it('still reads V1 sessions when both database schemas are present', async () => {
    expect(await loadOpencodeSessionMessages('v1', { databasePath })).toMatchObject([
      { id: 'v1-assistant', role: 'assistant', content: 'V1 answer' },
    ]);
    expect(await loadOpencodeSessionCost('v1', { databasePath })).toEqual({ amount: 0.5, currency: 'USD' });
  });

  it('still reads an unmodified V1 database with no V2 tables', async () => {
    const db = new DatabaseSync(databasePath);
    db.exec('drop table session_message; drop table session_v2;');
    db.close();

    expect(await loadOpencodeSessionMessages('v1', { databasePath })).toMatchObject([
      { role: 'assistant', content: 'V1 answer' },
    ]);
    expect(await loadOpencodeSessionCost('v1', { databasePath })).toEqual({ amount: 0.5, currency: 'USD' });
  });
});
