import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  loadGrokSessionContextUsage,
  loadGrokSessionCost,
  parseGrokSignalsContextUsage,
  parseGrokUsageUpdateRows,
  sumGrokCostRows,
} from '@/providers/grok/history/GrokUsageMetadataStore';
import { encodeGrokWorkspaceKey } from '@/providers/grok/runtime/GrokPaths';

describe('GrokUsageMetadataStore', () => {
  it('sums positive Grok Build metadata cost rows as USD spend', () => {
    expect(sumGrokCostRows([
      { cost: 0 },
      { cost: 1.25 },
      { cost: '0.75' },
      { cost: null },
    ])).toEqual({
      amount: 2,
      currency: 'USD',
    });
  });

  it('returns null when Grok Build has no positive metadata cost', () => {
    expect(sumGrokCostRows([
      { cost: 0 },
      { cost: null },
      { cost: -1 },
    ])).toBeNull();
  });

  it('parses usage_update rows from Grok session updates.jsonl', () => {
    const rawUpdates = [
      JSON.stringify({
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'usage_update',
            cost: { amount: 0.42, currency: 'USD' },
          },
        },
      }),
      JSON.stringify({
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'hello' },
          },
        },
      }),
    ].join('\n');

    expect(parseGrokUsageUpdateRows(rawUpdates)).toEqual([
      { cost: 0.42 },
    ]);
  });

  it('maps signals.json context fields into ACP usage updates', () => {
    expect(parseGrokSignalsContextUsage({
      contextTokensUsed: 5321,
      contextWindowTokens: 512000,
    })).toEqual({
      used: 5321,
      size: 512000,
    });
  });

  it('loads session cost and context usage from persisted Grok session files', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-grok-usage-'));
    const home = path.join(tmpRoot, 'home');
    const workspacePath = path.join(tmpRoot, 'vault');
    const sessionId = 'session-usage-1';
    const sessionDir = path.join(
      home,
      '.grok',
      'sessions',
      encodeGrokWorkspaceKey(workspacePath),
      sessionId,
    );
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'chat_history.jsonl'), '{"type":"user","content":"hi"}\n');
    fs.writeFileSync(path.join(sessionDir, 'updates.jsonl'), [
      JSON.stringify({
        method: 'session/update',
        params: {
          update: {
            sessionUpdate: 'usage_update',
            cost: { amount: 1.5, currency: 'USD' },
          },
        },
      }),
    ].join('\n'));
    fs.writeFileSync(path.join(sessionDir, 'signals.json'), JSON.stringify({
      contextTokensUsed: 1200,
      contextWindowTokens: 200000,
    }));

    const providerState = { workspacePath };
    const previousEnv = process.env;
    process.env = { ...previousEnv, HOME: home, USERPROFILE: home };

    try {
      await expect(loadGrokSessionCost(sessionId, providerState)).resolves.toEqual({
        amount: 1.5,
        currency: 'USD',
      });
      await expect(loadGrokSessionContextUsage(sessionId, providerState)).resolves.toEqual({
        used: 1200,
        size: 200000,
      });
    } finally {
      process.env = previousEnv;
    }
  });
});
