import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolve } from 'node:path';

import { readInterfaceMembers } from '@test/helpers/interfaceMembers';
import { listAllSourceModules } from '@test/helpers/moduleReachability';

/**
 * Enforces the allowed dependency directions and the completeness of the
 * provider module contract.
 *
 * The plan lists permanent forbidden directions and requires them enforced from
 * the first composition commit. Two of them are violated by code that predates
 * the migration; those violations are enumerated with an owning milestone
 * rather than hidden behind a wildcard, so the gate blocks new ones from
 * appearing while the existing ones shrink on schedule.
 */

const MODULE_PATH = 'src/core/providers/ProviderModule.ts';
const DESCRIPTOR_PATH = 'src/core/execution/ExecutionBackendDescriptor.ts';

/** New composition and kernel code, held to the rule with no exemptions. */
const STRICT_MODULES = [
  MODULE_PATH,
  DESCRIPTOR_PATH,
  'src/core/execution/ExecutionContracts.ts',
  'src/core/execution/ExecutionEventIngestor.ts',
  'src/core/execution/ExecutionLifecycleRegistry.ts',
  'src/core/execution/ExecutionEvents.ts',
  'src/core/execution/ExecutionIds.ts',
  'src/core/execution/ExecutionTerminalPolicy.ts',
  'src/core/execution/RunProjection.ts',
  'src/core/execution/local/LocalShellBackend.ts',
  'src/core/execution/ExecutionEventQueue.ts',
  'src/core/execution/ResultCommit.ts',
  'src/providers/antigravity/execution/AntigravityExecutionBackend.ts',
  'src/providers/antigravity/AntigravityProviderModule.ts',
  'src/core/execution/ExecutionControlPaths.ts',
  'src/core/execution/ExecutionControlRecords.ts',
  'src/core/execution/ExecutionControlRepositories.ts',
  'src/core/execution/ExecutionControlSchemas.ts',
  'src/core/execution/ExecutionControlTransactionCoordinator.ts',
  'src/core/persistence/ControlRecordPayloadPolicy.ts',
  'src/core/persistence/DurableStorage.ts',
  'src/core/persistence/TransactionIntentCoordinator.ts',
  'src/core/persistence/VersionedRecord.ts',
  'src/core/persistence/VersionedRepository.ts',
  'src/core/runtime/execution/ExecutionChatRuntimeAdapter.ts',
  // Under `src/features/` and held to the same rule as core: a projection that
  // learns a DOM type, an element structure or a CSS class is the plan's stop
  // condition, and it is what would make a UI redesign another architecture
  // event instead of a renderer swap.
  'src/features/chat/projections/ChatProjection.ts',
];

/**
 * Pre-existing violations of `src/core/**` → plugin.
 *
 * Each closes when its file is deleted, which happens when the last consumer of
 * the two registries has moved. That was M3's exit gate until reading the rows
 * showed them to be re-implementations of UI-shaped consumers rather than
 * moves; they belong to M5 now, with the consumers they serve. Until then the
 * list may shrink but never grow.
 */
const LEGACY_CORE_PLUGIN_IMPORTS = [
  'src/core/providers/ProviderRegistry.ts',
  'src/core/providers/ProviderWorkspaceRegistry.ts',
  'src/core/providers/types.ts',
];

/**
 * There is no exemption list for `src/core/**` → a concrete provider, because
 * there are no violations.
 *
 * There was one, of eight modules, and it was wrong. It came from a gate that
 * matched specifiers as text and so could not tell `src/core/providers/` —
 * core's own neutral contracts, which those eight import — from
 * `src/providers/`. Resolving the specifier against the importing file emptied
 * the list at a stroke. The direction has always been clean; the measurement
 * was not.
 */

/**
 * Direct process launches still permitted under `src/features/`.
 *
 * Empty since M5 moved bang-bash mode onto the local-shell backend, which was
 * the only entry. Kept as a list rather than deleted so a new one has to be
 * added deliberately, and asserted empty so the exemption cannot come back
 * quietly.
 */
const LEGACY_FEATURE_PROCESS_LAUNCH: string[] = [];

function read(module: string): string {
  return readFileSync(resolve(process.cwd(), module), 'utf8');
}

function importsPlugin(source: string): boolean {
  return [...specifiersIn(source)].some(specifier => (
    /^(\.\.\/)+main$/.test(specifier) || specifier === '@/main'
  ));
}

/**
 * Every module specifier in a file, however it was written.
 *
 * Static `from '...'` was the only form this gate could see, so a dynamic
 * `import()` or a `require()` was a way past every rule below it. No violation
 * existed — which is the reason to close it now rather than after one does: a
 * boundary that only holds for the syntax someone happened to use is not a
 * boundary, and `import()` is exactly what a module reaches for when a static
 * import would be circular.
 */
