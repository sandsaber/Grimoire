export interface AntigravityPrintArgsSpec {
  readonly logFilePath?: string;
  readonly model: string | null;
  readonly permissionMode: string;
  readonly prompt: string;
}

export function buildAntigravityPrintArgs(spec: AntigravityPrintArgsSpec): string[] {
  const args: string[] = [];
  if (spec.permissionMode === 'full_access') {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--sandbox');
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
