import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildManagedGrokProcessEnv,
  encodeGrokWorkspaceKey,
  resolveGrokAuthPath,
  resolveGrokChatHistoryPath,
  resolveGrokDataDir,
  resolveGrokSessionDirectory,
  resolveManagedGrokHomePath,
} from '../../../../src/providers/grok/runtime/GrokPaths';

describe('GrokPaths', () => {
  it('prefers GROK_HOME for Grok data directories', () => {
    expect(resolveGrokDataDir({
      GROK_HOME: '/tmp/grok-home',
      HOME: '/home/tester',
    })).toBe('/tmp/grok-home');
  });

  it('resolves auth.json from an explicit GROK_AUTH_PATH override', () => {
    expect(resolveGrokAuthPath({
      GROK_AUTH_PATH: '/custom/auth.json',
      HOME: '/home/tester',
    })).toBe('/custom/auth.json');
  });

  it('falls back to auth.json under the resolved data dir', () => {
    expect(resolveGrokAuthPath({
      HOME: '/home/tester',
    })).toBe(path.join('/home/tester', '.grok', 'auth.json'));
  });

  it('falls back to ~/.grok when GROK_HOME is unset', () => {
    expect(resolveGrokDataDir({
      HOME: '/home/tester',
    })).toBe(path.join('/home/tester', '.grok'));
  });

  it('resolves chat history from the encoded workspace session directory', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-grok-paths-'));
    const home = path.join(tmpRoot, 'home');
    const workspacePath = path.join(tmpRoot, 'vault');
    const sessionId = 'session-123';
    const sessionDir = path.join(
      home,
      '.grok',
      'sessions',
      encodeGrokWorkspaceKey(workspacePath),
      sessionId,
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'chat_history.jsonl'), '{"type":"user","content":"hi"}\n');

    const env = { HOME: home } as NodeJS.ProcessEnv;

    expect(resolveGrokSessionDirectory(sessionId, workspacePath, null, env)).toBe(sessionDir);
    expect(resolveGrokChatHistoryPath(sessionId, workspacePath, null, env)).toBe(
      path.join(sessionDir, 'chat_history.jsonl'),
    );
  });

  it('resolves managed Grok home under the vault .grimoire directory', () => {
    expect(resolveManagedGrokHomePath('/vault/root')).toBe(
      path.join(path.resolve('/vault/root'), '.grimoire', 'grok'),
    );
    expect(buildManagedGrokProcessEnv('/vault/root')).toEqual({
      GROK_HOME: path.join(path.resolve('/vault/root'), '.grimoire', 'grok'),
    });
  });

  it('resolves chat history from the managed Grok home sessions tree', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-grok-managed-'));
    const workspacePath = path.join(tmpRoot, 'vault');
    const sessionId = 'session-managed';
    const managedHome = resolveManagedGrokHomePath(workspacePath);
    const sessionDir = path.join(
      managedHome,
      'sessions',
      encodeGrokWorkspaceKey(workspacePath),
      sessionId,
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'chat_history.jsonl'), '{"type":"user","content":"hi"}\n');

    const env = buildManagedGrokProcessEnv(workspacePath);

    expect(resolveGrokSessionDirectory(sessionId, workspacePath, null, env)).toBe(sessionDir);
    expect(resolveGrokChatHistoryPath(sessionId, workspacePath, null, env)).toBe(
      path.join(sessionDir, 'chat_history.jsonl'),
    );
  });

  it('prefers a persisted session directory when it still contains chat history', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-grok-paths-'));
    const preferredDir = path.join(tmpRoot, 'preferred-session');
    fs.mkdirSync(preferredDir, { recursive: true });
    fs.writeFileSync(path.join(preferredDir, 'chat_history.jsonl'), '{"type":"user","content":"hi"}\n');

    expect(resolveGrokSessionDirectory(
      'session-1',
      '/missing/workspace',
      preferredDir,
    )).toBe(preferredDir);
  });
});
