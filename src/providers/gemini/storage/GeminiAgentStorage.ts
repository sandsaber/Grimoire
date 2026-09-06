import * as path from 'node:path';

import type { VaultFileAdapter } from '../../../core/storage/VaultFileAdapter';
import { isRecord } from '../../../utils/records';
import { dumpYamlFrontmatter, loadYamlFrontmatter } from '../../../utils/yamlFrontmatter';
import type { GeminiAgentDefinition } from '../types/agent';

export const GEMINI_AGENTS_PATH = '.gemini/agents';
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const KNOWN_KEYS = new Set([
  'name',
  'description',
  'kind',
  'tools',
  'mcpServers',
  'model',
  'temperature',
  'max_turns',
  'timeout_mins',
]);

type GeminiAgentStorageAdapter = Pick<
  VaultFileAdapter,
  'delete' | 'ensureFolder' | 'exists' | 'listFiles' | 'read' | 'write'
>;

export class GeminiAgentStorage {
  constructor(private readonly adapter: GeminiAgentStorageAdapter) {}

  async loadAll(): Promise<GeminiAgentDefinition[]> {
    let files: string[];
    try {
      files = await this.adapter.listFiles(GEMINI_AGENTS_PATH);
    } catch {
      return [];
    }
    const agents: GeminiAgentDefinition[] = [];
    for (const filePath of files.sort()) {
      if (!filePath.endsWith('.md')) continue;
      try {
        const agent = parseGeminiAgentMarkdown(await this.adapter.read(filePath), filePath);
        if (agent) agents.push(agent);
      } catch {
        // Skip a malformed or unreadable agent without hiding valid siblings.
      }
    }
    return agents;
  }

  async load(agent: GeminiAgentDefinition): Promise<GeminiAgentDefinition | null> {
    const filePath = this.currentPath(agent);
    try {
      if (!(await this.adapter.exists(filePath))) return null;
      return parseGeminiAgentMarkdown(await this.adapter.read(filePath), filePath);
    } catch {
      return null;
    }
  }

  async save(
    agent: GeminiAgentDefinition,
    previous?: GeminiAgentDefinition | null,
  ): Promise<void> {
    validateGeminiAgentName(agent.name);
    const targetPath = `${GEMINI_AGENTS_PATH}/${agent.name}.md`;
    const previousPath = previous ? this.currentPath(previous) : agent.filePath ?? null;
    if ((!previousPath || previousPath !== targetPath) && await this.adapter.exists(targetPath)) {
      throw new Error(`A Gemini agent already exists at ${targetPath}.`);
    }
    await this.adapter.ensureFolder(path.posix.dirname(targetPath));
    await this.adapter.write(targetPath, serializeGeminiAgentMarkdown(agent));
    if (previousPath && previousPath !== targetPath) {
      await this.adapter.delete(previousPath);
    }
  }

  async delete(agent: GeminiAgentDefinition): Promise<void> {
    await this.adapter.delete(this.currentPath(agent));
  }

  private currentPath(agent: GeminiAgentDefinition): string {
    return agent.filePath ?? `${GEMINI_AGENTS_PATH}/${agent.name}.md`;
  }
}

export function parseGeminiAgentMarkdown(
  content: string,
  filePath: string,
): GeminiAgentDefinition | null {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) return null;
  let frontmatter: Record<string, unknown>;
  try {
    const parsed: unknown = loadYamlFrontmatter(match[1]);
    if (!isRecord(parsed)) return null;
    frontmatter = parsed;
  } catch {
    return null;
  }
  const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
  const description = typeof frontmatter.description === 'string'
    ? frontmatter.description.trim()
    : '';
  const prompt = match[2].trim();
  if (!name || !description || !prompt) return null;

  const agent: GeminiAgentDefinition = {
    id: name,
    name,
    description,
    prompt,
    source: 'vault',
    filePath,
    persistenceKey: `gemini-agent:${encodeURIComponent(filePath)}`,
  };
  if (frontmatter.kind === 'local' || frontmatter.kind === 'remote') agent.kind = frontmatter.kind;
  if (Array.isArray(frontmatter.tools)) {
    const tools = frontmatter.tools.filter((value): value is string => typeof value === 'string');
    if (tools.length > 0) agent.tools = tools;
  }
  if (typeof frontmatter.model === 'string') agent.model = frontmatter.model;
  if (typeof frontmatter.temperature === 'number' && Number.isFinite(frontmatter.temperature)) {
    agent.temperature = frontmatter.temperature;
  }
  if (typeof frontmatter.max_turns === 'number' && Number.isInteger(frontmatter.max_turns)) {
    agent.maxTurns = frontmatter.max_turns;
  }
  if (typeof frontmatter.timeout_mins === 'number' && Number.isFinite(frontmatter.timeout_mins)) {
    agent.timeoutMins = frontmatter.timeout_mins;
  }
  if (isRecord(frontmatter.mcpServers)) agent.mcpServers = frontmatter.mcpServers;

  const extraFrontmatter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!KNOWN_KEYS.has(key)) extraFrontmatter[key] = value;
  }
  if (Object.keys(extraFrontmatter).length > 0) agent.extraFrontmatter = extraFrontmatter;
  return agent;
}

export function serializeGeminiAgentMarkdown(agent: GeminiAgentDefinition): string {
  const frontmatter: Record<string, unknown> = {
    ...(agent.extraFrontmatter ?? {}),
    name: agent.name,
    description: agent.description,
  };
  if (agent.kind) frontmatter.kind = agent.kind;
  if (agent.tools?.length) frontmatter.tools = agent.tools;
  if (agent.mcpServers) frontmatter.mcpServers = agent.mcpServers;
  if (agent.model) frontmatter.model = agent.model;
  if (agent.temperature !== undefined) frontmatter.temperature = agent.temperature;
  if (agent.maxTurns !== undefined) frontmatter.max_turns = agent.maxTurns;
  if (agent.timeoutMins !== undefined) frontmatter.timeout_mins = agent.timeoutMins;
  const yaml = dumpYamlFrontmatter(frontmatter);
  return `---\n${yaml}\n---\n\n${agent.prompt.trimEnd()}\n`;
}

export function validateGeminiAgentName(name: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
    throw new Error('Gemini agent names use lowercase letters, numbers, hyphens, and underscores.');
  }
}

