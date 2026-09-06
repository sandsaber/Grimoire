import {
  DebugLogService,
  GRIMOIRE_DEBUG_LOGS_PATH,
  sanitizeDebugLogData,
} from '@/core/debug/DebugLogService';

class FakeVaultFileAdapter {
  files = new Map<string, string>();
  folders = new Set<string>();

  exists = jest.fn(async (path: string) => this.files.has(path) || this.folders.has(path));
  read = jest.fn(async (path: string) => this.files.get(path) ?? '');
  write = jest.fn(async (path: string, content: string) => {
    this.files.set(path, content);
  });
  append = jest.fn(async (path: string, content: string) => {
    this.files.set(path, `${this.files.get(path) ?? ''}${content}`);
  });
  ensureFolder = jest.fn(async (path: string) => {
    this.folders.add(path);
  });
}

describe('DebugLogService', () => {
  const now = () => new Date('2026-06-07T12:34:56.789Z');

  it('does not create folders or files while debug logging is disabled', async () => {
    const adapter = new FakeVaultFileAdapter();
    const logger = new DebugLogService(adapter as never, () => false, { now });

    await logger.write({
      data: { providerId: 'codex' },
      event: 'refresh.started',
      scope: 'usage',
    });

    expect(adapter.ensureFolder).not.toHaveBeenCalled();
    expect(adapter.append).not.toHaveBeenCalled();
    expect(adapter.files.size).toBe(0);
  });

  it('writes JSONL events to the local daily log when enabled', async () => {
    const adapter = new FakeVaultFileAdapter();
    const logger = new DebugLogService(adapter as never, () => true, { now });

    await logger.write({
      data: { providerId: 'codex', windowCount: 2 },
      event: 'refresh.succeeded',
      level: 'info',
      scope: 'usage',
    });

    const path = `${GRIMOIRE_DEBUG_LOGS_PATH}/2026-06-07.jsonl`;
    expect(adapter.ensureFolder).toHaveBeenCalledWith(GRIMOIRE_DEBUG_LOGS_PATH);
    expect(adapter.append).toHaveBeenCalledTimes(1);
    expect(adapter.append).toHaveBeenCalledWith(path, expect.stringContaining('"event":"refresh.succeeded"'));

    const line = adapter.files.get(path)?.trim();
    expect(line).toBeTruthy();
    expect(JSON.parse(line ?? '{}')).toMatchObject({
      data: { providerId: 'codex', windowCount: 2 },
      event: 'refresh.succeeded',
      level: 'info',
      scope: 'usage',
      ts: '2026-06-07T12:34:56.789Z',
    });
  });

  it('redacts sensitive values before writing', async () => {
    const adapter = new FakeVaultFileAdapter();
    const logger = new DebugLogService(adapter as never, () => true, { now });

    await logger.write({
      data: {
        apiKey: 'sk-secret',
        filePath: '/Users/example/Vault/Private.md',
        prompt: 'tell me the private note',
        providerId: 'codex',
        responseText: 'private answer',
        usage: { pct: 13, label: '5-hr' },
      },
      event: 'send.started',
      scope: 'chat',
    });

    const path = `${GRIMOIRE_DEBUG_LOGS_PATH}/2026-06-07.jsonl`;
    const line = adapter.files.get(path)?.trim() ?? '';
    expect(line).toContain('"providerId":"codex"');
    expect(line).toContain('"pct":13');
    expect(line).not.toContain('sk-secret');
    expect(line).not.toContain('Private.md');
    expect(line).not.toContain('private note');
    expect(line).not.toContain('private answer');
  });
});

describe('sanitizeDebugLogData', () => {
  it('redacts a home directory on every platform it can run on', () => {
    expect(sanitizeDebugLogData({
      stderrPreview: [
        'ENOENT /home/michael/Vaults/notes/.grimoire/grok/system.md',
        '/Users/michael/Vaults/notes/main.js',
        '/root/.config/grok/auth.json',
        'C:\\Users\\michael\\Vaults\\notes',
      ].join(' '),
    })).toEqual({
      // The error word survives; the paths do not. A log that redacts the
      // message as well as the path is a log nobody can debug from.
      stderrPreview: 'ENOENT [redacted-path] [redacted-path] [redacted-path] [redacted-path]',
    });
  });

  it('keeps safe metadata while redacting content-like fields', () => {
    expect(sanitizeDebugLogData({
      method: 'account/rateLimits/read',
      messageType: 'rate_limit_event',
      model: 'gpt-5.5',
      rateLimitInfoFields: 'rateLimitType,resetsAt,status,utilization',
      rateLimitType: 'five_hour',
      requestBody: { input: 'hidden' },
      windows: [{ label: 'Weekly', pct: 61, reset: 'Mon' }],
    })).toEqual({
      method: 'account/rateLimits/read',
      messageType: 'rate_limit_event',
      model: 'gpt-5.5',
      rateLimitInfoFields: 'rateLimitType,resetsAt,status,utilization',
      rateLimitType: 'five_hour',
      requestBody: '[redacted]',
      windows: [{ label: 'Weekly', pct: 61, reset: 'Mon' }],
    });
  });

  it('keeps a dialog kind readable so an unanswered dialog can be traced', () => {
    expect(sanitizeDebugLogData({
      dialogKind: 'permission_ask_user_question',
      providerId: 'claude',
      reason: 'no-question-ui',
    })).toEqual({
      dialogKind: 'permission_ask_user_question',
      providerId: 'claude',
      reason: 'no-question-ui',
    });
  });
});
