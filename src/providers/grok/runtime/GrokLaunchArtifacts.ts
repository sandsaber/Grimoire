import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { GRIMOIRE_STORAGE_PATH } from '../../../core/bootstrap/StoragePaths';
import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptSettings,
} from '../../../core/prompt/mainAgent';
import type { GrokPermissionMode } from '../modes';
import { GROK_ARTIFACTS_SUBDIR } from './GrokPaths';

export interface GrokLaunchArtifacts {
  configContent: string;
  grokHomePath: string;
  launchKey: string;
  managedConfigPath: string;
  systemPromptPath: string;
}

export interface PrepareGrokLaunchArtifactsParams {
  artifactsSubdir?: string;
  defaultModel?: string | null;
  permissionMode?: GrokPermissionMode;
  settings?: SystemPromptSettings;
  systemPromptKey?: string;
  systemPromptText?: string;
  workspaceRoot: string;
}

export async function prepareGrokLaunchArtifacts(
  params: PrepareGrokLaunchArtifactsParams,
): Promise<GrokLaunchArtifacts> {
  const grokHomePath = path.join(
    params.workspaceRoot,
    GRIMOIRE_STORAGE_PATH,
    params.artifactsSubdir ?? GROK_ARTIFACTS_SUBDIR,
  );
  const systemPromptPath = path.join(grokHomePath, 'system.md');
  const managedConfigPath = path.join(grokHomePath, 'managed_config.toml');
  const systemPrompt = normalizeSystemPrompt(
    params.systemPromptText ?? buildSystemPrompt(requireSettings(params)),
  );
  const promptKey = params.systemPromptKey
    ?? (params.systemPromptText !== undefined
      ? params.systemPromptText
      : computeSystemPromptKey(requireSettings(params)));
  const configContent = buildGrokManagedConfigToml({
    defaultModel: params.defaultModel,
    permissionMode: params.permissionMode,
  });

  await fs.mkdir(grokHomePath, { recursive: true });
  await writeIfChanged(systemPromptPath, systemPrompt);
  await writeIfChanged(managedConfigPath, configContent);

  return {
    configContent,
    grokHomePath,
    launchKey: [promptKey, configContent, grokHomePath].join('::'),
    managedConfigPath,
    systemPromptPath,
  };
}

/**
 * What an auxiliary Grok turn is launched as.
 *
 * The two profiles the three auxiliary purposes divide into, and the difference
 * is reading files: an inline edit reads the note around what it is editing,
 * while a title and a refinement are given everything they need in the prompt.
 *
 * It lives beside the artifacts rather than beside a runner because for this
 * provider **the launch is the policy**. The OpenCode forks write an agent
 * definition whose permissions deny writing and set the session to it; Grok has
 * no such definition — what an auxiliary turn may do is the `permission_mode`
 * this file writes into the managed config, so the mapping belongs where the
 * config is written.
 */
export type GrokAuxiliaryProfile = 'passive' | 'readonly';

/**
 * The permission mode each profile launches under.
 *
 * `ask` rather than a deny-everything mode for the reading profile because Grok
 * has no deny-everything mode: `ask` sends the decision to the client, which
 * refuses it. `plan` for the profile that needs no tools at all, which is what
 * the CLI offers for a turn that should only think.
 */
export function resolveGrokAuxiliaryPermissionMode(
  profile: GrokAuxiliaryProfile,
): GrokPermissionMode {
  return profile === 'readonly' ? 'ask' : 'plan';
}

interface BuildGrokManagedConfigTomlParams {
  defaultModel?: string | null;
  permissionMode?: GrokPermissionMode;
}

export function buildGrokManagedConfigToml(
  params: BuildGrokManagedConfigTomlParams = {},
): string {
  const permissionMode = params.permissionMode ?? 'ask';
  const defaultModel = params.defaultModel?.trim();
  const lines = [
    '# Grimoire-managed Grok Build configuration',
    '',
    '[ui]',
    `permission_mode = "${permissionMode}"`,
    '',
  ];
  if (defaultModel) {
    lines.push('[models]', `default = "${defaultModel}"`, '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

async function writeIfChanged(filePath: string, content: string): Promise<void> {
  try {
    const existing = await fs.readFile(filePath, 'utf-8');
    if (existing === content) {
      return;
    }
  } catch {
    // Missing file; write below.
  }

  await fs.writeFile(filePath, content, 'utf-8');
}

function normalizeSystemPrompt(systemPrompt: string): string {
  return systemPrompt.endsWith('\n') ? systemPrompt : `${systemPrompt}\n`;
}

function requireSettings(
  params: PrepareGrokLaunchArtifactsParams,
): SystemPromptSettings {
  if (params.settings) {
    return params.settings;
  }

  throw new Error('prepareGrokLaunchArtifacts requires settings when no systemPromptText is provided');
}
