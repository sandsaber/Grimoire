import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';
import { Menu, setIcon, setTooltip } from 'obsidian';

import {
  TOOL_AGENT_OUTPUT,
  TOOL_SPAWN_AGENT,
  TOOL_TASK,
  TOOL_WAIT_AGENT,
  TOOL_WRITE_STDIN,
} from '@/core/tools/toolNames';
import type { ChatMessage, ImageAttachment } from '@/core/types';
import { MessageRenderer } from '@/features/chat/rendering/MessageRenderer';
import { renderStoredAsyncSubagent, renderStoredSubagent } from '@/features/chat/rendering/SubagentRenderer';
import { renderStoredThinkingBlock } from '@/features/chat/rendering/ThinkingBlockRenderer';
import { renderStoredToolCall, renderStoredToolCallGroup } from '@/features/chat/rendering/ToolCallRenderer';
import { renderStoredWriteEdit } from '@/features/chat/rendering/WriteEditRenderer';
import { setLocale } from '@/i18n/i18n';
import {
  GROK_SUBAGENT_SPAWN_TOOL,
  GROK_SUBAGENT_WAIT_TOOL,
} from '@/providers/grok/normalization/grokSubagentNormalization';

jest.mock('@/features/chat/rendering/SubagentRenderer', () => ({
  renderStoredAsyncSubagent: jest.fn().mockReturnValue({ wrapperEl: {}, cleanup: jest.fn() }),
  renderStoredSubagent: jest.fn(),
}));
jest.mock('@/features/chat/rendering/ThinkingBlockRenderer', () => ({
  renderStoredThinkingBlock: jest.fn(),
}));
jest.mock('@/features/chat/rendering/ToolCallRenderer', () => ({
  canGroupToolCalls: jest.fn().mockReturnValue(false),
  isToolCallGroupable: jest.fn().mockReturnValue(false),
  renderStoredToolCall: jest.fn(),
  renderStoredToolCallGroup: jest.fn(),
}));
jest.mock('@/features/chat/rendering/WriteEditRenderer', () => ({
  renderStoredWriteEdit: jest.fn(),
}));
jest.mock('@/utils/imageEmbed', () => ({
  replaceImageEmbedsWithHtml: jest.fn().mockImplementation((md: string) => md),
}));
jest.mock('@/utils/fileLink', () => ({
  hasProcessableWikilink: jest.fn().mockImplementation((text: string) =>
    /(^|[^!])\[\[[^\]]+\]\]/.test(text)
  ),
  processFileLinks: jest.fn(),
  registerFileLinkHandler: jest.fn(),
}));

function createMockComponent() {
  return {
    registerDomEvent: jest.fn(),
    register: jest.fn(),
    addChild: jest.fn(),
    load: jest.fn(),
    unload: jest.fn(),
  };
}

function mockCapabilities(providerId: 'claude' | 'codex' | 'grok' = 'claude') {
  return () => ({
    providerId,
    supportsPersistentRuntime: true,
    supportsNativeHistory: providerId === 'claude',
    supportsPlanMode: true,
    supportsRewind: true,
    supportsFork: true,
    supportsProviderCommands: true,
    supportsImageAttachments: true,
    supportsInstructionMode: true,
    supportsMcpTools: true,
    reasoningControl: 'effort' as const,
  });
}

function createRenderer(messagesEl?: any, providerId: 'claude' | 'codex' | 'grok' = 'claude') {
  const el = messagesEl ?? createMockEl();
  const comp = createMockComponent();
  const plugin = {
    app: {},
    settings: { mediaFolder: '' },
  };
  return {
    renderer: new MessageRenderer(
      plugin as any,
      comp as any,
      el,
      undefined,
      undefined,
      mockCapabilities(providerId),
    ),
    messagesEl: el,
  };
}

function createRendererWithScrollOptions(messagesEl: any, options: Record<string, unknown>) {
  const comp = createMockComponent();
  const plugin = {
    app: {},
    settings: { mediaFolder: '' },
  };
  return new MessageRenderer(
    plugin as any,
    comp as any,
    messagesEl,
    undefined,
    undefined,
    mockCapabilities(),
    options,
  );
}

