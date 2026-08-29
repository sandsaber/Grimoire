export interface AntigravityPrintArgsSpec {
  /** The vault root, when the CLI advertises the flag that admits it. */
  readonly addDirPath?: string | null;
  readonly capabilities?: {
    readonly addDir: boolean;
    readonly printTimeout: boolean;
    readonly streamJson: boolean;
  };
  readonly logFilePath?: string;
  readonly model: string | null;
  readonly permissionMode: string;
  readonly prompt: string;
}

/**
 * How long `agy` is told to give itself, just under Grimoire's own ceiling.
 *
 * The CLI self-terminating with a structured result is a better ending than
 * being killed from outside, and it can only do that if it is told to stop
 * first. Paired with the backend's absolute ceiling — thirty minutes — and
 * only sent when `--print-timeout` is advertised (#70).
 */
export const ANTIGRAVITY_PRINT_TIMEOUT_FLAG_VALUE = '29m';

export function buildAntigravityPrintArgs(spec: AntigravityPrintArgsSpec): string[] {
  const args: string[] = [];
  if (spec.permissionMode === 'full_access') {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--sandbox');
  }
  // Before `--print`, and only when the CLI says it knows the flag: an older
  // build treats an unknown flag as an argument and the run fails on it. The
  // vault has to be added explicitly because `agy` scopes its workspace to what
  // it was told about, not to the directory it was started in (#67).
  if (spec.capabilities?.addDir && spec.addDirPath) {
    args.push('--add-dir', spec.addDirPath);
  }
  if (spec.logFilePath) {
    args.push('--log-file', spec.logFilePath);
  }
  if (spec.model) {
    args.push('--model', spec.model);
  }
  args.push('--print', spec.prompt);
  return args;
}
