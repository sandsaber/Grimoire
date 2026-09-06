import { MimocodeCommandCatalog } from '@/providers/mimocode/commands/MimocodeCommandCatalog';

describe('MimocodeCommandCatalog', () => {
  it('maps runtime commands into slash dropdown entries', async () => {
    const catalog = new MimocodeCommandCatalog();
    catalog.setRuntimeCommands([
      {
        id: 'acp:/review',
        name: '/review',
        description: 'Review the current changes',
        argumentHint: '$1',
        content: '',
        source: 'sdk',
      },
      {
        id: 'acp:review-duplicate',
        name: 'review',
        description: 'Duplicate entry',
        content: '',
        source: 'sdk',
      },
      {
        id: 'acp:fix',
        name: 'fix',
        description: 'Apply a fix',
        content: '',
        source: 'sdk',
      },
    ]);

    await expect(catalog.listDropdownEntries({ includeBuiltIns: false })).resolves.toEqual([
      {
        id: 'acp:/review',
        providerId: 'mimocode',
        kind: 'command',
        name: 'review',
        description: 'Review the current changes',
        content: '',
        argumentHint: '$1',
        scope: 'runtime',
        source: 'sdk',
        isEditable: false,
        isDeletable: false,
        displayPrefix: '/',
        insertPrefix: '/',
      },
      {
        id: 'acp:fix',
        providerId: 'mimocode',
        kind: 'command',
        name: 'fix',
        description: 'Apply a fix',
        content: '',
        scope: 'runtime',
        source: 'sdk',
        isEditable: false,
        isDeletable: false,
        displayPrefix: '/',
        insertPrefix: '/',
      },
    ]);
  });

});