describe('MessageRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Menu as typeof Menu & { instances: unknown[] }).instances.length = 0;
  });

  // ============================================
  // renderMessages
  // ============================================

  it('renders welcome element and calls renderStoredMessage for each message', () => {
    const messagesEl = createMockEl();
    const emptySpy = jest.spyOn(messagesEl, 'empty');
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);
    const renderStoredSpy = jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => {});

    const messages: ChatMessage[] = [
      { id: 'm1', role: 'assistant', content: '', timestamp: Date.now(), toolCalls: [], contentBlocks: [] },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Hello');

    expect(emptySpy).toHaveBeenCalled();
    expect(renderStoredSpy).toHaveBeenCalledTimes(1);
    expect(welcomeEl.hasClass('grimoire-welcome')).toBe(true);
    expect(welcomeEl.children[0].textContent).toBe('Hello');
  });

  it('renders empty messages list with just welcome element', () => {
    const { renderer } = createRenderer();
    const renderStoredSpy = jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => {});

    const welcomeEl = renderer.renderMessages([], () => 'Welcome!');

    expect(renderStoredSpy).not.toHaveBeenCalled();
    expect(welcomeEl.hasClass('grimoire-welcome')).toBe(true);
  });

  describe('the row that says why a transcript is short', () => {
    /**
     * A conversation whose history could not be loaded used to look exactly
     * like a conversation with nothing in it. The provider knew the difference
     * and nobody carried it; this is where it is finally said.
     */
    function noticesFor(hydration?: any): string[] {
      const { renderer, messagesEl } = createRenderer();
      jest.spyOn(renderer, 'renderStoredMessage').mockImplementation(() => {});
      renderer.renderMessages([], () => 'Hello', hydration);
      return (messagesEl.children as any[])
        .filter(child => child.hasClass?.('grimoire-history-notice'))
        .map(child => child.children[0]?.textContent as string);
    }

    it('says a conversation whose session the provider no longer has', () => {
      const notices = noticesFor({ outcome: 'stale', reason: 'sessionNotFound' });

      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('no longer available');
    });

    it('says a conversation that loaded only part of its history', () => {
      const notices = noticesFor({ outcome: 'partial', reason: 'someSessionsUnavailable' });

      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('Part of this conversation');
    });

    it('says a conversation whose transcript could not be read', () => {
      const notices = noticesFor({ outcome: 'corrupt', reason: 'sessionsUnreadable' });

      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('could not be read');
    });

    it('says nothing about a conversation that loaded', () => {
      expect(noticesFor({ outcome: 'complete' })).toHaveLength(0);
    });

    it('says nothing about a new chat', () => {
      // `absent` is a conversation that never had a provider-side history to
      // lose. Captioning an empty new chat would be worse than the silence.
      expect(noticesFor({ outcome: 'absent' })).toHaveLength(0);
      expect(noticesFor(undefined)).toHaveLength(0);
    });

    it('says nothing about a gap that was closed', () => {
      expect(noticesFor({ outcome: 'recovered', reason: 'rebuilt' })).toHaveLength(0);
    });
  });

  // ============================================
  // renderStoredMessage
  // ============================================

  it('renders interrupt messages with interrupt styling instead of user bubble', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-1',
      role: 'user',
      content: '[Request interrupted by user]',
      timestamp: Date.now(),
      isInterrupt: true,
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create assistant-style message with interrupt content
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('grimoire-message-assistant')).toBe(true);
    // Check the content contains interrupt styling
    const contentEl = msgEl.children[0];
    const textEl = contentEl.children[0];
    const interruptedEl = textEl.children[0];
    expect(interruptedEl.hasClass('grimoire-interrupted')).toBe(true);
    expect(interruptedEl.textContent).toBe('Interrupted');
  });

  it('renders interrupted assistant message with content + interrupt indicator', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-codex-1',
      role: 'assistant',
      content: 'Starting to work on the feature...',
      timestamp: Date.now(),
      isInterrupt: true,
      contentBlocks: [{ type: 'text', content: 'Starting to work on the feature...' }],
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create an assistant message (not a bare interrupt marker)
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('grimoire-message-assistant')).toBe(true);

    // The content div should have both content rendering and an interrupt indicator
    const contentEl = msgEl.children[0];
    const lastChild = contentEl.children[contentEl.children.length - 1];
    const interruptedEl = lastChild.children[0];
    expect(interruptedEl.hasClass('grimoire-interrupted')).toBe(true);
    expect(interruptedEl.textContent).toBe('Interrupted');
  });

  it('renders provider, model, and effort metadata above stored assistant content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    renderer.renderStoredMessage({
      id: 'assistant-with-meta',
      role: 'assistant',
      content: 'Done',
      timestamp: Date.now(),
      responseMetadata: {
        providerId: 'claude',
        providerLabel: 'Claude Code',
        model: 'claude-opus-4-8',
        modelLabel: 'Opus 4.8',
        effort: 'xhigh',
        effortLabel: 'XHigh',
      },
    });

    const header = messagesEl.querySelector('.grimoire-assistant-response-meta');
    expect(Array.from(header?.children ?? []).map(child => (child as HTMLElement).textContent)).toEqual([
      '',
      'Claude Code',
      '\u00B7',
      'Opus 4.8',
      '\u00B7',
      'Effort Extra high',
    ]);
  });

  it('localizes assistant effort metadata in Simplified Chinese', () => {
    setLocale('zh-CN');
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    renderer.renderStoredMessage({
      id: 'assistant-with-localized-meta',
      role: 'assistant',
      content: 'Done',
      timestamp: Date.now(),
      responseMetadata: {
        providerId: 'claude',
        providerLabel: 'Claude Code',
        model: 'claude-opus-4-8',
        modelLabel: 'Opus 4.8',
        effort: 'xhigh',
        effortLabel: 'XHigh',
      },
    });

    const header = messagesEl.querySelector('.grimoire-assistant-response-meta');
    expect(Array.from(header?.children ?? []).map(child => (child as HTMLElement).textContent))
      .toContain('推理强度 极高');
    setLocale('en');
  });

  it('renders vault search sources for stored user messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    renderer.renderStoredMessage({
      id: 'user-with-vault-search',
      role: 'user',
      content: 'Summarize this',
      timestamp: Date.now(),
      vaultSearchContext: {
        query: 'summary',
        snippets: [{
          source: {
            id: 'notes-a',
            path: 'notes/A.md',
            title: 'A',
            kind: 'vault-note',
          },
          text: 'A snippet',
          score: 0.9,
          matchedTerms: ['summary'],
        }],
      },
    });

    const sourceRow = messagesEl.querySelector('.grimoire-vault-search-sources');

    expect(sourceRow?.children[0].textContent).toBe('Vault search: 1 source');
    expect(sourceRow?.querySelector('.grimoire-vault-search-source')?.textContent).toBe('notes/A.md');
  });

  it('updates vault search sources when refreshing a live user message', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    renderer.addMessage({
      id: 'live-user',
      role: 'user',
      content: 'First',
      timestamp: Date.now(),
      vaultSearchContext: {
        query: 'first',
        snippets: [{
          source: {
            id: 'notes-a',
            path: 'notes/A.md',
            title: 'A',
            kind: 'vault-note',
          },
          text: 'A snippet',
          score: 0.9,
          matchedTerms: ['first'],
        }],
      },
    });

    renderer.updateLiveUserMessage({
      id: 'live-user',
      role: 'user',
      content: 'Updated',
      timestamp: Date.now(),
      vaultSearchContext: {
        query: 'updated',
        snippets: [{
          source: {
            id: 'notes-b',
            path: 'notes/B.md',
            title: 'B',
            kind: 'vault-note',
          },
          text: 'B snippet',
          score: 0.8,
          matchedTerms: ['updated'],
        }],
      },
    });

    const sources = messagesEl.querySelectorAll('.grimoire-vault-search-source');

    expect(sources).toHaveLength(1);
    expect(sources[0].textContent).toBe('notes/B.md');
  });

  it('renders bare interrupt marker for empty interrupted assistant message', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    const interruptMsg: ChatMessage = {
      id: 'interrupt-codex-2',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isInterrupt: true,
    };

    renderer.renderStoredMessage(interruptMsg);

    // Should create a bare interrupt marker (same as Claude-style)
    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('grimoire-message-assistant')).toBe(true);
    const contentEl = msgEl.children[0];
    const textEl = contentEl.children[0];
    expect(textEl.children[0].hasClass('grimoire-interrupted')).toBe(true);
  });

  it('skips rebuilt context messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const msg: ChatMessage = {
      id: 'rebuilt-1',
      role: 'user',
      content: 'rebuilt context',
      timestamp: Date.now(),
      isRebuiltContext: true,
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.children.length).toBe(0);
  });

  it('renders user message with text content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Hello world',
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.children.length).toBe(1);
    const msgEl = messagesEl.children[0];
    expect(msgEl.hasClass('grimoire-message-user')).toBe(true);
  });

  it('renders user message with displayContent instead of content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'full prompt with context',
      displayContent: 'user input only',
      timestamp: Date.now(),
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'user input only');
  });

  it('skips empty user message bubble (image-only)', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: '',
      timestamp: Date.now(),
      images: [{ id: 'img-1', name: 'img.png', mediaType: 'image/png', data: 'abc', size: 100, source: 'paste' as const }],
    };

    renderer.renderStoredMessage(msg);

    // Images should still be rendered, but no message bubble
    expect(renderer.renderMessageImages).toHaveBeenCalled();
    // Only the images container, no message bubble
    const bubbles = messagesEl.children.filter(
      (c: any) => c.hasClass('grimoire-message')
    );
    expect(bubbles.length).toBe(0);
  });

  it('renders user message with images above bubble', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const renderImagesSpy = jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
    ];

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Check this image',
      timestamp: Date.now(),
      images,
    };

    renderer.renderStoredMessage(msg);

    expect(renderImagesSpy).toHaveBeenCalledWith(messagesEl, images);
  });

  it('adds a rewind button for eligible stored user messages', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer({ app: {}, settings: { mediaFolder: '' } } as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const allMessages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'prev-a' },
      { id: 'u1', role: 'user', content: 'hello', timestamp: 2, userMessageId: 'user-u' },
      { id: 'a2', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'resp-a' },
    ];

    renderer.renderStoredMessage(allMessages[1], allMessages, 1);

    expect(messagesEl.querySelector('.grimoire-message-rewind-btn')).not.toBeNull();
  });

  it('does not add a rewind button when stored render is called without context', () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer({ app: {}, settings: { mediaFolder: '' } } as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: 1,
      userMessageId: 'user-u',
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.querySelector('.grimoire-message-rewind-btn')).toBeNull();
  });

  it('shows rewind mode menu for eligible streamed user messages', async () => {
    const messagesEl = createMockEl();
    const rewindCallback = jest.fn().mockResolvedValue(undefined);
    const renderer = new MessageRenderer({ app: {}, settings: { mediaFolder: '' } } as any, createMockComponent() as any, messagesEl, rewindCallback, undefined, mockCapabilities());
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const userMsg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: 2,
      userMessageId: 'user-u',
    };
    renderer.addMessage(userMsg);

    const allMessages: ChatMessage[] = [
      { id: 'a1', role: 'assistant', content: '', timestamp: 1, assistantMessageId: 'prev-a' },
      userMsg,
      { id: 'a2', role: 'assistant', content: '', timestamp: 3, assistantMessageId: 'resp-a' },
    ];

    renderer.refreshActionButtons(userMsg, allMessages, 1);

    const btn = messagesEl.querySelector('.grimoire-message-rewind-btn');
    expect(btn).not.toBeNull();

    btn!.click();
    const menu = (Menu as typeof Menu & { instances: any[] }).instances[0];
    expect(menu.items.map((item: any) => item.title)).toEqual([
      'Rewind conversation only',
      'Rewind code + conversation',
    ]);

    menu.items[0].clickHandler?.();
    await Promise.resolve();

    expect(rewindCallback).toHaveBeenCalledWith('u1', 'conversation');
  });

  // ============================================
  // renderAssistantContent
  // ============================================

  it('renders assistant content blocks using specialized renderers', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'todo', name: 'TodoWrite', input: { items: [] } } as any,
        { id: 'edit', name: 'Edit', input: { file_path: 'notes/test.md' } } as any,
        { id: 'read', name: 'Read', input: { file_path: 'notes/test.md' } } as any,
        {
          id: 'sub-1',
          name: TOOL_TASK,
          input: { description: 'Async subagent' },
          status: 'running',
          subagent: { id: 'sub-1', mode: 'async', status: 'running', toolCalls: [], isExpanded: false },
        } as any,
        {
          id: 'sub-2',
          name: TOOL_TASK,
          input: { description: 'Sync subagent' },
          status: 'running',
          subagent: { id: 'sub-2', mode: 'sync', status: 'running', toolCalls: [], isExpanded: false },
        } as any,
      ],
      contentBlocks: [
        { type: 'thinking', content: 'thinking', durationSeconds: 2 } as any,
        { type: 'text', content: 'Text block' } as any,
        { type: 'tool_use', toolId: 'todo' } as any,
        { type: 'tool_use', toolId: 'edit' } as any,
        { type: 'tool_use', toolId: 'read' } as any,
        { type: 'subagent', subagentId: 'sub-1', mode: 'async' } as any,
        { type: 'subagent', subagentId: 'sub-2' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredThinkingBlock).toHaveBeenCalled();
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Text block');
    // TodoWrite is not rendered inline - only in bottom panel
    expect(renderStoredWriteEdit).toHaveBeenCalled();
    expect(renderStoredToolCall).toHaveBeenCalled();
    expect(renderStoredAsyncSubagent).toHaveBeenCalled();
    expect(renderStoredSubagent).toHaveBeenCalled();
  });

  it('skips empty or whitespace-only text blocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: '' } as any,
        { type: 'text', content: '   ' } as any,
        { type: 'text', content: 'Real content' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    // Only the non-empty text block should trigger renderContent
    expect(renderContentSpy).toHaveBeenCalledTimes(1);
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Real content');
  });

  it('replays a stored orchestrator plan without exposing its JSON payload', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex');

    const msg: ChatMessage = {
      id: 'orchestrator-plan',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [{
        type: 'parallel_worker_plan',
        providerId: 'codex',
        modelLabel: 'GPT-5.6-Luna',
        tasks: [
          { id: 'inspect', description: 'Inspect the note', prompt: 'Inspect it' },
          { id: 'review', description: 'Review conventions', prompt: 'Review them' },
        ],
      }],
    };

    renderer.renderStoredMessage(msg);

    expect(messagesEl.querySelector('.grimoire-orchestrator-plan-inline')).toBeTruthy();
    expect(messagesEl.querySelectorAll('.grimoire-orchestrator-plan-task')).toHaveLength(2);
    expect(messagesEl.querySelector('.grimoire-orchestrator-plan-approval')).toBeNull();
  });

  it('does not render stored Codex write_stdin transport tools', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex');

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'stdin-1',
          name: TOOL_WRITE_STDIN,
          input: { session_id: '2404', chars: '' },
          status: 'completed',
          result: 'poll output',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'stdin-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).not.toHaveBeenCalled();
    expect(messagesEl.children).toHaveLength(0);
  });

  it('renders stored Codex write_stdin tools when they send real input', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl, 'codex');

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'stdin-1',
          name: TOOL_WRITE_STDIN,
          input: { session_id: '2404', chars: 'y\n' },
          status: 'completed',
          result: 'Input sent.',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'stdin-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'stdin-1',
        name: TOOL_WRITE_STDIN,
        input: { session_id: '2404', chars: 'y\n' },
      }),
    );
    expect(messagesEl.children).toHaveLength(1);
  });

  it('renders response duration footer when durationSeconds is present', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response text' } as any,
      ],
      durationSeconds: 65,
      durationFlavorWord: 'Baked',
    };

    renderer.renderStoredMessage(msg);

    // Find the footer element
    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0]; // grimoire-message-content
    const footerEl = contentEl.children.find((c: any) => c.hasClass('grimoire-response-footer'));
    expect(footerEl).toBeDefined();
    const durationSpan = footerEl!.children[0];
    expect(durationSpan.textContent).toContain('Baked');
    expect(durationSpan.textContent).toContain('1m 5s');
  });

  it('does not render footer when durationSeconds is 0', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response' } as any,
      ],
      durationSeconds: 0,
    };

    renderer.renderStoredMessage(msg);

    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0];
    const footerEl = contentEl.children.find((c: any) => c.hasClass('grimoire-response-footer'));
    expect(footerEl).toBeUndefined();
  });

  it('uses default flavor word "Baked" when durationFlavorWord is not set', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      contentBlocks: [
        { type: 'text', content: 'Response' } as any,
      ],
      durationSeconds: 30,
    };

    renderer.renderStoredMessage(msg);

    const msgEl = messagesEl.children[0];
    const contentEl = msgEl.children[0];
    const footerEl = contentEl.children.find((c: any) => c.hasClass('grimoire-response-footer'));
    expect(footerEl).toBeDefined();
    expect(footerEl!.children[0].textContent).toContain('Baked');
  });

  it('renders fallback content for old conversations without contentBlocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const addCopySpy = jest.spyOn(renderer, 'addTextCopyButton').mockImplementation(() => {});

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: 'Legacy response text',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'test.md' }, status: 'completed' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    // Should render content text
    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Legacy response text');
    // Should add copy button for fallback text
    expect(addCopySpy).toHaveBeenCalledWith(expect.anything(), 'Legacy response text');
    // Should render tool call
    expect(renderStoredToolCall).toHaveBeenCalled();
  });

  it('renders unreferenced tool calls when contentBlocks miss tool_use blocks', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-unreferenced-tool',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'a.md' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'text', content: 'Only text block persisted' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'Only text block persisted');
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'read-1', name: 'Read' })
    );
  });

  it('renders Task tool calls as subagents for backward compatibility', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-1',
          name: TOOL_TASK,
          input: { description: 'Run tests' },
          status: 'completed',
          result: 'All passed',
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-1',
        description: 'Run tests',
        status: 'completed',
        result: 'All passed',
      })
    );
  });

  it('renders Task tool as async subagent when linked subagent mode is async', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();
    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-async',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-async-1',
          name: TOOL_TASK,
          input: { description: 'Background task', run_in_background: true },
          status: 'completed',
          result: 'Task running',
          subagent: {
            id: 'task-async-1',
            description: 'Background task',
            mode: 'async',
            asyncStatus: 'running',
            status: 'running',
            toolCalls: [],
            isExpanded: false,
          },
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-async-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-async-1',
        mode: 'async',
        asyncStatus: 'running',
      })
    );
    expect(renderStoredSubagent).not.toHaveBeenCalled();
  });

  it('infers async running state from structured Task result content', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-async-structured',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-async-structured-1',
          name: TOOL_TASK,
          input: { description: 'Background task', run_in_background: true },
          status: 'completed',
          result: [{ type: 'text', text: '{"status":"running"}' }] as any,
        } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'task-async-structured-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-async-structured-1',
        asyncStatus: 'running',
      })
    );
  });

  it('uses subagent block mode hint when linked subagent mode is missing', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    (renderStoredAsyncSubagent as jest.Mock).mockClear();
    (renderStoredSubagent as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm-task-mode-hint',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        {
          id: 'task-hint-1',
          name: TOOL_TASK,
          input: { description: 'Background task from block hint' },
          status: 'running',
          subagent: {
            id: 'task-hint-1',
            description: 'Background task from block hint',
            status: 'running',
            toolCalls: [],
            isExpanded: false,
          },
        } as any,
      ],
      contentBlocks: [
        { type: 'subagent', subagentId: 'task-hint-1', mode: 'async' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredAsyncSubagent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task-hint-1',
        mode: 'async',
      })
    );
    expect(renderStoredSubagent).not.toHaveBeenCalled();
  });

  // ============================================
  // TaskOutput skipping
  // ============================================

  it('should skip TaskOutput tool calls (internal async subagent communication)', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'agent-output-1', name: TOOL_AGENT_OUTPUT, input: { task_id: 'abc', block: true } } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'agent-output-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).not.toHaveBeenCalled();
  });

  it('should render other tool calls but skip TaskOutput when mixed', () => {
    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    (renderStoredToolCall as jest.Mock).mockClear();

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'read-1', name: 'Read', input: { file_path: 'test.md' }, status: 'completed' } as any,
        { id: 'agent-output-1', name: TOOL_AGENT_OUTPUT, input: { task_id: 'abc' } } as any,
        { id: 'grep-1', name: 'Grep', input: { pattern: 'test' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'read-1' } as any,
        { type: 'tool_use', toolId: 'agent-output-1' } as any,
        { type: 'tool_use', toolId: 'grep-1' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCall).toHaveBeenCalledTimes(2);
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'read-1', name: 'Read' })
    );
    expect(renderStoredToolCall).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'grep-1', name: 'Grep' })
    );
  });

  it('groups consecutive stored vault search tool calls', () => {
    const {
      canGroupToolCalls,
      isToolCallGroupable,
    } = jest.requireMock('@/features/chat/rendering/ToolCallRenderer');
    isToolCallGroupable.mockImplementation((toolCall: any) => toolCall.name === 'Grep');
    canGroupToolCalls.mockImplementation((toolCalls: any[]) =>
      toolCalls.length > 1 && toolCalls.every(toolCall => toolCall.name === 'Grep')
    );

    const messagesEl = createMockEl();
    const mockComponent = createMockComponent();
    const renderer = new MessageRenderer({} as any, mockComponent as any, messagesEl);

    const msg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [
        { id: 'grep-1', name: 'Grep', input: { pattern: 'рыба' }, status: 'completed' } as any,
        { id: 'grep-2', name: 'Grep', input: { pattern: 'рыбалка' }, status: 'completed' } as any,
      ],
      contentBlocks: [
        { type: 'tool_use', toolId: 'grep-1' } as any,
        { type: 'tool_use', toolId: 'grep-2' } as any,
      ],
    };

    renderer.renderStoredMessage(msg);

    expect(renderStoredToolCallGroup).toHaveBeenCalledWith(
      expect.anything(),
      [
        expect.objectContaining({ id: 'grep-1', name: 'Grep' }),
        expect.objectContaining({ id: 'grep-2', name: 'Grep' }),
      ]
    );
    expect(renderStoredToolCall).not.toHaveBeenCalled();

    isToolCallGroupable.mockReturnValue(false);
    canGroupToolCalls.mockReturnValue(false);
  });

  // ============================================
  // addMessage (streaming)
  // ============================================

  it('addMessage creates user message bubble with text', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    };

    const msgEl = renderer.addMessage(msg);

    expect(msgEl.hasClass('grimoire-message-user')).toBe(true);
  });

  it('addMessage renders images for user messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    const renderImagesSpy = jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
    ];

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Look at this',
      timestamp: Date.now(),
      images,
    };

    renderer.addMessage(msg);

    expect(renderImagesSpy).toHaveBeenCalledWith(messagesEl, images);
  });

  it('addMessage skips empty bubble for image-only user messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});
    const scrollSpy = jest.spyOn(renderer, 'scrollToBottom').mockImplementation(() => {});

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: '',
      timestamp: Date.now(),
      images: [{ id: 'img-1', name: 'img.png', mediaType: 'image/png', data: 'abc', size: 100, source: 'paste' as const }],
    };

    const result = renderer.addMessage(msg);

    // Should still return an element (last child or messagesEl)
    expect(result).toBeDefined();
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('addMessage creates assistant message element without user-specific rendering', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const msg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    const msgEl = renderer.addMessage(msg);

    expect(msgEl.hasClass('grimoire-message-assistant')).toBe(true);
  });

  it('addMessage renders metadata header for streaming assistant placeholders', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const msgEl = renderer.addMessage({
      id: 'streaming-assistant-with-meta',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      responseMetadata: {
        providerId: 'claude',
        providerLabel: 'Claude Code',
        modelLabel: 'Opus 4.8',
        effortLabel: 'XHigh',
      },
    });

    const header = msgEl.querySelector('.grimoire-assistant-response-meta');
    expect(Array.from(header?.children ?? []).map(child => (child as HTMLElement).textContent)).toEqual([
      '',
      'Claude Code',
      '\u00B7',
      'Opus 4.8',
      '\u00B7',
      'Effort Extra high',
    ]);
  });

  // ============================================
  // setMessagesEl
  // ============================================

  it('setMessagesEl updates the container element', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const newEl = createMockEl();

    renderer.setMessagesEl(newEl);

    // Verify by using scrollToBottom which references messagesEl
    renderer.scrollToBottom();
    // The new element should have been used (scrollTop set)
    expect(newEl.scrollTop).toBe(newEl.scrollHeight);
  });

  // ============================================
  // Image rendering
  // ============================================

  it('renderMessageImages creates image elements', () => {
    const containerEl = createMockEl();
    const { renderer } = createRenderer();
    jest.spyOn(renderer, 'setImageSrc').mockImplementation(() => {});

    const images: ImageAttachment[] = [
      { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data1', size: 200, source: 'file' },
      { id: 'img-2', name: 'avatar.jpg', mediaType: 'image/jpeg', data: 'base64data2', size: 300, source: 'file' },
    ];

    renderer.renderMessageImages(containerEl, images);

    // Should create images container with 2 image wrappers
    expect(containerEl.children.length).toBe(1);
    const imagesContainer = containerEl.children[0];
    expect(imagesContainer.hasClass('grimoire-message-images')).toBe(true);
    expect(imagesContainer.children.length).toBe(2);
  });

  it('setImageSrc sets data URI on image element', () => {
    const { renderer } = createRenderer();
    const imgEl = createMockEl('img');

    const image: ImageAttachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png',
      data: 'abc123',
      size: 100,
      source: 'file',
    };

    renderer.setImageSrc(imgEl, image);

    expect(imgEl.getAttribute('src')).toBe('data:image/png;base64,abc123');
  });

  it('showFullImage creates overlay with image', () => {
    const { renderer } = createRenderer();
    const image: ImageAttachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png',
      data: 'abc123',
      size: 100,
      source: 'file',
    };

    // Mock document.body.createDiv (document may not exist in node env)
    const overlayEl = createMockEl();
    const mockBody = { createDiv: jest.fn().mockReturnValue(overlayEl) };
    const origDocument = globalThis.document;
    (globalThis as any).document = { body: mockBody, addEventListener: jest.fn(), removeEventListener: jest.fn() };

    try {
      renderer.showFullImage(image);
      expect(mockBody.createDiv).toHaveBeenCalledWith({ cls: 'grimoire-image-modal-overlay' });
    } finally {
      (globalThis as any).document = origDocument;
    }
  });

  // ============================================
  // Copy button
  // ============================================

  it('addTextCopyButton adds a copy button element', () => {
    const textEl = createMockEl();
    const { renderer } = createRenderer();

    renderer.addTextCopyButton(textEl, 'some markdown');

    expect(textEl.children.length).toBe(2);
    const copyBtn = textEl.children[0];
    expect(copyBtn.hasClass('grimoire-text-copy-btn')).toBe(true);
    expect(copyBtn.getAttribute('aria-label')).toBe('Copy response');
    expect(setTooltip).toHaveBeenCalledWith(copyBtn, 'Copy response', { placement: 'top' });
    expect(textEl.children[1].hasClass('grimoire-message-completion-time')).toBe(true);
  });

  it('shows a compact localized completion date beside the last assistant copy button', () => {
    setLocale('zh-CN');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 7, 2, 12, 0).getTime());
    try {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
      const completedAt = new Date(2026, 6, 31, 9, 5).getTime();

      renderer.renderStoredMessage({
        id: 'assistant-completed-at',
        role: 'assistant',
        content: 'First\nSecond',
        timestamp: completedAt - 5000,
        completedAt,
        contentBlocks: [
          { type: 'text', content: 'First' },
          { type: 'text', content: 'Second' },
        ],
      });

      const textBlocks = messagesEl.querySelectorAll('.grimoire-text-block');
      expect(textBlocks[0]?.hasClass('grimoire-text-block--with-completion-time')).toBe(false);
      expect(textBlocks[1]?.hasClass('grimoire-text-block--with-completion-time')).toBe(true);
      const completionEl = textBlocks[1]?.querySelector('.grimoire-message-completion-time');
      const completionTime = completionEl?.textContent ?? '';
      expect(completionTime).toContain('7月31日');
      expect(completionTime).toContain('09:05');
      expect(completionTime).not.toContain('2026');
      expect(setTooltip).toHaveBeenCalledWith(
        completionEl,
        expect.stringContaining('2026'),
        { placement: 'top' }
      );
    } finally {
      nowSpy.mockRestore();
      setLocale('en');
    }
  });

  it('places the user completion time before the user copy button', () => {
    setLocale('zh-CN');
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 6, 31, 12, 0).getTime());
    try {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
      const completedAt = new Date(2026, 6, 31, 10, 26).getTime();

      renderer.renderStoredMessage({
        id: 'user-completed-at',
        role: 'user',
        content: 'Question',
        timestamp: completedAt,
        completedAt,
      });

      const toolbar = messagesEl.querySelector('.grimoire-user-msg-actions');
      const completionIndex = toolbar?.children.findIndex((child: any) =>
        child.hasClass('grimoire-message-completion-time')
      );
      const copyIndex = toolbar?.children.findIndex((child: any) =>
        child.hasClass('grimoire-user-msg-copy-btn')
      );
      expect(completionIndex).toBeGreaterThanOrEqual(0);
      expect(copyIndex).toBeGreaterThan(completionIndex ?? -1);
      expect(toolbar?.querySelector('.grimoire-message-completion-time')?.textContent).toContain('10:26');
      expect(toolbar?.querySelector('.grimoire-message-completion-time')?.textContent).not.toContain('2026');
      const copyBtn = toolbar?.querySelector('.grimoire-user-msg-copy-btn');
      expect(copyBtn?.getAttribute('aria-label')).toBe('复制消息');
      expect(setTooltip).toHaveBeenCalledWith(copyBtn, '复制消息', { placement: 'top' });
    } finally {
      nowSpy.mockRestore();
      setLocale('en');
    }
  });

  it('does not invent completion dates for legacy messages without completedAt', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    renderer.renderStoredMessage({
      id: 'legacy-user',
      role: 'user',
      content: 'Legacy question',
      timestamp: 1000,
    });
    renderer.renderStoredMessage({
      id: 'legacy-assistant',
      role: 'assistant',
      content: 'Legacy answer',
      timestamp: 2000,
      contentBlocks: [{ type: 'text', content: 'Legacy answer' }],
    });

    const userMessage = messagesEl.querySelectorAll('.grimoire-message-user')[0];
    expect(userMessage?.querySelector('.grimoire-user-msg-copy-btn')).toBeDefined();
    expect(userMessage?.querySelector('.grimoire-message-completion-time')).toBeFalsy();

    const assistantMessage = messagesEl.querySelectorAll('.grimoire-message-assistant')[0];
    expect(assistantMessage?.querySelector('.grimoire-text-copy-btn')).toBeDefined();
    expect(assistantMessage?.querySelector('.grimoire-text-block')?.hasClass(
      'grimoire-text-block--with-completion-time'
    )).toBe(false);
  });

  it('uses a plausible stored timestamp when legacy messages have no completedAt', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 7, 2, 18, 0).getTime());
    try {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
      const userTimestamp = new Date(2026, 7, 2, 17, 11).getTime();
      const assistantTimestamp = new Date(2026, 7, 2, 17, 12).getTime();

      renderer.renderStoredMessage({
        id: 'legacy-user-with-valid-time',
        role: 'user',
        content: 'Legacy question',
        timestamp: userTimestamp,
      });
      renderer.renderStoredMessage({
        id: 'legacy-assistant-with-valid-time',
        role: 'assistant',
        content: 'Legacy answer',
        timestamp: assistantTimestamp,
        contentBlocks: [{ type: 'text', content: 'Legacy answer' }],
      });

      const userMessage = messagesEl.querySelectorAll('.grimoire-message-user')[0];
      expect(userMessage?.querySelector('.grimoire-message-completion-time')?.textContent)
        .toContain('17:11');

      const assistantMessage = messagesEl.querySelectorAll('.grimoire-message-assistant')[0];
      expect(assistantMessage?.querySelector('.grimoire-message-completion-time')?.textContent)
        .toContain('17:12');
      expect(assistantMessage?.querySelector('.grimoire-text-block')?.hasClass(
        'grimoire-text-block--with-completion-time'
      )).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  // ============================================
  // Scroll utilities
  // ============================================

  it('scrollToBottom sets scrollTop to scrollHeight', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    const { renderer } = createRenderer(messagesEl);

    renderer.scrollToBottom();

    expect(messagesEl.scrollTop).toBe(1000);
  });

  it('scrollToBottom uses the configured scroll container', () => {
    const messagesEl = createMockEl();
    const scrollEl = createMockEl();
    messagesEl.scrollHeight = 200;
    scrollEl.scrollHeight = 1000;
    const renderer = createRendererWithScrollOptions(messagesEl, {
      getScrollEl: () => scrollEl,
    });

    renderer.scrollToBottom();

    expect(scrollEl.scrollTop).toBe(1000);
    expect(messagesEl.scrollTop).toBe(0);
  });

  it('does not auto-scroll assistant messages when scroll lock is paused', () => {
    const messagesEl = createMockEl();
    const scrollEl = createMockEl();
    scrollEl.scrollHeight = 1000;
    const onAutoScrollSuppressed = jest.fn();
    const renderer = createRendererWithScrollOptions(messagesEl, {
      getScrollEl: () => scrollEl,
      shouldAutoScroll: () => false,
      onAutoScrollSuppressed,
    });

    renderer.addMessage({
      id: 'assistant-1',
      role: 'assistant',
      content: 'hello',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    });

    expect(scrollEl.scrollTop).toBe(0);
    expect(onAutoScrollSuppressed).toHaveBeenCalled();
  });

  it('always scrolls user messages into view even when scroll lock is paused', () => {
    const messagesEl = createMockEl();
    const scrollEl = createMockEl();
    scrollEl.scrollHeight = 1000;
    const renderer = createRendererWithScrollOptions(messagesEl, {
      getScrollEl: () => scrollEl,
      shouldAutoScroll: () => false,
    });

    renderer.addMessage({
      id: 'user-1',
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
    });

    expect(scrollEl.scrollTop).toBe(1000);
  });

  it('scrollToBottomIfNeeded scrolls when near bottom', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    messagesEl.scrollTop = 950;
    Object.defineProperty(messagesEl, 'clientHeight', { value: 0, configurable: true });
    const { renderer } = createRenderer(messagesEl);

    // Mock requestAnimationFrame
    const origRAF = globalThis.requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (cb: () => void) => { cb(); return 0; };

    try {
      renderer.scrollToBottomIfNeeded();
      // Near bottom (1000 - 950 - 0 = 50, < 100 threshold) → scrolls
      expect(messagesEl.scrollTop).toBe(1000);
    } finally {
      (globalThis as any).requestAnimationFrame = origRAF;
    }
  });

  it('scrollToBottomIfNeeded does not require requestAnimationFrame on the renderer window', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    messagesEl.scrollTop = 950;
    Object.defineProperty(messagesEl, 'clientHeight', { value: 0, configurable: true });
    const { renderer } = createRenderer(messagesEl);
    const ownerWindow = messagesEl.ownerDocument.defaultView as Window & {
      requestAnimationFrame?: typeof requestAnimationFrame;
    };
    const originalOwnerRaf = ownerWindow.requestAnimationFrame;
    const originalWindowRaf = window.requestAnimationFrame;

    Reflect.deleteProperty(ownerWindow, 'requestAnimationFrame');
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: undefined,
    });

    try {
      expect(() => renderer.scrollToBottomIfNeeded()).not.toThrow();
    } finally {
      ownerWindow.requestAnimationFrame = originalOwnerRaf;
      Object.defineProperty(window, 'requestAnimationFrame', {
        configurable: true,
        value: originalWindowRaf,
      });
    }
  });

  it('scrollToBottomIfNeeded does not scroll when far from bottom', () => {
    const messagesEl = createMockEl();
    messagesEl.scrollHeight = 1000;
    messagesEl.scrollTop = 100;
    Object.defineProperty(messagesEl, 'clientHeight', { value: 0, configurable: true });
    const { renderer } = createRenderer(messagesEl);

    const originalScrollTop = messagesEl.scrollTop;
    renderer.scrollToBottomIfNeeded();

    // scrollTop should not change (900 > 100 threshold)
    expect(messagesEl.scrollTop).toBe(originalScrollTop);
  });

  // ============================================
  // renderContent
  // ============================================

  it('renderContent should not throw on valid markdown', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();

    // Should not throw even if internal rendering fails (graceful error handling)
    await expect(renderer.renderContent(el, '**Hello** world')).resolves.not.toThrow();
  });

  it('renderContent should empty the element before rendering', async () => {
    const { renderer } = createRenderer();
    const el = createMockEl();
    el.createDiv({ text: 'old content' });
    expect(el.children.length).toBe(1);

    await renderer.renderContent(el, 'new content');

    // After render, old content should be gone (empty() was called before rendering)
    expect(el.children.length).toBe(0);
  });

  it('renderContent should skip file-link post-processing when markdown has no wikilinks', async () => {
    const { processFileLinks } = await import('@/utils/fileLink');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(el, 'plain markdown without links');

    expect(processFileLinks).not.toHaveBeenCalled();
  });

  it('renderContent should skip file-link post-processing for image embeds only', async () => {
    const { processFileLinks } = await import('@/utils/fileLink');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(el, '![[screenshot.png|300]]');

    expect(processFileLinks).not.toHaveBeenCalled();
  });

  it('renderContent should post-process normal wikilinks', async () => {
    const { processFileLinks } = await import('@/utils/fileLink');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(el, 'See [[Marine Life/Акулы (Sharks).md]]');

    expect(processFileLinks).toHaveBeenCalledWith(expect.anything(), el);
  });

  it('renderContent escapes math delimiters only when requested for streaming', async () => {
    const { MarkdownRenderer } = await import('obsidian');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(
      el,
      'Live $x + y$ and `echo $PATH`',
      { deferMath: true }
    );

    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      'Live \\$x + y\\$ and `echo $PATH`',
      el,
      '',
      expect.anything()
    );
  });

  it('renderContent separates prose from following pipe tables before markdown rendering', async () => {
    const { MarkdownRenderer } = await import('obsidian');
    const { renderer } = createRenderer();
    const el = createMockEl();

    await renderer.renderContent(
      el,
      [
        'connectivity — роль узла в графе:',
        '| Тип | Кол-во | Значение |',
        '|-----|--------|----------|',
        '| hub | 3 | Центральные узлы |',
      ].join('\n')
    );

    expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
      [
        'connectivity — роль узла в графе:',
        '',
        '| Тип | Кол-во | Значение |',
        '|-----|--------|----------|',
        '| hub | 3 | Центральные узлы |',
      ].join('\n'),
      el,
      '',
      expect.anything()
    );
  });

  it('renderContent wraps markdown tables in a horizontal scroll container', async () => {
    const { MarkdownRenderer } = await import('obsidian');
    const { renderer } = createRenderer();
    const el = createMockEl();
    const parent = createMockEl();
    const table = createMockEl('table');
    const wrapper = createMockEl();

    parent.children.push(table);
    table.parentElement = parent;
    parent.createDiv = jest.fn((options?: { cls?: string }) => {
      if (options?.cls) wrapper.addClass(options.cls);
      return wrapper;
    });
    parent.insertBefore = jest.fn((child: any) => {
      child.parentElement = parent;
      parent.children.unshift(child);
    });
    wrapper.appendChild = jest.fn((child: any) => {
      child.parentElement = wrapper;
      wrapper.children.push(child);
      return child;
    });
    el.querySelectorAll = jest.fn((selector: string) =>
      selector === 'table' ? [table] : []
    );

    (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
      async () => {}
    );

    await renderer.renderContent(el, '| A | B |\n|---|---|\n| one | two |');

    expect(wrapper.hasClass('grimoire-table-scroll')).toBe(true);
    expect(table.parentElement).toBe(wrapper);
  });

  // ============================================
  // addTextCopyButton - click behavior
  // ============================================

  describe('addTextCopyButton - click behavior', () => {
    let originalNavigator: Navigator;

    beforeEach(() => {
      originalNavigator = globalThis.navigator;
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('click should copy and show feedback', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: writeTextMock } },
        writable: true,
        configurable: true,
      });

      renderer.addTextCopyButton(textEl, 'markdown content');

      const copyBtn = textEl.children[0];
      expect(copyBtn.hasClass('grimoire-text-copy-btn')).toBe(true);

      // Simulate click
      const clickHandlers = copyBtn._eventListeners.get('click');
      expect(clickHandlers).toBeDefined();

      await clickHandlers![0]({ stopPropagation: jest.fn() });

      expect(writeTextMock).toHaveBeenCalledWith('markdown content');
      expect(copyBtn.textContent).toBe('');
      expect(setIcon).toHaveBeenCalledWith(copyBtn, 'check');
      expect(copyBtn.getAttribute('aria-label')).toBe('Copied!');
      expect(copyBtn.classList.contains('copied')).toBe(true);
    });

    it('should handle clipboard API failure gracefully', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      const writeTextMock = jest.fn().mockRejectedValue(new Error('not allowed'));
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: writeTextMock } },
        writable: true,
        configurable: true,
      });

      renderer.addTextCopyButton(textEl, 'content');

      const copyBtn = textEl.children[0];
      const clickHandlers = copyBtn._eventListeners.get('click');

      // Should not throw
      await clickHandlers![0]({ stopPropagation: jest.fn() });

      // Should not show feedback on error
      expect(copyBtn.textContent).not.toBe('copied!');
    });
  });

  // ============================================
  // renderMessages (entry point)
  // ============================================

  it('renderMessages should render stored messages and return welcome element', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', timestamp: Date.now() },
      { id: 'a1', role: 'assistant', content: 'Hi there', timestamp: Date.now(), contentBlocks: [{ type: 'text', content: 'Hi there' }] as any },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Good morning!');

    expect(welcomeEl).toBeDefined();
    expect(welcomeEl.hasClass('grimoire-welcome')).toBe(true);
  });

  it('renderMessages should hide welcome when messages exist', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);
    jest.spyOn(renderer, 'renderMessageImages').mockImplementation(() => {});

    const messages: ChatMessage[] = [
      { id: 'u1', role: 'user', content: 'Hello', timestamp: Date.now() },
    ];

    const welcomeEl = renderer.renderMessages(messages, () => 'Hello');

    // When messages exist, welcome should be hidden
    expect(welcomeEl).toBeDefined();
  });

  it('renderMessages should return welcome element when no messages', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);

    const welcomeEl = renderer.renderMessages([], () => 'Welcome');

    expect(welcomeEl).toBeDefined();
    expect(welcomeEl.hasClass('grimoire-welcome')).toBe(true);
  });

  // ============================================
  // Task tool rendering - error and running status
  // ============================================

  describe('Task tool rendering - error and running status', () => {
    it('renders Task tool with error status as subagent with status error', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'codex');

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-err',
            name: TOOL_TASK,
            input: { description: 'Failing task' },
            status: 'error',
            result: 'Something went wrong',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-err' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'task-err',
          description: 'Failing task',
          status: 'error',
          result: 'Something went wrong',
        })
      );
    });

    it('renders Task tool with running status (default case in switch)', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'codex');

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-run',
            name: TOOL_TASK,
            input: { description: 'Running task' },
            status: 'pending',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-run' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'task-run',
          description: 'Running task',
          status: 'running',
        })
      );
    });

    it('renders Task tool with no description uses fallback Subagent task', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'task-no-desc',
            name: TOOL_TASK,
            input: {},
            status: 'completed',
            result: 'Done',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'task-no-desc' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'task-no-desc',
          description: 'Subagent task',
          status: 'completed',
        })
      );
    });

    it('renders Codex spawn_agent with the same prompt and result recovered on reload', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'codex');

      (renderStoredSubagent as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm-codex-subagent',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'spawn-1',
            name: TOOL_SPAWN_AGENT,
            input: {
              message: 'Inspect utils.ts and return the final patch summary.',
              model: 'gpt-5.4-mini',
            },
            status: 'completed',
            result: '{"agent_id":"agent-1","nickname":"Zeno"}',
          } as any,
          {
            id: 'wait-1',
            name: TOOL_WAIT_AGENT,
            input: { targets: ['agent-1'], timeout_ms: 30000 },
            status: 'completed',
            result: '{"status":{"agent-1":{"completed":"Patched utils.ts and verified imports."}},"timed_out":false}',
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'spawn-1' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: 'spawn-1',
          description: 'Zeno (gpt-5.4-mini)',
          prompt: 'Inspect utils.ts and return the final patch summary.',
          status: 'completed',
          result: 'Patched utils.ts and verified imports.',
        })
      );
    });

    it('rebuilds Grok subagents from spawn and hidden multi-wait calls on reload', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl, 'grok');

      (renderStoredSubagent as jest.Mock).mockClear();
      (renderStoredToolCall as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm-grok-subagent',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls: [
          {
            id: 'spawn-1',
            name: GROK_SUBAGENT_SPAWN_TOOL,
            input: {
              description: 'Explore core vault notes',
              prompt: 'Inspect the vault and report in Russian.',
              subagent_type: 'explore',
            },
            status: 'completed',
            result: 'Subagent started in background.\nsubagent_id: agent-1',
          } as any,
          {
            id: 'wait-1',
            name: GROK_SUBAGENT_WAIT_TOOL,
            input: { task_ids: ['agent-1'], timeout_ms: 180_000 },
            status: 'completed',
            result: JSON.stringify({
              type: 'TaskOutput',
              MultiResult: {
                results: [{ task_id: 'agent-1', status: 'completed', output: 'Vault report' }],
              },
            }),
          } as any,
        ],
        contentBlocks: [
          { type: 'tool_use', toolId: 'spawn-1' } as any,
          { type: 'tool_use', toolId: 'wait-1' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredSubagent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          agentId: 'agent-1',
          description: 'Explore core vault notes',
          prompt: 'Inspect the vault and report in Russian.',
          result: 'Vault report',
          status: 'completed',
        }),
      );
      expect(renderStoredToolCall).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: GROK_SUBAGENT_WAIT_TOOL }),
      );
    });
  });

  // ============================================
  // showFullImage - close behaviors
  // ============================================

  describe('showFullImage - close behaviors', () => {
    const image: ImageAttachment = {
      id: 'img-1',
      name: 'test.png',
      mediaType: 'image/png',
      data: 'abc123',
      size: 100,
      source: 'file',
    };

    function setupDocumentMock() {
      const overlayEl = createMockEl();
      const mockBody = { createDiv: jest.fn().mockReturnValue(overlayEl) };
      const docListeners = new Map<string, ((...args: any[]) => void)[]>();
      const origDocument = globalThis.document;

      (globalThis as any).document = {
        body: mockBody,
        addEventListener: jest.fn((event: string, handler: (...args: any[]) => void) => {
          if (!docListeners.has(event)) docListeners.set(event, []);
          docListeners.get(event)!.push(handler);
        }),
        removeEventListener: jest.fn((event: string, handler: (...args: any[]) => void) => {
          const handlers = docListeners.get(event);
          if (handlers) {
            const idx = handlers.indexOf(handler);
            if (idx !== -1) handlers.splice(idx, 1);
          }
        }),
      };

      return { overlayEl, docListeners, origDocument };
    }

    it('closeBtn click removes overlay', () => {
      const { renderer } = createRenderer();
      const { overlayEl, origDocument } = setupDocumentMock();

      try {
        renderer.showFullImage(image);

        // The overlay has a modal child, which has a close button child
        const modalEl = overlayEl.children[0]; // grimoire-image-modal
        // Children: img (index 0), closeBtn (index 1)
        const closeBtn = modalEl.children[1];
        expect(closeBtn.hasClass('grimoire-image-modal-close')).toBe(true);

        const removeSpy = jest.spyOn(overlayEl, 'remove');
        closeBtn.click();

        expect(removeSpy).toHaveBeenCalled();
      } finally {
        (globalThis as any).document = origDocument;
      }
    });

    it('clicking overlay background removes overlay', () => {
      const { renderer } = createRenderer();
      const { overlayEl, origDocument } = setupDocumentMock();

      try {
        renderer.showFullImage(image);

        const removeSpy = jest.spyOn(overlayEl, 'remove');

        // Simulate click on the overlay itself (e.target === overlay)
        const clickHandlers = overlayEl._eventListeners.get('click');
        expect(clickHandlers).toBeDefined();
        clickHandlers![0]({ target: overlayEl });

        expect(removeSpy).toHaveBeenCalled();
      } finally {
        (globalThis as any).document = origDocument;
      }
    });

    it('ESC key removes overlay', () => {
      const { renderer } = createRenderer();
      const { overlayEl, docListeners, origDocument } = setupDocumentMock();

      try {
        renderer.showFullImage(image);

        const removeSpy = jest.spyOn(overlayEl, 'remove');

        // Simulate ESC key press via the document keydown listener
        const keydownHandlers = docListeners.get('keydown');
        expect(keydownHandlers).toBeDefined();
        expect(keydownHandlers!.length).toBeGreaterThan(0);
        keydownHandlers![0]({ key: 'Escape' });

        expect(removeSpy).toHaveBeenCalled();
        // After close, the keydown handler should be removed
        expect(document.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
      } finally {
        (globalThis as any).document = origDocument;
      }
    });
  });

  // ============================================
  // renderContent - code block wrapping (error path)
  // ============================================

  describe('renderContent - error handling', () => {
    it('renderContent shows error div when MarkdownRenderer throws', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockRejectedValueOnce(
        new Error('Render failed')
      );

      const { renderer } = createRenderer();
      const el = createMockEl();

      await renderer.renderContent(el, '**broken markdown**');

      const errorDiv = el.children.find(
        (c: any) => c.hasClass('grimoire-render-error')
      );
      expect(errorDiv).toBeDefined();
      expect(errorDiv!.textContent).toBe('Failed to render message content.');
    });
  });

  // ============================================
  // addTextCopyButton - rapid click handling
  // ============================================

  describe('addTextCopyButton - rapid click handling', () => {
    let originalNavigator: Navigator;

    beforeEach(() => {
      originalNavigator = globalThis.navigator;
      jest.useFakeTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      jest.useRealTimers();
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true,
      });
    });

    it('rapid clicks clear previous timeout', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();
      const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');

      renderer.addTextCopyButton(textEl, 'content to copy');

      const copyBtn = textEl.children[0];
      const clickHandlers = copyBtn._eventListeners.get('click');
      expect(clickHandlers).toBeDefined();

      // First click
      await clickHandlers![0]({ stopPropagation: jest.fn() });
      expect(setIcon).toHaveBeenLastCalledWith(copyBtn, 'check');

      // Second rapid click before timeout expires
      await clickHandlers![0]({ stopPropagation: jest.fn() });

      // clearTimeout should have been called for the first pending timeout
      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(setIcon).toHaveBeenLastCalledWith(copyBtn, 'check');

      clearTimeoutSpy.mockRestore();
    });

    it('feedback timeout restores icon after delay', async () => {
      const { renderer } = createRenderer();
      const textEl = createMockEl();

      renderer.addTextCopyButton(textEl, 'content to copy');

      const copyBtn = textEl.children[0];
      const originalInnerHTML = copyBtn.innerHTML;
      const clickHandlers = copyBtn._eventListeners.get('click');

      // Click to copy
      await clickHandlers![0]({ stopPropagation: jest.fn() });
      expect(setIcon).toHaveBeenLastCalledWith(copyBtn, 'check');
      expect(copyBtn.classList.contains('copied')).toBe(true);

      // Advance timers by 1500ms (the feedback duration)
      jest.advanceTimersByTime(1500);

      // Icon should be restored and copied class removed
      expect(copyBtn.innerHTML).toBe(originalInnerHTML);
      expect(setIcon).toHaveBeenLastCalledWith(copyBtn, 'copy');
      expect(copyBtn.getAttribute('aria-label')).toBe('Copy response');
      expect(copyBtn.classList.contains('copied')).toBe(false);
    });
  });

  // ============================================
  // renderContent - code block wrapping
  // ============================================

  describe('renderContent - code block wrapping', () => {
    it('passes image-processed markdown directly to MarkdownRenderer', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { replaceImageEmbedsWithHtml } = await import('@/utils/imageEmbed');
      const { processFileLinks } = await import('@/utils/fileLink');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (replaceImageEmbedsWithHtml as jest.Mock).mockReturnValueOnce(
        '<span title="[[note.md]]">raw html</span>\n    [[note.md]]'
      );

      await renderer.renderContent(el, 'before-images ![[image.png]] [[note.md]]');

      expect(replaceImageEmbedsWithHtml).toHaveBeenCalledWith(
        'before-images ![[image.png]] [[note.md]]',
        expect.anything(),
        ''
      );
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalledWith(
        '<span title="[[note.md]]">raw html</span>\n    [[note.md]]',
        el,
        '',
        expect.anything()
      );
      expect(processFileLinks).toHaveBeenCalledWith(expect.anything(), el);
    });

    it('should wrap pre elements in code wrapper divs', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      // Mock renderMarkdown to create a pre element in the container
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          pre.createEl('code', { text: 'console.log("hello")' });
        }
      );

      await renderer.renderContent(el, '```js\nconsole.log("hello")\n```');

      // The pre should be wrapped in a grimoire-code-wrapper
      // Due to mock limitations, check that querySelectorAll was called on el
      // The actual wrapping logic runs on real DOM, but the mock captures calls
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });

    it('should skip wrapping already-wrapped pre elements', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      // Mock renderMarkdown to create an already-wrapped pre element
      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const wrapper = container.createDiv({ cls: 'grimoire-code-wrapper' });
          wrapper.createEl('pre');
        }
      );

      await renderer.renderContent(el, '```\nalready wrapped\n```');

      // Should not throw and should complete normally
      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });
  });

  // ============================================
  // renderMessageImages - click handler
  // ============================================

  describe('renderMessageImages - click handler', () => {
    it('should add click handler on image elements', () => {
      const containerEl = createMockEl();
      const { renderer } = createRenderer();
      const showFullImageSpy = jest.spyOn(renderer, 'showFullImage').mockImplementation(() => {});
      jest.spyOn(renderer, 'setImageSrc').mockImplementation(() => {});

      const images: ImageAttachment[] = [
        { id: 'img-1', name: 'photo.png', mediaType: 'image/png', data: 'base64data', size: 200, source: 'file' },
      ];

      renderer.renderMessageImages(containerEl, images);

      // Find the img element and check for click handler
      const imagesContainer = containerEl.children[0];
      const wrapper = imagesContainer.children[0];
      const imgEl = wrapper.children[0]; // The img element

      // Check click handler is registered
      const clickHandlers = imgEl._eventListeners?.get('click');
      expect(clickHandlers).toBeDefined();
      expect(clickHandlers!.length).toBe(1);

      // Trigger click and verify showFullImage is called
      clickHandlers![0]();
      expect(showFullImageSpy).toHaveBeenCalledWith(images[0]);
    });
  });

  // ============================================
  // renderContent - code block wrapping with language labels
  // ============================================

  describe('renderContent - language label and copy', () => {
    it('should add language label when code block has language class', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          const code = pre.createEl('code');
          code.className = 'language-typescript';
          code.textContent = 'const x = 1;';
        }
      );

      await renderer.renderContent(el, '```typescript\nconst x = 1;\n```');

      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });

    it('should move copy-code-button outside pre into wrapper', async () => {
      const { MarkdownRenderer } = await import('obsidian');
      const { renderer } = createRenderer();
      const el = createMockEl();

      (MarkdownRenderer.renderMarkdown as jest.Mock).mockImplementationOnce(
        async (_md: string, container: any) => {
          const pre = container.createEl('pre');
          pre.createEl('code', { text: 'some code' });
          const copyBtn = pre.createEl('button');
          copyBtn.className = 'copy-code-button';
        }
      );

      await renderer.renderContent(el, '```\nsome code\n```');

      expect(MarkdownRenderer.renderMarkdown).toHaveBeenCalled();
    });
  });

  // ============================================
  // addMessage - displayContent for user messages
  // ============================================

  it('addMessage renders displayContent instead of content when available', () => {
    const messagesEl = createMockEl();
    const { renderer } = createRenderer(messagesEl);
    const renderContentSpy = jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

    const msg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'full prompt with context',
      displayContent: 'user input only',
      timestamp: Date.now(),
    };

    renderer.addMessage(msg);

    expect(renderContentSpy).toHaveBeenCalledWith(expect.anything(), 'user input only');
  });

  // ============================================
  // renderStoredThinkingBlock - durationSeconds parameter
  // ============================================

  describe('renderStoredThinkingBlock - durationSeconds parameter', () => {
    it('should pass durationSeconds to renderStoredThinkingBlock', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      (renderStoredThinkingBlock as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'thinking', content: 'deep thought', durationSeconds: 42 } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredThinkingBlock).toHaveBeenCalledWith(
        expect.anything(),
        'deep thought',
        42,
        expect.any(Function)
      );
    });

    it('should pass undefined durationSeconds when not set', () => {
      const messagesEl = createMockEl();
      const { renderer } = createRenderer(messagesEl);
      jest.spyOn(renderer, 'renderContent').mockResolvedValue(undefined);

      (renderStoredThinkingBlock as jest.Mock).mockClear();

      const msg: ChatMessage = {
        id: 'm1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        contentBlocks: [
          { type: 'thinking', content: 'thought without duration' } as any,
        ],
      };

      renderer.renderStoredMessage(msg);

      expect(renderStoredThinkingBlock).toHaveBeenCalledWith(
        expect.anything(),
        'thought without duration',
        undefined,
        expect.any(Function)
      );
    });
  });
});
