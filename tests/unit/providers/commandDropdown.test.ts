import '@/providers';

import { providerCatalog } from '@/core/providers/ProviderCatalog';

/**
 * What each provider declares about how its commands are typed.
 *
 * This was `getDropdownConfig()` on the command catalog — a **workspace**
 * service, built lazily and reached asynchronously — and all nine
 * implementations returned a frozen literal reading nothing. Three of its
 * consumers are synchronous, so a tab had to build a provider's whole workspace
 * to learn which character opens a command list, and showed no commands until
 * it had. It is a declaration now, and this is the one place the values live.
 *
 * The table is written out rather than derived, because the point of it is that
 * the characters a user types are the ones the provider's own CLI takes.
 */
const DECLARED: Readonly<Record<string, {
  triggerChars: readonly string[];
  builtInPrefix: string;
  skillPrefix: string;
  commandPrefix: string;
}>> = {
  claude: { triggerChars: ['/'], builtInPrefix: '/', skillPrefix: '/', commandPrefix: '/' },
  // The one provider that separates the two: `$` opens skills, `/` commands.
  codex: { triggerChars: ['/', '$'], builtInPrefix: '/', skillPrefix: '$', commandPrefix: '/' },
  gemini: { triggerChars: ['/'], builtInPrefix: '/', skillPrefix: '/', commandPrefix: '/' },
  grok: { triggerChars: ['/'], builtInPrefix: '/', skillPrefix: '/', commandPrefix: '/' },
  // Kimi Code names its skills, which is why its prefix is longer than a character.
  kimicode: { triggerChars: ['/'], builtInPrefix: '/', skillPrefix: '/skill:', commandPrefix: '/' },
  mimocode: { triggerChars: ['/'], builtInPrefix: '/', skillPrefix: '/', commandPrefix: '/' },
  opencode: { triggerChars: ['/'], builtInPrefix: '/', skillPrefix: '/', commandPrefix: '/' },
  qwen: { triggerChars: ['/'], builtInPrefix: '/', skillPrefix: '/', commandPrefix: '/' },
};

describe('provider command dropdown declarations', () => {
  const catalog = providerCatalog();

  it.each(Object.entries(DECLARED))('%s declares the prefixes its CLI takes', (providerId, expected) => {
    expect(catalog.declarations(providerId).commandDropdown).toEqual(expected);
  });

  it('leaves the declaration out for the provider with no command surface', () => {
    // Antigravity contributes no command catalog either, so an absent
    // declaration and an absent catalog say the same thing — which is the
    // whole reason the slot is optional rather than filled with empty strings.
    const withoutDropdown = catalog.ids()
      .filter(providerId => !catalog.declarations(providerId).commandDropdown);

    expect(withoutDropdown).toEqual(['antigravity']);
  });
});
