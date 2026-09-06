import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';

import {
  extractRuntimeContextLoadEvent,
  RuntimeContextActivityState,
  RuntimeContextActivityView,
} from '@/features/chat/ui/context/RuntimeContextActivity';

describe('RuntimeContextActivity', () => {
  it('extracts Claude Read tool calls as loaded notes', () => {
    const event = extractRuntimeContextLoadEvent({
      providerId: 'claude',
      toolCall: {
        id: 'tool-1',
        name: 'Read',
        input: { file_path: 'Books/Book/CLAUDE.md' },
        status: 'completed',
      },
    });

    expect(event).toMatchObject({
      id: 'tool-1',
      path: 'Books/Book/CLAUDE.md',
      providerId: 'claude',
      method: 'read note',
      status: 'loaded',
    });
  });

  it('extracts conservative Codex sed shell reads', () => {
    const event = extractRuntimeContextLoadEvent({
      providerId: 'codex',
      toolCall: {
        id: 'tool-2',
        name: 'Bash',
        input: { command: "sed -n '1,120p' 'Books/Book/Chapter 2.md'" },
        status: 'completed',
      },
    });

    expect(event).toMatchObject({
      id: 'tool-2',
      path: 'Books/Book/Chapter 2.md',
      providerId: 'codex',
      method: 'shell',
      status: 'loaded',
    });
  });

  it('extracts conservative Codex cat shell reads', () => {
    const event = extractRuntimeContextLoadEvent({
      providerId: 'codex',
      toolCall: {
        id: 'tool-3',
        name: 'Bash',
        input: { command: "cat Books/Book/AGENTS.md" },
        status: 'running',
      },
    });

    expect(event).toMatchObject({
      path: 'Books/Book/AGENTS.md',
      method: 'shell',
      status: 'loading',
    });
  });

  it('extracts Codex shell reads after a command separator', () => {
    const event = extractRuntimeContextLoadEvent({
      providerId: 'codex',
      toolCall: {
        id: 'tool-4',
        name: 'Bash',
        input: { command: "printf '%s\\n' '---CLAUDE---' && sed -n '1,260p' CLAUDE.md" },
        status: 'completed',
      },
    });

    expect(event).toMatchObject({
      path: 'CLAUDE.md',
      method: 'shell',
      status: 'loaded',
    });
  });

  it('keeps a shell-read file loaded when a later chained command fails', () => {
    const event = extractRuntimeContextLoadEvent({
      providerId: 'codex',
      toolCall: {
        id: 'tool-4b',
        name: 'Bash',
        input: { command: "sed -n '1,260p' 'Books/CLAUDE.md' && git status --short" },
        status: 'error',
        result: '# CLAUDE.md -- Books\n\nInstructions for working with books.\n\nfatal: not a git repository',
      },
    });

    expect(event).toMatchObject({
      path: 'Books/CLAUDE.md',
      method: 'shell',
      status: 'loaded',
    });
  });

  it('ignores shell commands that do not clearly read markdown files', () => {
    const event = extractRuntimeContextLoadEvent({
      providerId: 'codex',
      toolCall: {
        id: 'tool-5',
        name: 'Bash',
        input: { command: 'npm run test' },
        status: 'completed',
      },
    });

    expect(event).toBeNull();
  });

  it('extracts Grok Read tool calls with filePath input', () => {
    const event = extractRuntimeContextLoadEvent({
      providerId: 'grok',
      toolCall: {
        id: 'tool-grok-1',
        name: 'Read',
        input: { filePath: 'Geography/Indian Ocean.md' },
        status: 'completed',
      },
    });

    expect(event).toMatchObject({
      id: 'tool-grok-1',
      path: 'Geography/Indian Ocean.md',
      providerId: 'grok',
      method: 'read note',
      status: 'loaded',
    });
  });

  it('hydrates loaded files from persisted assistant tool calls', () => {
    const view = new RuntimeContextActivityView(createMockEl());
    view.hydrateFromMessages('grok', [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        timestamp: 1,
        toolCalls: [{
          id: 'tool-grok-1',
          name: 'Read',
          input: { file_path: '.grimoire/grok/system.md' },
          status: 'completed',
        }],
      },
    ]);

    expect(view.getEntries()).toEqual([{
      id: 'tool-grok-1',
      path: '.grimoire/grok/system.md',
      providerId: 'grok',
      method: 'read note',
      status: 'loaded',
    }]);
  });

  it('uses registered display names for provider badges and falls back safely', () => {
    const container = createMockEl();
    const view = new RuntimeContextActivityView(container);

    for (const providerId of ['kimicode', 'mimocode', 'grok', 'gemini', 'qwen'] as const) {
      view.recordPreloadedFile(providerId, `${providerId}.md`);
    }
    view.recordPreloadedFile('unregistered', 'unregistered.md');

    expect(container.querySelectorAll('.grimoire-context-file-badge').map((badge: { textContent?: string }) => badge.textContent)).toEqual([
      'Kimi Code',
      'MiMoCode',
      'Grok Build',
      'Gemini CLI (Legacy)',
      'Qwen Code',
      'unregistered',
    ]);
  });

  it('deduplicates by path and keeps the latest status', () => {
    const state = new RuntimeContextActivityState();

    state.record({
      id: 'a',
      path: 'A.md',
      providerId: 'claude',
      method: 'read note',
      status: 'loading',
    });
    state.record({
      id: 'b',
      path: 'A.md',
      providerId: 'claude',
      method: 'read note',
      status: 'loaded',
    });

    expect(state.getEntries()).toHaveLength(1);
    expect(state.getEntries()[0]).toMatchObject({
      id: 'b',
      path: 'A.md',
      status: 'loaded',
    });
  });
});
