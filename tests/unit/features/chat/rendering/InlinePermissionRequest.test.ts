import { createMockEl } from '@test/helpers/mockElement';
import { setIcon } from 'obsidian';

import {
  buildPermissionCommandSummary,
  InlinePermissionRequest,
  type InlinePermissionRequestConfig,
} from '@/features/chat/rendering/InlinePermissionRequest';

const renderedRequests: InlinePermissionRequest[] = [];

function renderPermissionRequest(
  parentEl: HTMLElement,
  config: InlinePermissionRequestConfig,
): InlinePermissionRequest {
  const request = new InlinePermissionRequest(parentEl, config);
  renderedRequests.push(request);
  request.render();
  return request;
}

describe('InlinePermissionRequest', () => {
  afterEach(() => {
    for (const request of renderedRequests.splice(0)) {
      request.destroy();
    }
    jest.restoreAllMocks();
  });

  it('renders shuffled decisions in semantic order with one shortcut per keyboard action', () => {
    const parentEl = createMockEl();
    renderPermissionRequest(parentEl, {
      toolName: 'Find TODO/FIXME in vault',
      input: {},
      description: 'Find TODO/FIXME in vault requests permission.',
      decisionOptions: [
        { decision: 'deny', label: 'Deny', value: 'deny' },
        { decision: 'allow-always', label: 'Always allow for user', value: 'user' },
        { decision: 'allow', label: 'Allow once', value: 'allow' },
        { decision: 'allow-always', label: 'Always allow in project', value: 'project' },
        { decision: 'allow', label: 'Allow this time too', value: 'second-allow' },
        { decision: 'deny', label: 'Reject again', value: 'second-reject' },
      ],
      resolve: jest.fn(),
    });

    expect(parentEl.querySelector('.grimoire-permission-button--allow')).not.toBeNull();
    expect(parentEl.querySelector('.grimoire-permission-button--reject')).not.toBeNull();
    expect(parentEl.querySelectorAll('.grimoire-permission-button')).toHaveLength(6);
    expect(parentEl.querySelector('.grimoire-permission-button--project')).toBeNull();
    expect(parentEl.querySelector('.grimoire-permission-button--user')).toBeNull();
    /*
     * Numbered choices with `esc` on one of them, the way screen 2d draws it.
     * Every rejecting row used to be drawn `esc`, so a card offering two ways
     * to say no showed the same key twice and `Escape` could only ever reach
     * the first — the second was unreachable from the keyboard entirely.
     */
    expect(parentEl.querySelectorAll('.grimoire-permission-button-key').map(
      (el: { textContent: string }) => el.textContent,
    ))
      .toEqual(['1', '2', '3', '4', 'esc', '5']);
    expect(parentEl.querySelectorAll('.grimoire-permission-button-label').map(
      (el: { textContent: string }) => el.textContent,
    )).toEqual([
      'Allow once',
      'Allow this time too',
      'Always allow for user',
      'Always allow in project',
      'Reject',
      'Reject again',
    ]);
    // No per-row glyph: an accent check on "allow" made the safe answer the
    // loudest thing on a card about caution.
    expect(parentEl.querySelector('.grimoire-permission-button-icon')).toBeNull();
    expect(parentEl.querySelector('.grimoire-permission-description')).toBeNull();
    expect(parentEl.querySelector('.grimoire-permission-body')).toBeNull();
  });

  it('keeps substantive permission descriptions visible', () => {
    const parentEl = createMockEl();
    renderPermissionRequest(parentEl, {
      toolName: 'Find TODO/FIXME in vault',
      input: {},
      description: 'Find TODO/FIXME in vault requests permission because this scans every note.',
      decisionOptions: [{ decision: 'allow', label: 'Allow once', value: 'allow' }],
      resolve: jest.fn(),
    });

    expect(parentEl.querySelector('.grimoire-permission-description')?.textContent)
      .toBe('Find TODO/FIXME in vault requests permission because this scans every note.');
  });

  it('shows a full URL target without truncating the fetch request label in the DOM', () => {
    const parentEl = createMockEl();
    const url = 'https://example.com/api/content/collections/grimoire/permissions?revision=2026-08-04';
    renderPermissionRequest(parentEl, {
      toolName: `Fetching content from ${url}`,
      input: { url },
      description: 'Fetching remote content requires permission.',
      decisionOptions: [{ decision: 'allow', label: 'Allow once', value: 'allow' }],
      resolve: jest.fn(),
    });

    expect(parentEl.querySelector('.grimoire-permission-tool-label')?.textContent)
      .toBe(`Fetching content from ${url}`);
    expect(parentEl.querySelector('.grimoire-permission-target')?.textContent).toBe(url);
  });

  it('keeps an exact path visible independently from the compact tool pill', () => {
    const parentEl = createMockEl();
    const path = '/Users/example/Vault/Research/Geography and Exploration/notes.md';
    renderPermissionRequest(parentEl, {
      toolName: 'Reading a note outside the current context',
      input: { filepath: path },
      description: 'Reading this note requires permission.',
      decisionOptions: [{ decision: 'allow', label: 'Allow once', value: 'allow' }],
      resolve: jest.fn(),
    });

    expect(parentEl.querySelector('.grimoire-permission-tool-label')?.textContent)
      .toBe('Reading a note outside the current context');
    expect(parentEl.querySelector('.grimoire-permission-target')?.textContent).toBe(path);
  });

  it('renders an explicit provider target when the path is absent from raw input', () => {
    const parentEl = createMockEl();
    const target = '/Users/example/Vault/Notes/from-location.md';
    renderPermissionRequest(parentEl, {
      toolName: 'Edit file',
      input: {},
      description: `${target} requires permission.`,
      target,
      decisionOptions: [{ decision: 'allow', label: 'Allow once', value: 'allow' }],
      resolve: jest.fn(),
    });

    expect(parentEl.querySelector('.grimoire-permission-target')?.textContent).toBe(target);
  });

  it('does not duplicate blocked paths or present search text as a resource target', () => {
    const parentEl = createMockEl();
    const blockedPath = '/tmp/outside';
    renderPermissionRequest(parentEl, {
      toolName: 'External Directory',
      input: { filepath: blockedPath, query: 'TODO/FIXME', pattern: '*.md' },
      description: 'OpenCode wants to access a path outside the working directory.',
      blockedPath,
      target: blockedPath,
      decisionOptions: [{ decision: 'allow', label: 'Allow once', value: 'allow' }],
      resolve: jest.fn(),
    });

    expect(parentEl.querySelector('.grimoire-permission-blocked-path')?.textContent)
      .toBe(blockedPath);
    expect(parentEl.querySelector('.grimoire-permission-target')).toBeNull();
  });

  it('hides an exact duplicate for a long untruncated tool name', () => {
    const parentEl = createMockEl();
    const toolName = 'An unknown provider tool with a very long generated display label';
    renderPermissionRequest(parentEl, {
      toolName,
      input: {},
      description: `${toolName} requests permission.`,
      decisionOptions: [{ decision: 'allow', label: 'Allow once', value: 'allow' }],
      resolve: jest.fn(),
    });

    expect(parentEl.querySelector('.grimoire-permission-tool-label')?.textContent).toBe(toolName);
    expect(parentEl.querySelector('.grimoire-permission-description')).toBeNull();
    expect(parentEl.querySelector('.grimoire-permission-body')).toBeNull();
  });

  it('resolves Enter and Escape to their exact option values', () => {
    const allowParentEl = createMockEl();
    const allowResolve = jest.fn();
    renderPermissionRequest(allowParentEl, {
      toolName: 'Read',
      input: {},
      description: 'Read requests permission.',
      decisionOptions: [{ decision: 'allow', label: 'Allow once', value: 'exact-allow-value' }],
      resolve: allowResolve,
    });
    const enterEvent = {
      type: 'keydown',
      key: 'Enter',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };
    allowParentEl.querySelector('.grimoire-permission-anchor')?.ownerDocument.dispatchEvent(enterEvent);

    expect(allowResolve).toHaveBeenCalledWith('exact-allow-value');
    expect(enterEvent.preventDefault).toHaveBeenCalledTimes(1);

    const rejectParentEl = createMockEl();
    const rejectResolve = jest.fn();
    renderPermissionRequest(rejectParentEl, {
      toolName: 'Read',
      input: {},
      description: 'Read requests permission.',
      decisionOptions: [{ decision: 'deny', label: 'Deny', value: 'exact-reject-value' }],
      resolve: rejectResolve,
    });
    const escapeEvent = {
      type: 'keydown',
      key: 'Escape',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };
    rejectParentEl.querySelector('.grimoire-permission-anchor')?.ownerDocument.dispatchEvent(escapeEvent);

    expect(rejectResolve).toHaveBeenCalledWith('exact-reject-value');
    expect(escapeEvent.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('does not present provider policy amendments as one-time approval', () => {
    const parentEl = createMockEl();
    const resolve = jest.fn();
    renderPermissionRequest(parentEl, {
      toolName: 'Bash',
      input: { command: 'npm test' },
      description: 'Execute: npm test',
      decisionOptions: [
        {
          label: 'Allow similar commands',
          description: 'Approve and store an exec policy amendment.',
          value: 'exec-policy-amendment',
          presentation: 'other',
        },
        { decision: 'allow', label: 'Allow once', value: 'allow-once', presentation: 'allow' },
        { decision: 'deny', label: 'Deny', value: 'deny', presentation: 'reject' },
      ],
      resolve,
    });

    const buttons = parentEl.querySelectorAll('.grimoire-permission-button');
    expect(buttons.map((button: HTMLElement) => button.querySelector(
      '.grimoire-permission-button-label',
    )?.textContent)).toEqual(['Allow once', 'Allow similar commands', 'Reject']);
    expect(buttons[1]?.classList.contains('grimoire-permission-button--other')).toBe(true);
    expect(buttons[1]?.querySelector('.grimoire-permission-button-shortcut')).toBeNull();

    const enterEvent = {
      type: 'keydown',
      key: 'Enter',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };
    parentEl.querySelector('.grimoire-permission-anchor')?.ownerDocument.dispatchEvent(enterEvent);

    expect(resolve).toHaveBeenCalledWith('allow-once');
  });

  it('focuses the dialog card instead of its anchor', () => {
    const parentEl = createMockEl();
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    let onFrame: FrameRequestCallback | undefined;
    window.requestAnimationFrame = callback => {
      onFrame = callback;
      return 1;
    };

    try {
      renderPermissionRequest(parentEl, {
        toolName: 'Read',
        input: {},
        description: 'Read requests permission.',
        decisionOptions: [{ decision: 'allow', label: 'Allow once', value: 'allow' }],
        resolve: jest.fn(),
      });
      const dialog = parentEl.querySelector('.grimoire-permission-request');
      const anchor = parentEl.querySelector('.grimoire-permission-anchor');
      const dialogFocus = jest.spyOn(dialog, 'focus');
      const anchorFocus = jest.spyOn(anchor, 'focus');
      onFrame?.(0);

      expect(dialog?.getAttribute('tabindex')).toBe('-1');
      expect(dialogFocus).toHaveBeenCalledTimes(1);
      expect(anchorFocus).not.toHaveBeenCalled();
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });

  it('renders the branded header while keeping a command preview in the body', () => {
    const parentEl = createMockEl();
    const resolve = jest.fn();
    const command = 'python3 .grimoire/generate_data.py 2>&1 | tail -5 && wc -l vault-data.js';
    renderPermissionRequest(parentEl, {
      toolName: `Execute \`${command}\``,
      input: { command },
      description: `Execute: ${command}`,
      decisionOptions: [{ decision: 'allow', label: 'Allow once', value: 'allow' }],
      resolve,
    });

    expect(parentEl.querySelector('.grimoire-permission-tool-label')?.textContent)
      .toBe('python3 · generate_data.py');
    expect(parentEl.querySelector('.grimoire-permission-subtitle')?.textContent)
      .toBe('Grimoire wants to run a shell command');
    expect(parentEl.querySelector('.grimoire-permission-command-code')?.textContent).toBe(command);
    expect(parentEl.querySelector('.grimoire-permission-description')).toBeNull();
    expect(parentEl.querySelector('.grimoire-permission-shield')).not.toBeNull();
    expect(parentEl.querySelector('.grimoire-permission-tool')).not.toBeNull();
    expect(parentEl.querySelector('.grimoire-permission-tool')?.getAttribute('title')).toBe(command);
    expect(parentEl.querySelector('.grimoire-permission-tool')?.getAttribute('aria-label'))
      .toBe('Command preview: python3 .grimoire/generate_data.py 2>&1 | tail -5 && wc -l vault-data.js');
    const dialog = parentEl.querySelector('.grimoire-permission-request');
    const title = parentEl.querySelector('.grimoire-permission-title');
    expect(dialog?.getAttribute('aria-label')).toBeNull();
    expect(dialog?.getAttribute('aria-labelledby')).toBe(title?.getAttribute('id'));
    parentEl.querySelector('.grimoire-permission-button--allow')?.click();
    expect(resolve).toHaveBeenCalledWith('allow');
  });

  it('summarizes long path lists by their meaningful final segments', () => {
    const command = [
      'ls /Users/test/ExampleVault/Climate',
      '/Users/test/ExampleVault/Phenomena',
      '/Users/test/ExampleVault/Threats',
    ].join('\n');

    expect(buildPermissionCommandSummary(command)).toBe('ls · Climate, Phenomena +1');

    const parentEl = createMockEl();
    renderPermissionRequest(parentEl, {
      toolName: 'Ls /users/test/example-vault…',
      input: { command },
      description: `OpenCode wants permission to use ${command}.`,
      decisionOptions: [{ decision: 'allow', label: 'Allow once', value: 'allow' }],
      resolve: jest.fn(),
    });
    expect(parentEl.querySelector('.grimoire-permission-tool-label')?.textContent)
      .toBe('ls · Climate, Phenomena +1');
    expect(parentEl.querySelector('.grimoire-permission-tool')?.getAttribute('title')).toBe(command);
    expect(parentEl.querySelector('.grimoire-permission-subtitle')?.textContent)
      .toBe('Grimoire wants to run a shell command');
    expect(parentEl.querySelector('.grimoire-permission-description')?.textContent)
      .toBe('OpenCode requested permission to run this command.');
  });

  it('summarizes find predicates instead of counting their option values', () => {
    const command = [
      "find . -maxdepth 3 -type d ! -path './.git*' ! -path './.obsidian*' 2>/dev/null | head -80;",
      "echo '---'; find . -name '*.md' ! -path './.git/*' ! -path './Climate/*' | head -100;",
      "echo '---COUNT---'; find . -name '*.md' ! -path './.git/*' | wc -l",
    ].join(' ');

    expect(buildPermissionCommandSummary(command)).toBe('find · *.md');
  });

  it('keeps full unknown tool labels available for wrapping in the header', () => {
    const parentEl = createMockEl();
    const request = new InlinePermissionRequest(parentEl, {
      toolName: 'An unknown provider tool with a very long generated display label',
      input: {},
      description: 'Permission requested.',
      decisionOptions: [{ decision: 'deny', label: 'Deny', value: 'deny' }],
      resolve: jest.fn(),
    });

    request.render();

    const label = parentEl.querySelector('.grimoire-permission-tool-label')?.textContent ?? '';
    expect(label).toBe('An unknown provider tool with a very long generated display label');
    request.destroy();
  });

  it('does not shorten descriptive permission tool names', () => {
    const parentEl = createMockEl();
    renderPermissionRequest(parentEl, {
      toolName: 'Explore Obsidian vault structure',
      input: {},
      description: 'Explore Obsidian vault structure requests permission.',
      decisionOptions: [{ decision: 'allow', label: 'Allow', value: 'allow' }],
      resolve: jest.fn(),
    });

    expect(parentEl.querySelector('.grimoire-permission-tool-label')?.textContent)
      .toBe('Explore Obsidian vault structure');
    expect(parentEl.querySelector('.grimoire-permission-subtitle')?.textContent)
      .toBe('Grimoire wants to use Explore Obsidian vault structure');
  });

  it('uses a neutral persistent icon when scope is localized or unknown', () => {
    jest.clearAllMocks();
    const parentEl = createMockEl();
    renderPermissionRequest(parentEl, {
      toolName: 'Read',
      input: {},
      description: 'Read requests permission.',
      decisionOptions: [
        { decision: 'allow-always', label: 'Всегда разрешать для проекта', value: 'localized' },
        { decision: 'allow-always', label: 'Always allow', value: 'unknown' },
      ],
      resolve: jest.fn(),
    });

    expect(setIcon).toHaveBeenCalledWith(expect.anything(), 'shield-check');
    expect(setIcon).not.toHaveBeenCalledWith(expect.anything(), 'folder-check');
    expect(setIcon).not.toHaveBeenCalledWith(expect.anything(), 'user-check');
  });

  /*
   * The card drew `1` and `2` and listened for `Enter` and `a`, so the keys it
   * advertised did nothing at all: pressing 1 or 2 on a permission request was
   * a no-op, and only `esc` — the one key both halves happened to agree on —
   * did anything.
   */
  it('answers with the number it draws', () => {
    const parentEl = createMockEl();
    const resolve = jest.fn();
    renderPermissionRequest(parentEl, {
      toolName: 'Bash',
      input: {},
      description: 'Bash requests permission.',
      decisionOptions: [
        { decision: 'allow', label: 'Yes, proceed', value: 'once' },
        { decision: 'allow-always', label: 'Yes, and stop asking', value: 'always' },
        { decision: 'deny', label: 'No', value: 'no' },
      ],
      resolve,
    });

    parentEl.querySelector('.grimoire-permission-anchor')?.ownerDocument.dispatchEvent({
      key: '2', type: 'keydown', preventDefault: jest.fn(), stopPropagation: jest.fn(),
    });

    expect(resolve).toHaveBeenCalledWith('always');
  });

  it('gives Escape the row it drew esc on', () => {
    const parentEl = createMockEl();
    const resolve = jest.fn();
    renderPermissionRequest(parentEl, {
      toolName: 'Bash',
      input: {},
      description: 'Bash requests permission.',
      decisionOptions: [
        { decision: 'allow', label: 'Yes, proceed', value: 'once' },
        { decision: 'deny', label: 'No', value: 'no' },
        { decision: 'deny', label: 'No, and stop asking', value: 'no-always' },
      ],
      resolve,
    });

    parentEl.querySelector('.grimoire-permission-anchor')?.ownerDocument.dispatchEvent({
      key: 'Escape', type: 'keydown', preventDefault: jest.fn(), stopPropagation: jest.fn(),
    });

    expect(resolve).toHaveBeenCalledWith('no');
  });
});
