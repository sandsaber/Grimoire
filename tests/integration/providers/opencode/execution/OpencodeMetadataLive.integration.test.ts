import '@/providers';

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';

import { TestDurableStorage } from '@test/unit/core/persistence/TestDurableStorage';

import { ExecutionKernelHost } from '@/app/execution/ExecutionKernelHost';
import { OpencodeExecution } from '@/providers/opencode/execution/OpencodeExecutionComposition';
import { getOpencodeProviderSettings, updateOpencodeProviderSettings } from '@/providers/opencode/settings';

// Uses a real V2 CLI with a local Console fixture and a fake key; no inference.
const live = process.env.GRIMOIRE_OPENCODE_METADATA_LIVE === '1' ? describe : describe.skip;

live('OpenCode V2 credential-backed metadata (#253)', () => {
  jest.setTimeout(90_000);

  it('discovers Console models from the native database without creating sessions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'grimoire-opencode-metadata-'));
    const database = join(root, 'opencode.db');
    const cli = process.env.GRIMOIRE_OPENCODE_CLI ?? 'opencode';
    const originalEnvironment = process.env;
    const requests: string[] = [];
    const console = createServer((request, response) => {
      requests.push(request.url ?? '');
      if (request.headers.authorization !== 'Bearer fake-diagnostic-key') {
        response.writeHead(401).end();
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ providers: {
        'opencode-go': {
          name: 'Go fixture', canonical: 'openai', activation: 'auto',
          settings: { baseURL: 'http://127.0.0.1/inference' },
          models: { 'go-fixture': {
            name: 'Go fixture', limit: { context: 8192, output: 1024 }, variants: [{ id: 'high' }],
          } },
        },
      } }));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        console.once('error', reject);
        console.listen(0, '127.0.0.1', resolve);
      });
      const address = console.address();
      if (!address || typeof address === 'string') throw new Error('Missing fixture address');
      const environment: Record<string, string> = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] =>
          entry[1] !== undefined && /^(PATH|SystemRoot|COMSPEC|PATHEXT|TMPDIR|TEMP|TMP|LANG)$/i.test(entry[0])),
      );
      Object.assign(environment, {
        HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root,
        XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
        XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'),
        OPENCODE_DB: database,
      });
      const credentials = join(root, 'credentials.json');
      writeFileSync(credentials, JSON.stringify([{
        id: 'cred_fixture', integrationID: 'opencode', label: 'Local fixture', active: true,
        value: { type: 'key', key: 'fake-diagnostic-key', metadata: { server: `http://127.0.0.1:${address.port}` } },
      }]));
      await promisify(execFile)(cli, ['auth', 'import', '--standalone', credentials], {
        cwd: root, env: environment, timeout: 30_000,
      });
      process.env = environment;
      const state = () => {
        const db = new DatabaseSync(database, { readOnly: true });
        try {
          return {
            sessions: db.prepare('SELECT count(*) AS n FROM session_v2').get()!.n,
            credentials: db.prepare('SELECT count(*) AS n FROM credential').get()!.n,
          };
        } finally {
          db.close();
        }
      };
      const before = state();
      expect(before).toEqual({ sessions: 0, credentials: 1 });

      const catalogs: Array<{ ids: string[]; requestCount: number }> = [];
      let goLoaded: boolean | undefined;
      let thinking: unknown;
      let commands: unknown;
      for (const memory of [true, false]) {
        const settings: Record<string, unknown> = {
          settingsProvider: 'opencode', mediaFolder: 'media', systemPrompt: '', userName: 'Test',
          sharedEnvironmentVariables: Object.entries({ ...environment, OPENCODE_DB: memory ? ':memory:' : database })
            .map(([key, value]) => `${key}=${value}`).join('\n'),
        };
        updateOpencodeProviderSettings(settings, { enabled: true });
        const plugin: any = {
          settings, app: { vault: { adapter: { basePath: root } } },
          getResolvedProviderCliPath: () => cli, getAllViews: () => [],
          saveSettings: async () => undefined, recordDebugLog: jest.fn(),
        };
        const host = new ExecutionKernelHost({
          storage: new TestDurableStorage(),
          scheduler: {
            setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
            clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
          },
        });
        const execution = new OpencodeExecution(plugin, host.registry);
        host.registerBackend(execution.createBackendRegistration());
        try {
          await host.start();
          await expect(execution.metadata.discoverMetadata()).resolves.toBe(true);
          const ids = getOpencodeProviderSettings(settings).discoveredModels.map(model => model.rawId);
          catalogs.push({ ids, requestCount: requests.length });
          if (!memory) {
            goLoaded = await execution.metadata.discoverMetadata({ rawModelId: 'opencode-go/go-fixture' });
            thinking = getOpencodeProviderSettings(settings).thinkingOptionsByModel['opencode-go/go-fixture'];
            commands = await execution.metadata.listCommands();
          }
          expect(state()).toEqual(before);
        } finally {
          execution.dispose();
          await host.dispose();
        }
      }
      expect(catalogs[0].ids.some(id => id.startsWith('opencode-go/'))).toBe(false);
      expect(catalogs[0].requestCount).toBe(0);
      expect(catalogs[1].ids).toContain('opencode-go/go-fixture');
      expect(catalogs[1].requestCount).toBeGreaterThan(0);
      expect(requests.every(url => url === '/api/v2/config')).toBe(true);
      expect(goLoaded).toBe(true);
      expect(thinking).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'high' })]));
      expect(commands).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'review' })]));
    } finally {
      process.env = originalEnvironment;
      console.closeAllConnections();
      await new Promise<void>(resolve => console.close(() => resolve()));
      rmSync(root, { force: true, recursive: true });
    }
  });
});
