import { readFileSync } from 'node:fs';
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
];

/**
 * Pre-existing violations of `src/core/**` → plugin. Each is removed when the
 * provider catalog replaces the split registries at M3; until then the list may
 * shrink but never grow.
 */
const LEGACY_CORE_PLUGIN_IMPORTS = [
  'src/core/providers/ProviderRegistry.ts',
  'src/core/providers/ProviderWorkspaceRegistry.ts',
  'src/core/providers/types.ts',
];

/**
 * Pre-existing direct process launch from a feature. Bang-bash mode is a
 * product surface today; its execution moves to the local-shell backend at M5.
 */
const LEGACY_FEATURE_PROCESS_LAUNCH = ['src/features/chat/services/BangBashService.ts'];

function read(module: string): string {
  return readFileSync(resolve(process.cwd(), module), 'utf8');
}

function importsPlugin(source: string): boolean {
  return /from '(\.\.\/)+main'|from '@\/main'/.test(source);
}

function launchesProcess(source: string): boolean {
  return /from '(node:)?child_process'|require\('(node:)?child_process'\)/.test(source);
}

describe('execution composition boundaries', () => {
  const modules = listAllSourceModules();

  describe('forbidden dependency directions', () => {
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
      expect(source).not.toMatch(/from '(\.\.\/)+providers\//);
      expect(source).not.toMatch(/from '(\.\.\/)+features\//);
      expect(source).not.toMatch(/from 'obsidian'/);
      expect(source).not.toMatch(/\bHTMLElement\b|\bdocument\b/);
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
      { row: 'getPreloadedContextFiles', owner: 'ProviderFeatureContributions', slot: 'context' },
      { row: 'capabilities', owner: 'ProviderModule', slot: 'capabilities' },
      { row: 'environmentKeyPatterns', owner: 'ProviderSettingsCodec', slot: 'runtimeInputKeys' },
      { row: 'chatUIConfig', owner: 'ProviderFeatureContributions', slot: 'chatUI' },
      { row: 'settingsReconciler', owner: 'ProviderSettingsCodec', slot: 'reconcile' },
      { row: 'createRuntime', owner: 'ProviderModule', slot: 'execution' },
      { row: 'createTitleGenerationService', owner: 'ProviderAuxiliaryContributions', slot: 'title' },
      { row: 'createInstructionRefineService', owner: 'ProviderAuxiliaryContributions', slot: 'instructionRefine' },
      { row: 'createInlineEditService', owner: 'ProviderAuxiliaryContributions', slot: 'inlineEdit' },
      { row: 'historyService', owner: 'ProviderFeatureContributions', slot: 'history' },
      { row: 'taskResultInterpreter', owner: 'ProviderFeatureContributions', slot: 'taskResults' },
      { row: 'subagentLifecycleAdapter', owner: 'ProviderFeatureContributions', slot: 'nativeAgents' },
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
