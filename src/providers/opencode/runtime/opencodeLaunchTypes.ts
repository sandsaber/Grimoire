import type { OpencodeInstallationMethod } from '../settings';

export type OpencodeExecutionMethod = 'host-native' | OpencodeInstallationMethod;
export type OpencodeExecutionPlatformOs = 'windows' | 'linux' | 'macos';
export type OpencodeExecutionPlatformFamily = 'windows' | 'unix';
export type OpencodeWslHostFlavor = 'wsl$' | 'wsl.localhost';

export interface OpencodeExecutionTarget {
  method: OpencodeExecutionMethod;
  platformFamily: OpencodeExecutionPlatformFamily;
  platformOs: OpencodeExecutionPlatformOs;
  distroName?: string;
  wslHostFlavor?: OpencodeWslHostFlavor;
}

export interface OpencodePathMapper {
  target: OpencodeExecutionTarget;
  toTargetPath(hostPath: string): string | null;
  toHostPath(targetPath: string): string | null;
  canRepresentHostPath(hostPath: string): boolean;
}

export interface OpencodeLaunchSpec {
  target: OpencodeExecutionTarget;
  command: string;
  args: string[];
  spawnCwd: string;
  targetCwd: string;
  env: NodeJS.ProcessEnv;
  pathMapper: OpencodePathMapper;
  /** Whether the command must be spawned through a shell. Overrides AcpSubprocess's
   * Windows relative-command heuristic (e.g. wsl.exe must be spawned directly). */
  shell?: boolean;
}
