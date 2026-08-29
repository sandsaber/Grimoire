import {
  normalizeAntigravityToolInput,
  normalizeAntigravityToolName,
} from '@/providers/antigravity/normalization/antigravityToolNormalization';

describe('antigravityToolNormalization', () => {
  it('maps agy tool names onto the neutral ones the chat renders', () => {
    expect(normalizeAntigravityToolName('run_command')).toBe('Bash');
    expect(normalizeAntigravityToolName('view_file')).toBe('Read');
    expect(normalizeAntigravityToolName('write_to_file')).toBe('Write');
    expect(normalizeAntigravityToolName('replace_file_content')).toBe('Edit');
    expect(normalizeAntigravityToolName('grep_search')).toBe('Grep');
  });

  it('leaves a tool it does not know under its own name', () => {
    expect(normalizeAntigravityToolName('manage_task')).toBe('manage_task');
  });

  it('adds the neutral argument key beside the name agy used', () => {
    // Keeping the native key is what lets a card be lined up against agy's own
    // logs; the neutral key is what the shared renderer reads.
    expect(normalizeAntigravityToolInput('run_command', { CommandLine: 'npm run build' }))
      .toEqual({ CommandLine: 'npm run build', command: 'npm run build' });
    expect(normalizeAntigravityToolInput('view_file', { AbsolutePath: '/repo/src/main.ts' }))
      .toEqual({ AbsolutePath: '/repo/src/main.ts', file_path: '/repo/src/main.ts' });
  });

  it('maps the search needle onto pattern rather than query', () => {
    expect(normalizeAntigravityToolInput('grep_search', { Query: 'TODO', SearchPath: '/repo' }))
      .toEqual({ Query: 'TODO', SearchPath: '/repo', path: '/repo', pattern: 'TODO' });
  });

  it('translates arguments even for a tool it does not map', () => {
    expect(normalizeAntigravityToolInput('some_future_tool', { TargetFile: '/repo/a.md' }))
      .toEqual({ TargetFile: '/repo/a.md', file_path: '/repo/a.md' });
  });

  it('never overwrites a neutral key the tool already supplied', () => {
    expect(normalizeAntigravityToolInput('run_command', {
      CommandLine: 'from-pascal',
      command: 'from-neutral',
    })).toEqual({ CommandLine: 'from-pascal', command: 'from-neutral' });
  });

  it('passes an unrecognised argument through untouched', () => {
    expect(normalizeAntigravityToolInput('run_command', { Blocking: true }))
      .toEqual({ Blocking: true });
  });
});
