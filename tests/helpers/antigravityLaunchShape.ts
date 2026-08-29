/**
 * Launch-shape normalization for the Antigravity fixtures.
 *
 * `buildAntigravityProcessLaunch` hands the CLI to the OS in three different
 * shapes (POSIX login shell, Windows `cmd.exe` wrapper, direct exec), so a
 * fixture that reads the spawn arguments literally asserts the host's
 * process-launch convention instead of the behavior under test. Normalizing
 * back to the agy arguments keeps the assertions platform-independent.
 *
 * Shared between the Antigravity suites; `launch-shape normalization helpers`
 * in `AntigravityChatRuntime.test.ts` pins both functions against the real
 * producer (`buildWindowsShellCommandLine` / `buildAntigravityProcessLaunch`).
 */

/**
 * Invert the quoting `buildWindowsShellCommandLine` applies, so assertions can
 * read the agy flags out of a `cmd.exe /d /s /c "<line>"` launch the same way
 * they read them out of a POSIX one. Kept lossless for every argument shape
 * the launch builder can emit.
 */
export function parseWindowsShellCommandLine(line: string): string[] {
  const parsed: string[] = [];
  let current = '';
  let quoted = false;
  let started = false;
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === '\\') {
      let backslashes = 0;
      while (line[index] === '\\') {
        backslashes += 1;
        index += 1;
      }
      // quoteWindowsArgument doubles the run that precedes a quote or the
      // closing quote; every other run reaches the child verbatim.
      const wasDoubled = line[index] === '"';
      current += '\\'.repeat(wasDoubled ? Math.floor(backslashes / 2) : backslashes);
      started = true;
      continue;
    }
    index += 1;
    if (char === '"') {
      if (quoted && line[index] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      started = true;
      continue;
    }
    if (char === ' ' && !quoted) {
      if (started) {
        parsed.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (started) {
    parsed.push(current);
  }
  return parsed;
}

/**
 * Normalizes every launch shape `buildAntigravityProcessLaunch` can produce
 * (POSIX login shell, Windows cmd.exe wrapper, direct exec) back to the agy
 * arguments themselves, so the fixtures assert behavior instead of the host
 * platform's process-launch convention.
 */
export function toAgyArgs(spawnArgs: string[]): string[] {
  if (spawnArgs[0] === '-lc' && spawnArgs[1] === 'exec "$0" "$@"') {
    return spawnArgs.slice(3);
  }
  if (spawnArgs[0] === '/d' && spawnArgs[1] === '/s' && spawnArgs[2] === '/c') {
    return parseWindowsShellCommandLine(spawnArgs[3] ?? '').slice(1);
  }
  return spawnArgs;
}
