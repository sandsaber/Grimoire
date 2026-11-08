import { execFileSync } from 'node:child_process';

import {
  windowsDirectProcessArguments,
  windowsJobGuardianPreamble,
} from '@/app/execution/local/NodeLocalShellProcessAdapter';

const describeWindows = process.platform === 'win32' ? describe : describe.skip;

describeWindows('Windows job guardian byte transport', () => {
  it.each([
    ['empty input', Buffer.alloc(0)],
    ['UTF-8 JSONL', Buffer.from('{"id":1,"method":"ping","text":"Tere, 世界"}\n', 'utf8')],
    ['caller BOM and opaque bytes', Buffer.from([239, 187, 191, 0, 255, 10, 128])],
  ])('passes %s and EOF without an injected BOM or transcoding', (_label, input) => {
    const childSource = [
      'const chunks = [];',
      'process.stdin.on("data", chunk => chunks.push(chunk));',
      'process.stdin.on("end", () => process.stdout.write(Buffer.concat(chunks).toString("base64")));',
    ].join('\n');
    const argumentsValue = windowsDirectProcessArguments(['-e', childSource]);
    const quotePowerShell = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const script = [
      ...windowsJobGuardianPreamble(null),
      // Force the failure regardless of the machine's locale: Framework's
      // Process.Start would write FF FE before even accessing StandardInput.
      // LE Unicode is also valid when windowsHide leaves no attached console.
      '[Console]::InputEncoding = New-Object System.Text.UnicodeEncoding($false,$true)',
      `$exitCode=[GrimoireJobGuardian]::Run(${quotePowerShell(process.execPath)},${quotePowerShell(argumentsValue)},$true)`,
      'exit $exitCode',
    ].join('\r\n');

    const output = execFileSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ], { input, windowsHide: true, timeout: 30_000, stdio: ['pipe', 'pipe', 'pipe'] });

    expect(output.toString('ascii')).toBe(input.toString('base64'));
  }, 35_000);
});
