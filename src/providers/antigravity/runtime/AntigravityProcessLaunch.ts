export interface AntigravityProcessLaunch {
  args: string[];
  command: string;
  launchMode: 'direct' | 'shellLogin' | 'cmdShell';
  shell: boolean;
}

export function buildAntigravityProcessLaunch(
  command: string,
  args: string[],
  runtimeEnv: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): AntigravityProcessLaunch {
  if (platform === 'win32') {
    if (canLaunchDirectlyOnWindows(command)) {
      return {
        args,
        command,
        launchMode: 'direct',
        shell: false,
      };
    }

    // .cmd/.bat launchers and bare command names must be interpreted by
    // cmd.exe, but Node's `shell: true` concatenates the command line without
    // per-argument quoting, letting prompt content break out of its argument
    // (#59). Quote everything ourselves and spawn cmd.exe directly instead.
    return {
      args: ['/d', '/s', '/c', buildWindowsShellCommandLine(command, args)],
      command: 'cmd.exe',
      launchMode: 'cmdShell',
      shell: false,
    };
  }

  const shellCommand = resolveUserShell(runtimeEnv);
  const forwarding = shellCommand ? argumentForwarding(shellCommand) : null;
  if (!shellCommand || !forwarding) {
    return {
      args,
      command,
      launchMode: 'direct',
      shell: false,
    };
  }

  return {
    args: ['-lc', forwarding, command, ...args],
    command: shellCommand,
    launchMode: 'shellLogin',
    shell: false,
  };
}

/**
 * How this shell re-executes the arguments it was handed.
 *
 * The login shell exists to pick up the user's profile, and the arguments are
 * passed separately rather than interpolated so a prompt containing `&&` or a
 * quote cannot become shell syntax. That forwarding expression is not portable:
 * fish has no `$0` or `$@` and rejects them outright — `$@ is not supported. In
 * fish, please use $argv.` — so the CLI never runs and the launch exits 127.
 *
 * `null` means the shell's syntax is unknown, and the caller launches directly
 * rather than guessing. Losing the profile is a smaller loss than a provider
 * that cannot start.
 */
function argumentForwarding(shellCommand: string): string | null {
  const shellName = shellCommand.split('/').pop() ?? shellCommand;
  if (shellName === 'fish') {
    return 'exec $argv';
  }
  return POSIX_SHELLS.has(shellName) ? 'exec "$0" "$@"' : null;
}

/** Shells known to expand `$0` and `$@` the POSIX way. */
const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ksh93', 'mksh', 'ash', 'busybox']);

/**
 * Build the command line passed to `cmd.exe /d /s /c` for non-`.exe`
 * launchers. Each element is quoted so cmd.exe treats metacharacters
 * (`& | < > ^`) as literals and never re-parses argument boundaries.
 */
export function buildWindowsShellCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteWindowsArgument).join(' ');
}

function quoteWindowsArgument(value: string): string {
  // Double backslashes that precede a quote or the closing quote so the
  // child's argv parser keeps them, and double internal quotes so cmd.exe's
  // quote state stays balanced while the child receives a literal quote.
  // `%` expansion remains a cmd.exe limitation and cannot be escaped here.
  const prepared = value
    .replace(/(\\*)"/g, '$1$1""')
    .replace(/(\\+)$/, '$1$1');
  return `"${prepared}"`;
}

function canLaunchDirectlyOnWindows(command: string): boolean {
  const lowerCommand = command.toLowerCase();
  return lowerCommand.endsWith('.exe');
}

function resolveUserShell(runtimeEnv: NodeJS.ProcessEnv): string | null {
  const shellCommand = (runtimeEnv.SHELL ?? process.env.SHELL ?? '').trim();
  return shellCommand || null;
}
