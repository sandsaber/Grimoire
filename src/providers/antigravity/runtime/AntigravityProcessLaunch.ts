export interface AntigravityProcessLaunch {
  args: string[];
  command: string;
  launchMode: 'direct' | 'shellLogin';
  shell: boolean;
}

export function buildAntigravityProcessLaunch(
  command: string,
  args: string[],
  runtimeEnv: NodeJS.ProcessEnv,
): AntigravityProcessLaunch {
  if (process.platform === 'win32') {
    if (canLaunchDirectlyOnWindows(command)) {
      return {
        args,
        command,
        launchMode: 'direct',
        shell: false,
      };
    }

    return {
      args,
      command,
      launchMode: 'direct',
      shell: true,
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

function canLaunchDirectlyOnWindows(command: string): boolean {
  const lowerCommand = command.toLowerCase();
  return lowerCommand.endsWith('.exe');
}

function resolveUserShell(runtimeEnv: NodeJS.ProcessEnv): string | null {
  const shellCommand = (runtimeEnv.SHELL ?? process.env.SHELL ?? '').trim();
  return shellCommand || null;
}
