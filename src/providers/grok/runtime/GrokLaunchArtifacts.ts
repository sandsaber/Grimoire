import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

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
  const userConfigContent = await syncUserConfigToManagedHome({
    artifactsSubdir: params.artifactsSubdir,
    grokHomePath,
    workspaceRoot: params.workspaceRoot,
  });
  await writeIfChanged(systemPromptPath, systemPrompt);
  await writeIfChanged(managedConfigPath, configContent);

  return {
    configContent,
    grokHomePath,
    launchKey: [promptKey, configContent, userConfigContent, grokHomePath].join('::'),
    managedConfigPath,
    systemPromptPath,
  };
}

/**
 * `[ui]` keys Grimoire decides for a launch and writes into managed_config.toml.
 *
 * Grok resolves the user config layer above the managed one, so a copied config.toml
 * carrying these would decide the auxiliary process's permission mode instead of
 * `resolveGrokAuxPermissionMode`, which deliberately keeps auxiliaries at `plan`/`ask`.
 */
const GRIMOIRE_OWNED_UI_KEYS = ['permission_mode', 'yolo'] as const;

/**
 * Auxiliary Grok processes use their own GROK_HOME so that their sessions and
 * prompts stay isolated from the interactive chat.  Grok Build reads custom
 * model definitions from config.toml, however, so copy the vault-level user
 * config into each derived home.  managed_config.toml remains plugin-owned.
 *
 * A copy failure is not fatal: without it the auxiliary simply behaves as it did
 * before, and returning an empty key leaves the running process alone and retries
 * on the next launch.
 */
async function syncUserConfigToManagedHome(params: {
  artifactsSubdir?: string;
  grokHomePath: string;
  workspaceRoot: string;
}): Promise<string> {
  if (!params.artifactsSubdir) {
    return '';
  }

  const sourcePath = path.join(
    params.workspaceRoot,
    GRIMOIRE_STORAGE_PATH,
    GROK_ARTIFACTS_SUBDIR,
    'config.toml',
  );
  const destinationPath = path.join(params.grokHomePath, 'config.toml');
  if (path.resolve(sourcePath) === path.resolve(destinationPath)) {
    return '';
  }

  let source: string;
  try {
    source = await fs.readFile(sourcePath, 'utf-8');
  } catch {
    return '';
  }

  const content = stripGrimoireOwnedConfigKeys(source);
  if (content === null) {
    return '';
  }

  try {
    await writeIfChanged(destinationPath, content);
  } catch {
    return '';
  }
  return content;
}

/**
 * Returns the config to copy, or `null` when it must not be copied at all.
 *
 * The file is passed through untouched unless it actually sets one of the keys
 * Grimoire owns, so comments and formatting survive in the common case; a config
 * Grok itself could not parse is skipped rather than handed to the auxiliary.
 */
function stripGrimoireOwnedConfigKeys(source: string): string | null {
  let parsed: unknown;
  try {
    parsed = parseToml(source);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed) || !isPlainObject(parsed.ui)) {
    return source;
  }

  const ui = parsed.ui;
  if (!GRIMOIRE_OWNED_UI_KEYS.some((key) => key in ui)) {
    return source;
  }

  for (const key of GRIMOIRE_OWNED_UI_KEYS) {
    delete ui[key];
  }
  if (Object.keys(ui).length === 0) {
    delete parsed.ui;
  }

  try {
    return stringifyToml(parsed);
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
