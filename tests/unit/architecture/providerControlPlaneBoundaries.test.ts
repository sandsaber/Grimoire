import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const PROVIDER_NEUTRAL_FILES = [
  'src/core/providers/ProviderControlPlane.ts',
  'src/core/providers/ProviderSettingsFingerprint.ts',
  'src/core/providers/ProviderSettingsTransactionCoordinator.ts',
  'src/core/providers/ProviderWorkspaceManager.ts',
  'src/app/settings/StagedProviderSettingsStore.ts',
];

describe('provider control-plane boundaries', () => {
  it('does not import legacy registries, feature UI, or concrete providers', () => {
    for (const file of PROVIDER_NEUTRAL_FILES) {
      const source = readFileSync(resolve(ROOT, file), 'utf8');
      expect(source).not.toMatch(
        /ProviderRegistry|ProviderWorkspaceRegistry|LegacyProviderContext|ChatRuntime/,
      );
      expect(source).not.toMatch(
        /(?:from|import\()\s*['"](?:@\/providers|\.\.\/\.\.\/providers|@\/features)/,
      );
    }
  });

  it('contains no built-in provider branching outside the sole catalog inventory', () => {
    const providerLiteral = /['"](?:claude|codex|opencode|grok|mimocode|kimicode|antigravity|gemini|qwen)['"]/;
    for (const file of PROVIDER_NEUTRAL_FILES) {
      expect(readFileSync(resolve(ROOT, file), 'utf8')).not.toMatch(providerLiteral);
    }
  });
});
