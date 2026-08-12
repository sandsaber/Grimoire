import { AcpPermissionInteractionBridge } from '@/providers/acp/execution/AcpPermissionInteractionBridge';
import type { AcpRequestPermissionRequest } from '@/providers/acp/types';

describe('AcpPermissionInteractionBridge', () => {
  it('persists bounded application choices and maps them back to native option ids', async () => {
    const stored: unknown[] = [];
    const bridge = new AcpPermissionInteractionBridge({
      store: async input => {
        stored.push(input);
        return { presentationRef: `pr-${'1'.repeat(64)}` };
      },
    });

    const prepared = await bridge.prepare(permissionRequest());

    expect(prepared).toMatchObject({
      kind: 'approval',
      presentationRef: `pr-${'1'.repeat(64)}`,
      responseIds: ['option-1', 'option-2'],
      providerResolvedResponseId: 'option-2',
    });
    expect(stored).toEqual([{
      kind: 'approval',
      title: 'Write note',
      options: [
        { responseId: 'option-1', label: 'Allow once' },
        { responseId: 'option-2', label: 'Deny' },
      ],
    }]);
    await expect(prepared.resolve('option-1')).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'native allow/id' },
    });
    await expect(prepared.resolve('unknown')).resolves.toEqual({
      outcome: { outcome: 'cancelled' },
    });
    await expect(prepared.cancel()).resolves.toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });

  it('adds a fail-closed response when the provider offers no rejection option', async () => {
    const bridge = new AcpPermissionInteractionBridge({
      store: async () => ({ presentationRef: `pr-${'2'.repeat(64)}` }),
    });
    const prepared = await bridge.prepare({
      ...permissionRequest(),
      options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow' }],
    });

    expect(prepared.responseIds).toEqual(['option-1', 'cancel']);
    expect(prepared.providerResolvedResponseId).toBe('cancel');
    await expect(prepared.resolve('cancel')).resolves.toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });

  it('rejects duplicate native ids before publishing a presentation', async () => {
    let stored = false;
    const bridge = new AcpPermissionInteractionBridge({
      store: async () => {
        stored = true;
        return { presentationRef: `pr-${'3'.repeat(64)}` };
      },
    });
    await expect(bridge.prepare({
      ...permissionRequest(),
      options: [
        { optionId: 'same', kind: 'allow_once', name: 'Allow' },
        { optionId: 'same', kind: 'reject_once', name: 'Deny' },
      ],
    })).rejects.toThrow('invalid native option ids');
    expect(stored).toBe(false);
  });

  it.each([
    {
      label: 'option count',
      options: Array.from({ length: 65 }, (_, index) => ({
        optionId: `option-${index}`,
        kind: 'allow_once' as const,
        name: 'Allow',
      })),
      error: 'too many',
    },
    {
      label: 'native id size',
      options: [{ optionId: 'x'.repeat(4_097), kind: 'allow_once' as const, name: 'Allow' }],
      error: 'native option ids',
    },
    {
      label: 'label size',
      options: [{ optionId: 'allow', kind: 'allow_once' as const, name: 'x'.repeat(513) }],
      error: 'option label',
    },
    {
      label: 'option kind',
      options: [{ optionId: 'allow', kind: 'unknown', name: 'Allow' }],
      error: 'option kind',
    },
  ])('rejects hostile $label before presentation storage', async ({ options, error }) => {
    let stored = false;
    const bridge = new AcpPermissionInteractionBridge({
      store: async () => {
        stored = true;
        return { presentationRef: `pr-${'4'.repeat(64)}` };
      },
    });
    await expect(bridge.prepare({
      ...permissionRequest(),
      options: options as AcpRequestPermissionRequest['options'],
    })).rejects.toThrow(error);
    expect(stored).toBe(false);
  });

  it('rejects a custom option-array prototype without invoking inherited iteration code', async () => {
    let inheritedCodeRan = false;
    let stored = false;
    const options = [{ optionId: 'allow', kind: 'allow_once', name: 'Allow' }];
    Object.setPrototypeOf(options, {
      entries: () => {
        inheritedCodeRan = true;
        throw new Error('caller code executed');
      },
    });
    const bridge = new AcpPermissionInteractionBridge({
      store: async () => {
        stored = true;
        return { presentationRef: `pr-${'5'.repeat(64)}` };
      },
    });

    await expect(bridge.prepare({
      ...permissionRequest(),
      options: options as AcpRequestPermissionRequest['options'],
    })).rejects.toThrow('response options');
    expect(inheritedCodeRan).toBe(false);
    expect(stored).toBe(false);
  });
});

function permissionRequest(): AcpRequestPermissionRequest {
  return {
    sessionId: 'native-session',
    options: [
      { optionId: 'native allow/id', kind: 'allow_once', name: 'Allow once' },
      { optionId: 'native-deny', kind: 'reject_once', name: 'Deny' },
    ],
    toolCall: {
      toolCallId: 'tool-1',
      title: 'Write note',
    },
  };
}
