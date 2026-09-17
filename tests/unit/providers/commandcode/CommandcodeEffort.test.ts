import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { parseCommandcodeEfforts } from '@/providers/commandcode/runtime/CommandcodeModelDiscovery';
import { commandcodeLaunchSpec, createCommandcodeEffortMod } from '@/providers/commandcode/runtime/CommandcodeProcess';
import { updateCommandcodeSettings } from '@/providers/commandcode/settings';
import { commandcodeChatUIConfig as ui } from '@/providers/commandcode/ui/CommandcodeChatUIConfig';

describe('Command Code model-specific effort', () => {
  it('isolates concurrent efforts in disposable native session mods without --effort config writes', async () => {
    const high = createCommandcodeEffortMod('high');
    const max = createCommandcodeEffortMod('max');
    try {
      expect(high.path).not.toBe(max.path);
      const cmd = { setEffort: jest.fn() };
      for (const mod of [high, max]) {
        // Execute the generated factory against the vendor API contract.
        const source = readFileSync(mod.path, 'utf8').replace('export default ', '');
        const factory = runInNewContext(`(${source.trim().replace(/;$/, '')})`);
        factory(cmd);
      }
      expect(cmd.setEffort.mock.calls).toEqual([['high'], ['max']]);
      const launch = commandcodeLaunchSpec({ command: 'command-code', cwd: '/vault', environment: {},
        prompt: 'hello', effort: 'max', permissionMode: 'normal' }, max.path);
      expect(launch.arguments).toEqual(expect.arrayContaining(['--mod', max.path]));
      expect(launch.arguments).not.toContain('--effort');
    } finally { high.dispose(); max.dispose(); }
    expect(existsSync(high.path)).toBe(false);
    expect(existsSync(max.path)).toBe(false);
  });

  it.each([
    ['Unknown effort "grimoire-probe". Supported: high, max.', ['high', 'max']],
    ['Unknown effort "grimoire-probe". Supported: low, medium, xhigh.', ['low', 'medium', 'xhigh']],
    ['Laguna S 2.1 has no adjustable reasoning effort.', []],
    ['Authentication failed', undefined],
  ])('reads native validation without guessing: %s', (output, expected) => {
    expect(parseCommandcodeEfforts(output)).toEqual(expected);
  });

  it('offers only the selected model levels and resets an incompatible choice on model switch', () => {
    const settings = { model: 'commandcode:qwen', effortLevel: 'xhigh' };
    updateCommandcodeSettings(settings, { reasoningEffortsByModel: { qwen: ['low', 'medium', 'xhigh'],
      deepseek: ['high', 'max'], free: [] } });
    expect(ui.getReasoningOptions('commandcode:qwen', settings).map(o => o.value))
      .toEqual(['default', 'low', 'medium', 'xhigh']);
    expect(ui.getReasoningOptions('commandcode:deepseek', settings).map(o => o.value))
      .toEqual(['default', 'high', 'max']);
    expect(ui.getReasoningOptions('commandcode:free', settings)).toHaveLength(1);
    expect(ui.getReasoningOptions('commandcode:unknown', settings)).toHaveLength(1);
    ui.applyModelDefaults('commandcode:deepseek', settings);
    expect(settings.effortLevel).toBe('default');
  });
});
