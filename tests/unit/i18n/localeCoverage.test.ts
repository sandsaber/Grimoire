import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * How much of each locale is still English.
 *
 * A translation file is the same shape as `en.json`, so a key that was never
 * translated is not missing — it holds the English string, and nothing says so.
 * That is invisible drift: values accumulate untranslated at whatever rate new
 * copy is added, and a locale can rot without a single failing check.
 *
 * Some values are *meant* to match. A proper noun is the same word everywhere,
 * a placeholder that shows literal example input is not prose, and a string
 * that is only an interpolation has nothing to translate. Those are named in
 * `SHARED_WITH_ENGLISH` — named, so the exception is a decision rather than a
 * silence.
 *
 * What is left is the backlog, and the counts below are the current size of it.
 * They may go down without ceremony. They may not go up.
 */
const LOCALES = ['de', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh-CN', 'zh-TW'] as const;

/** Keys whose value is expected to read the same in every language. */
const SHARED_WITH_ENGLISH = new Set([
  // Product and protocol names.
  'settings.tabs.claude',
  'settings.tabs.codex',
  'settings.hub.mcp',
  'settings.mcp.modal.url',
  'settings.hub.geminiLegacy',
  'settings.hub.nativeCli',
  'settings.mcp.addRemote',
  // A parameter as the model vendors name it.
  'settings.agentEditor.topP',
  'settings.grok.subagents.topP',
  // Placeholders showing literal example input, not prose.
  'settings.customModels.placeholder',
  'settings.hiddenSlashCommands.placeholder',
  'settings.providerTabs.qwen.hiddenCommands.placeholder',
  'settings.subagents.modal.namePlaceholder',
  'settings.customModelAliases.placeholder',
  'settings.agentEditor.namePlaceholder',
  'settings.agentEditor.options',
]);

/**
 * Values that match English *and* have been looked at.
 *
 * Byte-identical is not the same as untranslated, which is what a first pass at
 * this got wrong: `Error`, `General` and `Color` are Spanish; `Option`,
 * `Question`, `Description` and `Actions` are French; `Option`, `Prompt`,
 * `Name` and `Agent` are ordinary German UI vocabulary. A gate that called
 * those a backlog would push translators to make the product *worse*.
 *
 * So the rule is not "must differ" but "must have been decided". Anything not
 * listed here and not covered by `SHARED_WITH_ENGLISH` is a value nobody has
 * looked at, and there are none — which is the point: the next one that appears
 * fails this until somebody translates it or writes it down here.
 */
const VERIFIED_IDENTICAL: Readonly<Record<typeof LOCALES[number], readonly string[]>> = {
  de: [
    'chat.greetings.general.version.name',
    'chat.ui.ask.option',
    'chat.ui.ask.optional',
    'chat.ui.permission.agent',
    'chat.ui.status.aria',
    'chat.ui.subagent.prompt',
    'chat.ui.toolbar.permissionAuto',
    'chat.ui.toolbar.permissionPlan',
    'chat.ui.toolbar.plan',
    'chat.ui.view.chat',
    'settings.agentEditor.badge',
    'settings.codexSkills.badge',
    'settings.envSnippets.modal.name',
    'settings.hub.name',
    'settings.providerTabs.codex.reasoning.auto',
    'settings.slashCommandEditor.agent',
    'settings.slashCommandEditor.skill',
    'settings.slashCommandEditor.skillBadge',
    'settings.subagents.modal.name',
    'settings.version.name',
  ],
  es: [
    'chat.ui.contextUsage.tokens',
    'chat.ui.errors.generic',
    'chat.ui.messages.errorLabel',
    'chat.ui.plan.label',
    'chat.ui.status.error',
    'chat.ui.status.errorUpper',
    'chat.ui.toolbar.permissionPlan',
    'chat.ui.toolbar.plan',
    'chat.ui.toolbar.tokens',
    'chat.ui.view.chat',
    'common.error',
    'settings.agentEditor.color',
    'settings.experimental',
    'settings.grok.subagents.color',
    'settings.hub.general',
    'settings.tabs.general',
  ],
  fr: [
    'chat.greetings.general.version.name',
    'chat.ui.ask.option',
    'chat.ui.ask.optional',
    'chat.ui.ask.question',
    'chat.ui.plan.label',
    'chat.ui.toolbar.effortLevels.max',
    'chat.ui.toolbar.permissionAuto',
    'chat.ui.toolbar.permissionPlan',
    'chat.ui.toolbar.plan',
    'chat.ui.view.chat',
    'chat.ui.view.conversation',
    'chat.ui.view.sources',
    'settings.codexSkills.instructions',
    'settings.conversations',
    'settings.envSnippets.modal.description',
    'settings.hub.actions',
    'settings.hub.source',
    'settings.mcp.modal.type',
    'settings.providerTabs.codex.reasoning.auto',
    'settings.slashCommandEditor.agent',
    'settings.slashCommandEditor.type',
    'settings.subagents.modal.description',
    'settings.version.name',
  ],
  pt: [
    'chat.ui.contextUsage.tokens',
    'chat.ui.status.aria',
    'chat.ui.subagent.prompt',
    'chat.ui.toolbar.permissionAuto',
    'chat.ui.toolbar.tokens',
    'chat.ui.view.chat',
    'settings.experimental',
    'settings.providerTabs.codex.reasoning.auto',
  ],
  ja: [],
  ko: [],
  ru: [],
  'zh-CN': [],
  'zh-TW': [],
};

function flatten(value: unknown, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof nested === 'string') {
        flat.set(path, nested);
      } else {
        for (const [innerKey, innerValue] of flatten(nested, path)) {
          flat.set(innerKey, innerValue);
        }
      }
    }
  }
  return flat;
}

