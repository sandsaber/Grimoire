import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  antigravityProviderModule,
  antigravitySettingsCodec,
} from '@/providers/antigravity/AntigravityProviderModule';

/**
 * The first module written against the M1 contract.
 *
 * Its value is not that Antigravity works — the backend suites cover that — but
 * that a real provider can be expressed in the contract without a bare `object`
 * slot and without pretending to support anything it does not. The v1 module
 * failed exactly there.
 */
describe('Antigravity provider module', () => {
  it('declares its identity and ordering', () => {
    expect(antigravityProviderModule.manifest).toEqual({
      id: 'antigravity',
      displayName: 'Antigravity',
      order: 70,
    });
  });

  it('associates its execution backend with the provider, not with a bare id', () => {
    expect(antigravityProviderModule.execution.descriptor.association).toEqual({
      kind: 'provider',
      providerId: 'antigravity',
    });
  });

  describe('honest absences', () => {
    it('contributes no auxiliary source, so it has no auxiliary execution', () => {
      // The module carried three `ExecutionBackendFactory` slots for this until
      // the auxiliary rows moved, and auxiliary work is not three backends. It
      // is a runner over the backend the provider already has, contributed by
      // the composition — so what a provider with none contributes is nothing,
      // and the assertion is that `ApplicationRuntime` leaves it out.
      const composition = readFileSync(
        resolve(process.cwd(), 'src/app/ApplicationRuntime.ts'),
        'utf8',
      );
      const sources = composition.slice(
        composition.indexOf('sources: new Map(['),
        composition.indexOf(']),', composition.indexOf('sources: new Map([')),
      );

      expect(sources).not.toBe('');
      expect(sources).not.toContain("'antigravity'");
    });

    it('declares the stateless topology and no resume', () => {
      const capabilities = antigravityProviderModule.capabilities;

      expect(capabilities.process.topology).toBe('process-per-run');
      expect(capabilities.session.resume).toBe('unsupported');
      expect(capabilities.session.transcriptHydration).toBe('unsupported');
    });

    it('declares no interactions, which is why Safe mode stays fail-closed', () => {
      expect(antigravityProviderModule.capabilities.interactions).toEqual({
        approvals: 'unsupported',
        questions: 'unsupported',
        planMode: 'unsupported',
      });
      expect(antigravityProviderModule.capabilities.security.enforcement).toBe('grimoire');
    });

    it('omits the ports it has nothing to put in', () => {
      const ports = antigravityProviderModule.runtimePorts({
        listModels: async () => [],
        refreshModels: async () => [],
        renderSettingsTab: () => undefined,
      });

      expect(ports.history).toBeUndefined();
      expect(ports.rewind).toBeUndefined();
      expect(antigravityProviderModule.declarations.taskResults).toBeUndefined();
      expect(antigravityProviderModule.declarations.nativeAgents).toBeUndefined();
      // chatUI is not optional: every provider renders somewhere.
      // Asked rather than held: a module is built when its file is imported, and
      // an icon resolved through anything the application composes would run at
      // import time.
      expect(typeof antigravityProviderModule.declarations.chatUI.icon).toBe('function');
    });
  });

  describe('settings codec', () => {
    it('round-trips its own defaults', () => {
      const defaults = antigravitySettingsCodec.defaults();
      const decoded = antigravitySettingsCodec.decode(antigravitySettingsCodec.encode(defaults));

      expect(decoded.ok).toBe(true);
      expect(decoded.ok && decoded.value).toEqual(defaults);
    });

    it('preserves keys it does not model, in both directions', () => {
      // The behavior the M0a characterization found missing: the current
      // settings loader rebuilds provider blocks from its schema and drops
      // anything a newer build wrote.
      const decoded = antigravitySettingsCodec.decode({
        enabled: true,
        writtenByANewerBuild: { nested: ['a'] },
      });

      expect(decoded.preservedUnknown).toEqual({ writtenByANewerBuild: { nested: ['a'] } });

      const encoded = antigravitySettingsCodec.encode(
        decoded.ok ? decoded.value : decoded.fallback,
        decoded.preservedUnknown,
      );
      expect(encoded.writtenByANewerBuild).toEqual({ nested: ['a'] });
    });

    it('reports typed issues instead of throwing on malformed input', () => {
      const decoded = antigravitySettingsCodec.decode({
        cliPath: 42,
        visibleModels: ['ok', 7],
      });

      expect(decoded.ok).toBe(false);
      expect(decoded.ok === false && decoded.issues).toEqual(
        expect.arrayContaining([
          'cliPath has an invalid type',
          'visibleModels contains an invalid model',
        ]),
      );
      // A rejected decode still yields usable settings rather than nothing.
      expect(decoded.ok === false && decoded.fallback.cliPath).toBe('');
    });

    it('treats a non-object as a single issue rather than nine', () => {
      const decoded = antigravitySettingsCodec.decode('not settings');

      expect(decoded.ok === false && decoded.issues).toEqual(['settings must be an object']);
    });

    it('reads and writes enablement without touching the rest', () => {
      const defaults = antigravitySettingsCodec.defaults();
      const enabled = antigravitySettingsCodec.withEnabled(defaults, true);

      expect(antigravitySettingsCodec.isEnabled(enabled)).toBe(true);
      expect(antigravitySettingsCodec.isEnabled(defaults)).toBe(defaults.enabled);
      expect({ ...enabled, enabled: defaults.enabled }).toEqual(defaults);
    });

    it('names the inputs whose change fences the next run', () => {
      expect(antigravitySettingsCodec.runtimeInputKeys).toEqual(
        expect.arrayContaining(['environmentVariables', 'cliPath']),
      );
    });

  });

  describe('workspace contribution', () => {
    const context = {
      listModels: jest.fn().mockResolvedValue([{ id: 'a', label: 'A' }]),
      refreshModels: jest.fn().mockResolvedValue([{ id: 'b', label: 'B' }]),
      renderSettingsTab: jest.fn(),
    };

    it('exposes only the slots this provider actually has', async () => {
      const workspace = await antigravityProviderModule.workspace.initialize(
        context,
        new AbortController().signal,
      );

      expect(workspace.models).toBeDefined();
      expect(workspace.commands).toBeUndefined();
      expect(workspace.mcp).toBeUndefined();
      expect(workspace.agentMentions).toBeUndefined();
    });


    it('declares the dispose half of the lifecycle', async () => {
      const workspace = await antigravityProviderModule.workspace.initialize(
        context,
        new AbortController().signal,
      );

      // App-level inventory row 3: init without dispose is the v1 defect.
      await expect(antigravityProviderModule.workspace.dispose(workspace)).resolves.toBeUndefined();
    });
  });
});
