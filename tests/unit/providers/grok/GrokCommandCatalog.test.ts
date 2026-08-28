import { GrokCommandCatalog } from '@/providers/grok/commands/GrokCommandCatalog';

describe('GrokCommandCatalog', () => {
  it('maps runtime commands into slash dropdown entries', async () => {
    const catalog = new GrokCommandCatalog();
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
        providerId: 'grok',
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
        providerId: 'grok',
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
