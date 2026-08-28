import '@/providers';

import { providerCatalog } from '@/core/providers/ProviderCatalog';
import { antigravityWorkspaceRegistration } from '@/providers/antigravity/app/AntigravityWorkspaceServices';
import { claudeWorkspaceRegistration } from '@/providers/claude/app/ClaudeWorkspaceServices';
import { codexWorkspaceRegistration } from '@/providers/codex/app/CodexWorkspaceServices';
import { geminiWorkspaceRegistration } from '@/providers/gemini/app/GeminiWorkspaceServices';
import { grokWorkspaceRegistration } from '@/providers/grok/app/GrokWorkspaceServices';
import { kimicodeWorkspaceRegistration } from '@/providers/kimicode/app/KimicodeWorkspaceServices';
import { mimocodeWorkspaceRegistration } from '@/providers/mimocode/app/MimocodeWorkspaceServices';
import { opencodeWorkspaceRegistration } from '@/providers/opencode/app/OpencodeWorkspaceServices';
import { qwenWorkspaceRegistration } from '@/providers/qwen/app/QwenWorkspaceServices';

/**
 * The workspace capability record, in the two places that hold it.
 *
 * The declaration moved to `ProviderCapabilityDescriptor.workspace`, and the
 * registration still carries the original because the registry validates it.
 * Two inventories of one fact is exactly what this migration keeps finding, so
 * for as long as both exist they are compared — field for field, not by
 * summary. When the registry goes, this file goes with it.
 */

const REGISTRATIONS = {
  antigravity: antigravityWorkspaceRegistration,
  claude: claudeWorkspaceRegistration,
  codex: codexWorkspaceRegistration,
  gemini: geminiWorkspaceRegistration,
  grok: grokWorkspaceRegistration,
  kimicode: kimicodeWorkspaceRegistration,
  mimocode: mimocodeWorkspaceRegistration,
  opencode: opencodeWorkspaceRegistration,
  qwen: qwenWorkspaceRegistration,
};

describe('workspace capability parity', () => {

  it.each(Object.entries(REGISTRATIONS))(
    '%s declares its workspace capabilities once, on the descriptor',
    (providerId, registration) => {
      // **This asserted the two copies agreed.** The registration carried its
      // own, duplicated into the descriptor "so the two cannot disagree until
      // the registry goes" — and production had already stopped reading it:
      // `ProviderCatalog.workspaceCapabilities` answers off
      // `capabilities.workspace`. A record kept in step by a test is a record
      // with two owners, so the registration's copy is deleted and this asserts
      // there is no second one to drift.
      expect(providerCatalog().workspaceCapabilities(providerId)).toBeDefined();
      expect(registration).not.toHaveProperty('workspaceCapabilities');
    },
  );

  it('answers for every provider the catalog holds', () => {
    // A provider whose descriptor forgot the map would answer `{}`, and every
    // settings section would read that as "this provider has none" — a UI that
    // silently loses a whole section, which is the failure this migration keeps
    // finding rather than one it introduces.
    for (const providerId of providerCatalog().ids()) {
      expect(Object.keys(providerCatalog().workspaceCapabilities(providerId))).not.toEqual([]);
    }
  });

  it('keeps the two axes the settings surface reads separately', () => {
    // Codex is the provider that proves one value could not have said it: its
    // MCP servers cannot be listed by Grimoire, and Grimoire still points the
    // user at where to set them up.
    expect(providerCatalog().workspaceCapabilities('codex').mcp)
      .toEqual({ inventory: 'none', manager: 'guidance' });
  });
});
