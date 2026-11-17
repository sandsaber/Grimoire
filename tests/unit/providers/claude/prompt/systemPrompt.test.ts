jest.mock('@/utils/date', () => ({
  getTodayDate: () => 'Mocked Date',
}));

import { getInlineEditSystemPrompt } from '@/core/prompt/inlineEdit';
import {
  buildSystemPrompt,
  computeSystemPromptKey,
} from '@/core/prompt/mainAgent';

describe('systemPrompt', () => {
  describe('buildSystemPrompt', () => {
    it('should append custom prompt section when provided', () => {
      const prompt = buildSystemPrompt({ customPrompt: 'Always be concise.' });
      expect(prompt).toContain('# Custom Instructions');
      expect(prompt).toContain('Always be concise.');
    });

    it('should not append custom prompt section when empty', () => {
      const prompt = buildSystemPrompt({ customPrompt: '   ' });
      expect(prompt).not.toContain('# Custom Instructions');
    });

    it('should not append custom prompt section when undefined', () => {
      const prompt = buildSystemPrompt({});
      expect(prompt).not.toContain('# Custom Instructions');
    });

    it('should include base system prompt elements', () => {
      const prompt = buildSystemPrompt();
      expect(prompt).toContain('active AI agent operating through Grimoire');
      expect(prompt).toContain(
        'Follow project instructions already supplied by the active provider through its native instruction mechanism. Do not reload or duplicate them.',
      );
      expect(prompt).toContain('## Workspace and Paths');
      expect(prompt).toContain('## Turn Context');
      expect(prompt).toContain('the default target for edit, rewrite, update, or apply-instructions requests');
      expect(prompt).toContain('Every folder listed in `<excluded_folders>` and all descendants are unavailable');
      expect(prompt).toContain('an explicit `@path` in the current query');
      expect(prompt).toContain('Do not extend an override to siblings or parents.');
      expect(prompt).toContain('verify it using an available runtime capability rather than guessing');
    });

    it('should document the complete Grimoire turn context contract', () => {
      const prompt = buildSystemPrompt();

      for (const tag of [
        'current_note',
        'editor_selection',
        'editor_cursor',
        'context_files',
        'browser_selection',
        'canvas_selection',
        'vault_search',
        'project_workspace',
        'excluded_folders',
      ]) {
        expect(prompt).toContain(`<${tag}>`);
      }
    });

    it('should remain provider-neutral and avoid duplicated legacy sections', () => {
      const prompt = buildSystemPrompt();

      expect(prompt).not.toContain('bash: date');
      expect(prompt).not.toContain('Read file_path=');
      expect(prompt).not.toContain('WebFetch');
      expect(prompt).not.toContain('curl');
      expect(prompt).not.toContain('## Tool Usage Guidelines');
      expect(prompt).not.toContain('### WebSearch');
      expect(prompt).not.toContain('### Agent (Subagents)');
      expect(prompt).not.toContain('### TodoWrite');
      expect(prompt).not.toContain('### Skills');
      expect(prompt).not.toContain('## Selection Context');
      expect(prompt).not.toContain('## User Message Format');
      expect(prompt.length).toBeLessThan(6_000);
    });

  });

  describe('userName in system prompt', () => {
    it('should include user context when userName is provided', () => {
      const prompt = buildSystemPrompt({ userName: 'Alice' });
      expect(prompt).toContain('You are collaborating with **Alice**.');
    });

    it('should not include user context when userName is empty', () => {
      const prompt = buildSystemPrompt({ userName: '' });
      expect(prompt).not.toContain('You are collaborating with **');
    });

    it('should not include user context when userName is whitespace only', () => {
      const prompt = buildSystemPrompt({ userName: '   ' });
      expect(prompt).not.toContain('You are collaborating with **');
    });

    it('should not include user context when userName is undefined', () => {
      const prompt = buildSystemPrompt({});
      expect(prompt).not.toContain('You are collaborating with **');
    });

    it('should trim whitespace from userName', () => {
      const prompt = buildSystemPrompt({ userName: '  Bob  ' });
      expect(prompt).toContain('You are collaborating with **Bob**.');
      expect(prompt).not.toContain('**  Bob  **');
    });
  });

  describe('media folder instructions', () => {
    it('should use vault root path when mediaFolder is empty', () => {
      const prompt = buildSystemPrompt({ mediaFolder: '' });
      expect(prompt).toContain('configured vault media folder `.`');
    });

    it('should use vault root path when mediaFolder is whitespace only', () => {
      const prompt = buildSystemPrompt({ mediaFolder: '   ' });
      expect(prompt).toContain('configured vault media folder `.`');
    });

    it('should use custom mediaFolder path when provided', () => {
      const prompt = buildSystemPrompt({ mediaFolder: 'attachments' });
      expect(prompt).toContain('configured vault media folder `attachments`');
    });

    it('should handle mediaFolder with special characters', () => {
      const prompt = buildSystemPrompt({ mediaFolder: '- attachments' });
      expect(prompt).toContain('configured vault media folder `- attachments`');
    });

    it('should keep external image handling non-mutating by default', () => {
      const prompt = buildSystemPrompt({ mediaFolder: 'media' });
      expect(prompt).toContain(
        'Do not download, persist, or rewrite external images unless the user asks.',
      );
      expect(prompt).not.toContain('WebFetch');
      expect(prompt).not.toContain('curl');
    });
  });

  describe('getInlineEditSystemPrompt', () => {
    it('should include inline edit critical output rules', () => {
      const prompt = getInlineEditSystemPrompt();
      expect(prompt).toContain('ABSOLUTE RULE');
      expect(prompt).toContain('<replacement>');
    });

    it('should include read-only tool descriptions', () => {
      const prompt = getInlineEditSystemPrompt();
      expect(prompt).toContain('Read, Grep, Glob, LS, WebSearch, WebFetch');
      expect(prompt).toContain('read-only');
    });

    it('should include example scenarios', () => {
      const prompt = getInlineEditSystemPrompt();
      expect(prompt).toContain('translate to French');
      expect(prompt).toContain('Bonjour le monde');
      expect(prompt).toContain('asking for clarification');
    });

    it('should include date from utils', () => {
      const prompt = getInlineEditSystemPrompt();
      expect(prompt).toContain('Mocked Date');
    });

  });

  describe('computeSystemPromptKey', () => {
    it('computes key from all settings', () => {
      const settings = {
        mediaFolder: 'attachments',
        customPrompt: 'Be helpful',
        vaultPath: '/vault',
        userName: 'Alice',
      };

      const key = computeSystemPromptKey(settings);

      expect(key).toBe('main-agent-v3::attachments::Be helpful::/vault::Alice');
    });

    it('handles empty or undefined values', () => {
      const key = computeSystemPromptKey({
        mediaFolder: '',
        customPrompt: '',
        vaultPath: '',
        userName: '',
      });

      expect(key).toBe('main-agent-v3::::::::');
    });
  });
});
