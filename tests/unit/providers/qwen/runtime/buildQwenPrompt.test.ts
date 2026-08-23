import type { ChatMessage } from '@/core/types';
import {
  buildQwenPromptBlocks,
  buildQwenPromptText,
} from '@/providers/qwen/runtime/buildQwenPrompt';

/**
 * What one Qwen turn says, and what the flip must not have changed about it.
 *
 * These assertions lived inside `QwenChatRuntime.test.ts` and were driving a
 * whole runtime to reach a pure function. The runtime is gone; the function is
 * the same one — byte-identical to Gemini's under a normalized diff — and this
 * is where it is pinned now.
 */
describe('buildQwenPrompt', () => {
  it('carries every piece of the vault a turn was composed with', () => {
    const prompt = buildQwenPromptText({
      browserSelection: {
        selectedText: 'Browser quote',
        source: 'browser:https://example.com',
        title: 'Example',
        url: 'https://example.com',
      },
      canvasSelection: {
        canvasPath: 'boards/Artic Ocean.canvas',
        nodeIds: ['node-1', 'node-2'],
      },
      contextFiles: ['notes/instructions.md'],
      currentNotePath: 'notes/Artic Ocean.md',
      excludedFolders: ['Climate'],
      editorSelection: {
        mode: 'selection',
        notePath: 'notes/Artic Ocean.md',
        selectedText: 'Selected text',
        startLine: 4,
        lineCount: 2,
      },
      text: 'Summarize this',
    });

    expect(prompt).toContain('Summarize this');
    expect(prompt).toContain('<current_note>');
    expect(prompt).toContain('notes/Artic Ocean.md');
    expect(prompt).toContain('<context_files>');
    expect(prompt).toContain('notes/instructions.md');
    expect(prompt).toContain('<excluded_folders>');
    expect(prompt).toContain('<folder>Climate</folder>');
    expect(prompt).toContain('<editor_selection path="notes/Artic Ocean.md" lines="4-5">');
    expect(prompt).toContain('Selected text');
    expect(prompt).toContain(
      '<browser_selection source="browser:https://example.com" title="Example" url="https://example.com">',
    );
    expect(prompt).toContain('<canvas_selection path="boards/Artic Ocean.canvas">');
  });

  it('prepares vault search context', () => {
    const prompt = buildQwenPromptText({
      text: 'Hello',
      vaultSearchContext: {
        query: 'roadmap',
        snippets: [{
          source: { id: 'v1', kind: 'vault-note', path: 'notes/Roadmap.md', title: 'Roadmap' },
          text: 'Launch plan',
          score: 1,
          matchedTerms: ['roadmap'],
        }],
      },
    });

    expect(prompt).toContain('<vault_search query="roadmap">');
    expect(prompt).toContain('Launch plan');
  });

  it('rebuilds prior conversation context when a turn carries history', () => {
    // What a replacement session needs: the agent has never heard this
    // conversation, so the turn has to say it.
    const history: ChatMessage[] = [
      { id: 'user-previous', role: 'user', content: 'Keep the language rich.', timestamp: 1 },
      {
        id: 'assistant-previous',
        role: 'assistant',
        content: 'I will preserve the prose voice.',
        timestamp: 2,
      },
    ];

    const prompt = buildQwenPromptText({ text: 'Apply that to DoorTextStyle.' }, history);

    expect(prompt).toContain('User: Keep the language rich.');
    expect(prompt).toContain('Assistant: I will preserve the prose voice.');
    expect(prompt).toContain('Apply that to DoorTextStyle.');
  });

  it('says nothing twice when the turn carries no history', () => {
    // The other half of the same rule: a session that already holds the
    // conversation would be told everything a second time. The composition is
    // what decides which of the two a turn is; this is what each looks like.
    const blocks = buildQwenPromptBlocks({ text: 'Continue the edit.' });

    expect(blocks).toEqual([{ text: 'Continue the edit.', type: 'text' }]);
  });

  it('wraps the whole composed turn in the orchestrator instructions', () => {
    const blocks = buildQwenPromptBlocks(
      { text: 'Plan this work', currentNotePath: 'notes/Plan.md' },
      [],
      { orchestratorMode: true },
    );

    const text = blocks[0]?.type === 'text' ? blocks[0].text : '';
    expect(text).toContain('## Grimoire Parallel Workers Mode');
    expect(text).toContain('<current_note>');
    // Ahead of everything, which is where the legacy runtime put them: they are
    // the frame the turn is read in, not a note appended to it.
    expect(text.indexOf('## Grimoire Parallel Workers Mode'))
      .toBeLessThan(text.indexOf('<current_note>'));
  });

  it('takes the flag from the request as well as from the turn options', () => {
    // Two callers set it, and only one of them is the query: a request composed
    // in orchestrator mode carries the flag itself.
    const fromRequest = buildQwenPromptBlocks({ text: 'Plan', orchestratorMode: true });

    expect(fromRequest[0]?.type === 'text' ? fromRequest[0].text : '')
      .toContain('## Grimoire Parallel Workers Mode');
  });

  it('sends an attached image beside the text rather than inside it', () => {
    const blocks = buildQwenPromptBlocks({
      text: 'What is this?',
      images: [{ data: 'AAAA', mediaType: 'image/png' } as never],
    });

    expect(blocks).toEqual([
      { text: 'What is this?', type: 'text' },
      { data: 'AAAA', mimeType: 'image/png', type: 'image' },
    ]);
  });
});
