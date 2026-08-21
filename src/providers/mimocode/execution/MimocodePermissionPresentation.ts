/**
 * How a MiMoCode permission request is described to the person answering it.
 *
 * Extracted from the legacy runtime, which now delegates to it, so the flip
 * does not produce a second opinion about what MiMoCode is asking for. Moved
 * rather than written: the words below are the ones a MiMoCode user reads
 * today, and a prompt reworded on the way through the kernel would be a change
 * to the product smuggled in as a migration.
 *
 * The vocabulary is the CLI's own — it names permissions by the tool that
 * raised them, `bash`, `edit`, `external_directory`, `doom_loop`,
 * `workflow_tool_approval` — and those ids come off the wire, so a set guessed
 * from a sibling adapter would describe the wrong action.
 */

/**
 * The tool input, as a record whatever the agent actually sent.
 *
 * Re-exported rather than repeated: it is the protocol's shape, not this
 * provider's, and the legacy runtime imports it from here.
 */
export { normalizeApprovalInput } from '@/providers/acp/execution/AcpPermissionBridge';

/** What the approval prompt says, for one permission request. */
export interface MimocodePermissionPresentation {
  readonly blockedPath?: string;
  readonly decisionReason?: string;
  readonly description: string;
  readonly toolName: string;
}

/** The prompt's words, chosen by the permission the agent raised. */
export function buildMimocodePermissionPresentation(
  rawTitle: string | null | undefined,
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
): MimocodePermissionPresentation {
  const permissionId = normalizePermissionId(rawTitle);
  const blockedPath = extractPermissionPath(input, locations);

  switch (permissionId) {
    case 'bash':
      return {
        decisionReason: 'Command execution permission required',
        description: 'MiMoCode wants to run a shell command.',
        toolName: 'bash',
      };
    case 'codesearch':
      return {
        description: 'MiMoCode wants to search indexed code outside the active buffer.',
        toolName: 'codesearch',
      };
    case 'doom_loop': {
      const repeatedTool = typeof input.tool === 'string' ? input.tool.trim() : '';
      return {
        decisionReason: 'MiMoCode detected repeated identical tool calls',
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
          ? 'MiMoCode wants to modify this file.'
          : 'MiMoCode wants to apply file changes.',
        toolName: 'edit',
      };
    case 'external_directory':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        decisionReason: 'Path is outside the session working directory',
        description: blockedPath
          ? 'MiMoCode wants to access a path outside the working directory.'
          : 'MiMoCode wants to access files outside the working directory.',
        toolName: 'External Directory',
      };
    case 'glob':
      return {
        description: 'MiMoCode wants to scan file paths with a glob pattern.',
        toolName: 'glob',
      };
    case 'grep':
      return {
        description: 'MiMoCode wants to search file contents with a pattern.',
        toolName: 'grep',
      };
    case 'lsp':
      return {
        description: 'MiMoCode wants to query language server data.',
        toolName: 'lsp',
      };
    case 'plan_enter':
      return {
        description: 'MiMoCode wants to switch this session into planning mode.',
        toolName: 'Enter Plan Mode',
      };
    case 'plan_exit':
      return {
        description: 'MiMoCode wants to leave planning mode and resume implementation.',
        toolName: 'Exit Plan Mode',
      };
    case 'question':
      return {
        description: 'MiMoCode wants to ask you a direct question before continuing.',
        toolName: 'Ask Question',
      };
    case 'read':
      return {
        ...(blockedPath ? { blockedPath } : {}),
        description: blockedPath
          ? 'MiMoCode wants to read this path.'
          : 'MiMoCode wants to read project files.',
        toolName: 'read',
      };
    case 'skill':
      return {
        description: 'MiMoCode wants to load a skill into the current session.',
        toolName: 'skill',
      };
    case 'todowrite':
      return {
        description: 'MiMoCode wants to update the shared task list.',
        toolName: 'todowrite',
      };
    case 'webfetch':
      return {
        description: 'MiMoCode wants to fetch content from a URL.',
        toolName: 'webfetch',
      };
    case 'websearch':
      return {
        description: 'MiMoCode wants to search the web.',
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
          ? `MiMoCode wants permission to use ${formatPermissionLabel(permissionId)} on this path.`
          : `MiMoCode wants permission to use ${formatPermissionLabel(permissionId)}.`,
        toolName: formatPermissionLabel(permissionId),
      };
  }
}

function normalizePermissionId(value: string | null | undefined): string {
  return value?.trim().toLowerCase() || 'tool';
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

  const locationPath = locations
    ?.map((location) => (typeof location?.path === 'string' ? location.path.trim() : ''))
    .find((path) => path.length > 0);
  return locationPath?.trim() || undefined;
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
