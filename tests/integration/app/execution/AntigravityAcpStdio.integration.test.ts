import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeManagedAcpProcessLauncher } from '@/app/execution/acp/NodeManagedAcpProcessLauncher';
import { AcpJsonRpcTransport } from '@/providers/acp/AcpJsonRpcTransport';
import { AntigravityAcpRequests } from '@/providers/antigravity/execution/AntigravityAcpRequests';
import { AntigravityRequestStore } from '@/providers/antigravity/execution/AntigravityRequestStore';

it('round-trips UTF-8 through the Antigravity ACP launch path before stdin closes', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'Grimoire ACP '));
  // Node runs the temporary "acp" file as its script. The launch command and
  // open stdio pipes are the ones Grimoire uses for an installed native CLI.
  writeFileSync(join(cwd, 'acp'), [
    'const lines = require("node:readline").createInterface({ input: process.stdin });',
    'lines.on("line", line => {',
    '  const { id, params } = JSON.parse(line);',
    '  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: params }) + "\\n");',
    '});',
  ].join('\n'));
  const store = new AntigravityRequestStore(randomUUID);
  const requests = new AntigravityAcpRequests(store, () => ({
    command: process.execPath, cwd, environment: process.env, permissionMode: 'normal',
  }), async text => text);
  const launcher = new NodeManagedAcpProcessLauncher({ resolve: ref => requests.resolveLaunch(ref) });
  let transport: AcpJsonRpcTransport | undefined;
  try {
    const invocation = await requests.resolve(store.reference({ owner: 'tab', model: null, prompt: 'Tere, 世界 🌍' }));
    const child = await launcher.launch(invocation.startupRef, new AbortController().signal);
    transport = new AcpJsonRpcTransport({
      input: child.input, output: child.output, onClose: listener => child.onClose(listener),
    }, 15_000);
    await expect(transport.request('test/echo', invocation.prompt)).resolves.toEqual(invocation.prompt);
  } finally {
    transport?.dispose();
    await launcher.dispose();
    requests.dispose();
    rmSync(cwd, { recursive: true, force: true });
  }
}, 90_000);
