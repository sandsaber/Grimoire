import type { ToolCallInfo } from '@/core/types';
import {
  buildGrokSubagentInfo,
  extractGrokSpawnResult,
  extractGrokWaitResult,
  GROK_SUBAGENT_SPAWN_TOOL,
  GROK_SUBAGENT_WAIT_TOOL,
} from '@/providers/grok/normalization/grokSubagentNormalization';

describe('grokSubagentNormalization', () => {
  it('extracts the Grok subagent id from the background launch result', () => {
    expect(extractGrokSpawnResult([
      'Subagent started in background.',
      'subagent_id: 019fcdb4-ee30-7793-8b19-59636938ebe5',
      'type: explore',
    ].join('\n'))).toEqual({
      agentId: '019fcdb4-ee30-7793-8b19-59636938ebe5',
    });
  });

  it('extracts per-agent results from Grok TaskOutput JSON', () => {
    const result = extractGrokWaitResult(JSON.stringify({
      type: 'TaskOutput',
      MultiResult: {
        mode: 'wait_all',
        results: [
          {
            task_id: 'agent-1',
            status: 'completed',
            output: 'First report\n\n<subagent_meta>id=agent-1</subagent_meta>\n<subagent_result>resume token</subagent_result>',
          },
          {
            task_id: 'agent-2',
            status: 'failed',
            output: 'Second task failed',
          },
        ],
      },
    }));

    expect(result).toEqual({
      statuses: {
        'agent-1': { completed: 'First report' },
        'agent-2': { failed: 'Second task failed' },
      },
      timedOut: false,
    });
  });

  it('extracts per-agent results from Grok rendered multi-wait output', () => {
    const result = extractGrokWaitResult([
      '=== Multi-wait (wait_all) ===',
      '--- Task agent-1 [completed] ---',
      'Command: [subagent:explore] Explore core vault notes',
      'Duration: 39.87s',
      'Exit Code: 0',
      'First report',
      '--- Task agent-2 [failed] ---',
      'Command: [subagent:explore] Map section',
      'Duration: 12.00s',
      'Exit Code: 1',
      'Second task failed',
      '',
      '1/2 tasks completed (wait_all)',
    ].join('\n'));

    expect(result).toEqual({
      statuses: {
        'agent-1': { completed: 'First report' },
        'agent-2': { failed: 'Second task failed' },
      },
      timedOut: false,
    });
  });

  it('builds a completed Grok subagent from its spawn and wait calls', () => {
    const spawnTool: ToolCallInfo = {
      id: 'spawn-1',
      name: GROK_SUBAGENT_SPAWN_TOOL,
      input: {
        capability_mode: 'read-only',
        description: 'Explore core vault notes',
        prompt: 'Inspect the vault and report in Russian.',
        subagent_type: 'explore',
      },
      status: 'completed',
      result: 'Subagent started in background.\nsubagent_id: agent-1',
    };
    const waitTool: ToolCallInfo = {
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
    };

    expect(buildGrokSubagentInfo(spawnTool, [spawnTool, waitTool])).toEqual(
      expect.objectContaining({
        agentId: 'agent-1',
        description: 'Explore core vault notes',
        id: 'spawn-1',
        prompt: 'Inspect the vault and report in Russian.',
        result: 'Vault report',
        status: 'completed',
      }),
    );
  });

});