function* specifiersIn(source: string): Generator<string> {
  const patterns = [
    /from ['"]([^'"]+)['"]/g,
    // A side-effect import names no binding, which is exactly how a module is
    // pulled in for what it registers rather than for what it exports.
    /^\s*import\s+['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const [, specifier] of source.matchAll(pattern)) {
      yield specifier;
    }
  }
}

/**
 * Matches both import styles.
 *
 * The first version of this gate only matched relative specifiers, while the
 * repository imports through the `@/` alias — the Antigravity backend does. A
 * core module could have imported a concrete provider by alias and the gate
 * would have stayed green.
 */
function importsFrom(module: string, source: string, area: 'providers' | 'features'): boolean {
  // Specifiers are resolved against the importing file rather than matched as
  // text. The text version could not tell `src/core/providers/` — core's own
  // neutral contracts — from `src/providers/`, and reported all eight core
  // modules that import `../providers/types` as importing a concrete provider.
  // They do not, and never did.
  const directory = dirname(module);
  for (const specifier of specifiersIn(source)) {
    const resolved = specifier.startsWith('@/')
      ? `src/${specifier.slice(2)}`
      : specifier.startsWith('.')
        ? posixJoin(directory, specifier)
        : null;
    if (resolved?.startsWith(`src/${area}/`)) {
      return true;
    }
  }
  return false;
}

/** Path join that keeps POSIX separators on every platform, as module ids use. */
function posixJoin(directory: string, specifier: string): string {
  const segments = `${directory}/${specifier}`.split('/');
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '.' || segment === '') {
      continue;
    }
    if (segment === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join('/');
}

function launchesProcess(source: string): boolean {
  return [...specifiersIn(source)].some(specifier => (
    specifier === 'child_process' || specifier === 'node:child_process'
  ));
}

