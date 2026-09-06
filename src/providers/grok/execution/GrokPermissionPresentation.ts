/**
 * How a Grok permission request is described to the person answering it.
 *
 * Extracted from the legacy runtime, which now delegates to it, so the flip
 * does not produce a second opinion about what Grok is asking for. The
 * vocabulary is Grok's own — it names permissions by the tool *and* the kind
 * that raised them, where OpenCode names them by the tool alone.
 */
/** What the approval prompt says, for one Grok permission request. */
export interface GrokPermissionPresentation {
  readonly blockedPath?: string;
  readonly decisionReason?: string;
  readonly description: string;
  readonly toolName: string;
}

/** The prompt's words, chosen by the permission the agent raised. */
export function buildGrokPermissionPresentation(
  rawTitle: string | null | undefined,
  rawKind: string | null | undefined,
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
): GrokPermissionPresentation {
  const permissionId = normalizePermissionId(rawTitle, rawKind);
  const blockedPath = extractPermissionPath(input, locations);

  switch (permissionId) {
    case 'bash':
      return {
        decisionReason: 'Command execution permission required',
        description: 'Grok Build wants to run a shell command.',
        toolName: 'bash',
      };
    case 'codesearch':
      return {
        description: 'Grok Build wants to search indexed code outside the active buffer.',
        toolName: 'codesearch',
      };
    case 'doom_loop': {
      const repeatedTool = typeof input.tool === 'string' ? input.tool.trim() : '';
      return {
        decisionReason: 'Grok detected repeated identical tool calls',
        description: repeatedTool
          ? `Allow another repeated \`${repeatedTool}\` call.`
          : 'Allow another repeated tool call.',
        toolName: 'Doom Loop Guard',
      };
    }
    case 'edit':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        decisionReason: 'File write permission required',
        description: blockedPath
          ? 'Grok Build wants to modify this file.'
          : 'Grok Build wants to apply file changes.',
        toolName: 'edit',
      };
    case 'external_directory':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        decisionReason: 'Path is outside the session working directory',
        description: blockedPath
          ? 'Grok Build wants to access a path outside the working directory.'
          : 'Grok Build wants to access files outside the working directory.',
        toolName: 'External Directory',
      };
    case 'glob':
      return {
        description: 'Grok Build wants to scan file paths with a glob pattern.',
        toolName: 'glob',
      };
    case 'grep':
      return {
        description: 'Grok Build wants to search file contents with a pattern.',
        toolName: 'grep',
      };
    case 'lsp':
      return {
        description: 'Grok Build wants to query language server data.',
        toolName: 'lsp',
      };
    case 'plan_enter':
      return {
        description: 'Grok Build wants to switch this session into planning mode.',
        toolName: 'Enter Plan Mode',
      };
    case 'plan_exit':
      return {
        description: 'Grok Build wants to leave planning mode and resume implementation.',
        toolName: 'Exit Plan Mode',
      };
    case 'question':
      return {
        description: 'Grok Build wants to ask you a direct question before continuing.',
        toolName: 'Ask Question',
      };
    case 'read':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        description: blockedPath
          ? 'Grok Build wants to read this path.'
          : 'Grok Build wants to read project files.',
        toolName: 'read',
      };
    case 'skill':
      return {
        description: 'Grok Build wants to load a skill into the current session.',
        toolName: 'skill',
      };
    case 'todowrite':
      return {
        description: 'Grok Build wants to update the shared task list.',
        toolName: 'todowrite',
      };
    case 'webfetch':
      return {
        description: 'Grok Build wants to fetch content from a URL.',
        toolName: 'webfetch',
      };
    case 'websearch':
      return {
        description: 'Grok Build wants to search the web.',
        toolName: 'websearch',
      };
    case 'workflow_tool_approval': {
      const summary = summarizeWorkflowTools(input);
      return {
        decisionReason: 'Session-level workflow approval requested',
        description: summary
          ? `Pre-approve workflow tools for this session: ${summary}.`
          : 'Pre-approve workflow tools for this session.',
        toolName: 'Workflow Approval',
      };
    }
    default:
      return {
        ...(blockedPath ? { blockedPath } : {}),
        description: blockedPath
          ? `Grok wants permission to use ${formatPermissionLabel(permissionId)} on this path.`
          : `Grok wants permission to use ${formatPermissionLabel(permissionId)}.`,
        toolName: formatPermissionLabel(permissionId),
      };
  }
}

function normalizePermissionId(
  value: string | null | undefined,
  rawKind?: string | null,
): string {
  const kind = rawKind?.trim().toLowerCase();
  if (kind === 'execute') return 'bash';
  if (kind === 'read' || kind === 'edit' || kind === 'search' || kind === 'fetch') return kind;

  const normalized = value?.trim().toLowerCase() || 'tool';
  if (/^(?:execute|run)(?:\s|$)/u.test(normalized)) return 'bash';
  return normalized;
}

function extractPermissionPath(
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
): string | undefined {
  const candidateKeys = ['filepath', 'filePath', 'path', 'parentDir'];
  for (const key of candidateKeys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  for (const location of locations ?? []) {
    if (typeof location?.path === 'string') {
      const trimmed = location.path.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return undefined;
}

function summarizeWorkflowTools(input: Record<string, unknown>): string {
  const tools = Array.isArray(input.tools) ? input.tools : [];
  const names = tools.flatMap((tool) => {
    if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
      return [];
    }

    const entry = tool as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) {
      return [];
    }

    let title = '';
    if (typeof entry.args === 'string') {
      try {
        const parsedArgs = JSON.parse(entry.args) as Record<string, unknown>;
        title = typeof parsedArgs.title === 'string'
          ? parsedArgs.title.trim()
          : typeof parsedArgs.name === 'string'
          ? parsedArgs.name.trim()
          : '';
      } catch {
        title = '';
      }
    }

    return [title ? `${name}: ${title}` : name];
  });

  if (names.length === 0) {
    return '';
  }

  if (names.length <= 3) {
    return names.join(', ');
  }

  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
}

function formatPermissionLabel(permissionId: string): string {
  return permissionId
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}