function localeStrings(locale: string): Map<string, string> {
  const path = resolve(process.cwd(), `src/i18n/locales/${locale}.json`);
  return flatten(JSON.parse(readFileSync(path, 'utf8')));
}

/** A value with no letters of its own — `{count} / {total}` and the like. */
function isInterpolationOnly(value: string): boolean {
  return !/[A-Za-z]/.test(value.replaceAll(/\{[^}]*\}/g, ''));
}

function unreviewedKeys(locale: typeof LOCALES[number], english: Map<string, string>): string[] {
  const verified = new Set(VERIFIED_IDENTICAL[locale]);
  const unreviewed: string[] = [];
  for (const [key, value] of localeStrings(locale)) {
    const source = english.get(key);
    if (source === undefined || value !== source) continue;
    if (value.length <= 2 || SHARED_WITH_ENGLISH.has(key) || isInterpolationOnly(value)) continue;
    if (verified.has(key)) continue;
    unreviewed.push(key);
  }
  return unreviewed.sort();
}

describe('locale coverage', () => {
  const english = localeStrings('en');

  it('reads the source locale it compares against', () => {
    // Guards the guard: an empty map would make every count below zero.
    expect(english.size).toBeGreaterThan(100);
  });

  it.each(LOCALES)('%s holds the same keys as English', locale => {
    // A translation file that lost a key falls back to English at runtime,
    // which is the same invisibility this file exists to remove.
    expect([...localeStrings(locale).keys()].sort()).toEqual([...english.keys()].sort());
  });

  it.each(LOCALES)('%s has no value nobody has looked at', locale => {
    // Named in the failure rather than counted: a number tells whoever raised
    // it nothing about what to do, and the answer here is sometimes "translate
    // it" and sometimes "it is already right — write it down".
    expect(unreviewedKeys(locale, english)).toEqual([]);
  });

  it('lists nothing it has already verified as missing', () => {
    // Guards the list itself: an entry for a key that has since been translated
    // is stale, and a stale exception is how a real gap gets waved through
    // later under a name that used to be legitimate.
    const stale: string[] = [];
    for (const locale of LOCALES) {
      const strings = localeStrings(locale);
      for (const key of VERIFIED_IDENTICAL[locale]) {
        if (strings.get(key) !== english.get(key)) {
          stale.push(`${locale}:${key}`);
        }
      }
    }

    expect(stale).toEqual([]);
  });
});