describe('execution composition boundaries', () => {
  const modules = listAllSourceModules();

  describe('forbidden dependency directions', () => {
    it('adds no new provider import under src/core, by relative path or alias', () => {
      const offenders = modules
        .filter(module => module.startsWith('src/core/'))
        .filter(module => importsFrom(module, read(module), 'providers'));

      expect(offenders).toEqual([]);
    });

    it('sees a specifier however it was written, including a dynamic import', () => {
      // Guards the guard. `import()` is what a module reaches for when a static
      // import would be circular, which is precisely the shape a boundary
      // violation takes — and it was invisible to every rule in this file.
      const dynamic = "const m = await import('@/providers/codex/settings');";
      const required = "const m = require('../../providers/codex/settings');";
      const dynamicPlugin = "const p = await import('@/main');";
      const dynamicSpawn = "const { spawn } = await import('node:child_process');";
      // A side-effect import and a double-quoted one: neither names a binding
      // the other patterns could have caught.
      const sideEffect = "import '@/providers/codex/settings';";
      const doubleQuoted = 'import { Y } from "@/providers/codex/settings";';

      expect(importsFrom('src/core/x/Y.ts', dynamic, 'providers')).toBe(true);
      expect(importsFrom('src/core/x/Y.ts', sideEffect, 'providers')).toBe(true);
      expect(importsFrom('src/core/x/Y.ts', doubleQuoted, 'providers')).toBe(true);
      expect(importsFrom('src/core/runtime/ChatRuntime.ts', required, 'providers')).toBe(true);
      expect(importsPlugin(dynamicPlugin)).toBe(true);
      expect(launchesProcess(dynamicSpawn)).toBe(true);
      // And still says no to core's own neutral contracts.
      expect(importsFrom('src/core/x/Y.ts', "await import('@/core/providers/types')", 'providers'))
        .toBe(false);
    });

    it('resolves a specifier rather than matching it, so the rule means what it says', () => {
      // Guards the guard, with the two cases the text version confused. Without
      // this, the gate could regress to string matching and nobody would see it
      // until an exemption list reappeared.
      const coreInternal = "import type { X } from '../providers/types';";
      const concreteProvider = "import { Y } from '../../providers/codex/settings';";

      expect(importsFrom('src/core/runtime/ChatRuntime.ts', coreInternal, 'providers')).toBe(false);
      expect(importsFrom('src/core/runtime/ChatRuntime.ts', concreteProvider, 'providers'))
        .toBe(true);
      expect(importsFrom('src/core/x/Y.ts', "from '@/providers/codex/settings'", 'providers'))
        .toBe(true);
      expect(importsFrom('src/core/x/Y.ts', "from '@/core/providers/types'", 'providers'))
        .toBe(false);
    });

    it('adds no feature import under src/core, by relative path or alias', () => {
      const offenders = modules
        .filter(module => module.startsWith('src/core/'))
        .filter(module => importsFrom(module, read(module), 'features'));

      expect(offenders).toEqual([]);
    });

    it('adds no new plugin import under src/core', () => {
      const offenders = modules
        .filter(module => module.startsWith('src/core/'))
        .filter(module => importsPlugin(read(module)))
        .filter(module => !LEGACY_CORE_PLUGIN_IMPORTS.includes(module));

      expect(offenders).toEqual([]);
    });

    it('keeps the legacy plugin-import list from growing back', () => {
      // Every listed file must still be a real violation. When one is fixed the
      // list shrinks with it, so the allowlist cannot outlive its reason.
      const stale = LEGACY_CORE_PLUGIN_IMPORTS.filter(module => !importsPlugin(read(module)));

      expect(stale).toEqual([]);
    });

    it('permits no direct process launch under src/features at all', () => {
      // Bang-bash mode was the last one. A feature that spawns its own child
      // process owns a lifetime nothing else can end: unloading the plugin
      // left the command running.
      expect(LEGACY_FEATURE_PROCESS_LAUNCH).toEqual([]);
    });

    it('adds no new direct process launch under src/features', () => {
      const offenders = modules
        .filter(module => module.startsWith('src/features/'))
        .filter(module => launchesProcess(read(module)))
        .filter(module => !LEGACY_FEATURE_PROCESS_LAUNCH.includes(module));

      expect(offenders).toEqual([]);
    });

    it.each(STRICT_MODULES)('%s imports no plugin, provider, feature, or DOM surface', module => {
      const source = read(module);

      expect(importsPlugin(source)).toBe(false);
      expect(launchesProcess(source)).toBe(false);
      expect(importsFrom(module, source, 'features')).toBe(false);
      // Strict modules also take no concrete provider, which the exemption-free
      // rule above already covers for core but not for the two provider-owned
      // entries in this list.
      expect(importsFrom(module, source, 'providers') && module.startsWith('src/core/'))
        .toBe(false);
      expect(source).not.toMatch(/from 'obsidian'/);
      // The browser's global object belongs here with the other two: the
      // adapter reached for its timer while an injectable clock was already
      // beside it, and a rule naming only `document` and `HTMLElement` called
      // that clean. A host's timer arrives through a port like everything else.
      // The match is over the whole file, comments included — so a strict
      // module explains the rule without writing the word it forbids.
      expect(source).not.toMatch(/\bHTMLElement\b|\bdocument\b|\bwindow\./);
    });
  });

  describe('projections stay presentation-agnostic', () => {
    /**
     * The plan's stop condition, as a rule rather than a sentence.
     *
     * A projection that names a CSS class, an element or a layout is a
     * projection a UI redesign has to rewrite, which is what makes the redesign
     * another architecture event instead of a renderer swap. The strict-module
     * rule above already forbids DOM globals and `obsidian`; these are the
     * markers that arrive as *field names* instead, which no import check sees.
     */
    const PROJECTION_MODULES = ['src/features/chat/projections/ChatProjection.ts'];
    const PRESENTATION_VOCABULARY = [
      /\bcssClass\b/,
      /\bclassName\b/,
      /\bgrimoire-[a-z-]+\b/,
      /\binnerHTML\b/,
      /\bstyle\b\s*[:?]/,
      /\belement\b\s*[:?]/,
      /\bcontainer\b\s*[:?]/,
    ];

    it.each(PROJECTION_MODULES)('%s names no presentation vocabulary', module => {
      const source = read(module);
      const found = PRESENTATION_VOCABULARY.filter(pattern => pattern.test(source));

      expect(found).toEqual([]);
    });

    it('recognises the vocabulary it forbids', () => {
      // Guards the guard: a rule over field names is easy to write in a form
      // that matches nothing at all.
      const samples = [
        'readonly cssClass: string;',
        'readonly className: string;',
        "const cls = 'grimoire-history-item';",
        'node.innerHTML = text;',
        'readonly style: string;',
        'readonly element?: unknown;',
        'readonly container: unknown;',
      ];

      for (const sample of samples) {
        expect(PRESENTATION_VOCABULARY.some(pattern => pattern.test(sample))).toBe(true);
      }
      expect(PRESENTATION_VOCABULARY.some(pattern => pattern.test('readonly title: string;')))
        .toBe(false);
    });
  });

  describe('provider module contract completeness', () => {
    const source = read(MODULE_PATH);

    /**
     * Every row of `docs/provider-contribution-inventory.md` and the slot that
     * carries it. A contribution with no slot is how the v1 cutover lost most
     * of the product.
     */
    const ROW_SLOTS: Array<{ row: string; owner: string; slot: string }> = [
      { row: 'displayName', owner: 'ProviderManifest', slot: 'displayName' },
      { row: 'blankTabOrder', owner: 'ProviderManifest', slot: 'order' },
      { row: 'isEnabled', owner: 'ProviderSettingsCodec', slot: 'isEnabled' },
      { row: 'setEnabled', owner: 'ProviderSettingsCodec', slot: 'withEnabled' },
      { row: 'getPreloadedContextFiles', owner: 'ProviderDeclarations', slot: 'context' },
      { row: 'capabilities', owner: 'ProviderModule', slot: 'capabilities' },
      { row: 'environmentKeyPatterns', owner: 'ProviderSettingsCodec', slot: 'runtimeInputKeys' },
      { row: 'chatUIConfig', owner: 'ProviderDeclarations', slot: 'chatUI' },
      { row: 'settingsReconciler', owner: 'ProviderSettingsCodec', slot: 'reconcile' },
      { row: 'createRuntime', owner: 'ProviderModule', slot: 'execution' },
      { row: 'createTitleGenerationService', owner: 'ProviderAuxiliaryContributions', slot: 'title' },
      { row: 'createInstructionRefineService', owner: 'ProviderAuxiliaryContributions', slot: 'instructionRefine' },
      { row: 'createInlineEditService', owner: 'ProviderAuxiliaryContributions', slot: 'inlineEdit' },
      { row: 'historyService', owner: 'ProviderRuntimePorts', slot: 'history' },
      { row: 'taskResultInterpreter', owner: 'ProviderDeclarations', slot: 'taskResults' },
      { row: 'subagentLifecycleAdapter', owner: 'ProviderDeclarations', slot: 'nativeAgents' },
      { row: 'commandCatalog', owner: 'ProviderWorkspaceSlots', slot: 'commands' },
      { row: 'agentMentionProvider', owner: 'ProviderWorkspaceSlots', slot: 'agentMentions' },
      { row: 'cliResolver', owner: 'ProviderWorkspaceSlots', slot: 'cliResolution' },
      { row: 'modelCatalog', owner: 'ProviderWorkspaceSlots', slot: 'models' },
      { row: 'usageProvider', owner: 'ProviderWorkspaceSlots', slot: 'usage' },
      { row: 'runtimeCommandLoader', owner: 'ProviderWorkspaceSlots', slot: 'runtimeCommands' },
      { row: 'tabWarmupPolicy', owner: 'ProviderWorkspaceSlots', slot: 'residency' },
      { row: 'mcpStorage', owner: 'ProviderWorkspaceSlots', slot: 'mcp' },
      { row: 'mcpServerManager', owner: 'ProviderWorkspaceSlots', slot: 'mcp' },
      { row: 'settingsTabRenderer', owner: 'ProviderWorkspaceSlots', slot: 'settingsPresentation' },
      { row: 'refreshAgentMentions', owner: 'ProviderAgentMentionsPort', slot: 'refresh' },
      { row: 'workspaceCapabilities', owner: 'ProviderCapabilityDescriptor', slot: 'workspace' },
      { row: 'default provider configs', owner: 'ProviderSettingsCodec', slot: 'defaults' },
      { row: 'workspace initialize/dispose', owner: 'ProviderWorkspaceContribution', slot: 'dispose' },
    ];

    it('covers all thirty inventory rows', () => {
      expect(ROW_SLOTS).toHaveLength(30);
    });

    it.each(ROW_SLOTS)('$row has the typed slot $owner.$slot', ({ owner, slot }) => {
      expect(readInterfaceMembers(MODULE_PATH, owner)).toContain(slot);
    });

    it('declares both halves of the workspace lifecycle', () => {
      // App-level inventory row 3: shipping init without dispose is the v1
      // defect repeating, so the contract cannot express one without the other.
      const members = readInterfaceMembers(MODULE_PATH, 'ProviderWorkspaceContribution');

      expect(members).toContain('initialize');
      expect(members).toContain('dispose');
    });

    it('types every slot, with no bare object placeholders', () => {
      // The v1 module reserved eight names as `object`. A reserved name is not
      // a contract, and it is why the cutover could drop the contributions
      // behind it without failing anything.
      expect(source).not.toMatch(/:\s*object\b/);
      expect(source).not.toMatch(/Record<[^>]*,\s*object>/);
    });

    it('states that an absent slot means unsupported', () => {
      expect(source).toContain('absent means unsupported');
    });
  });
});
