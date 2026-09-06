import type { ImageAttachment } from '../types';
import type {
  ChatTurnRequest,
  ProjectWorkspaceTurnContext,
  VaultSearchTurnContext,
} from './types';

export interface QueuedChatTurn {
  displayContent: string;
  request: ChatTurnRequest;
}

export function cloneChatTurnRequest(request: ChatTurnRequest): ChatTurnRequest {
  return {
    ...request,
    images: cloneImages(request.images),
    externalContextPaths: request.externalContextPaths
      ? [...request.externalContextPaths]
      : undefined,
    contextFiles: request.contextFiles
      ? [...request.contextFiles]
      : undefined,
    excludedFolders: request.excludedFolders
      ? [...request.excludedFolders]
      : undefined,
    vaultSearchContext: cloneVaultSearchContext(request.vaultSearchContext),
    projectWorkspaceContext: cloneProjectWorkspaceContext(request.projectWorkspaceContext),
    enabledMcpServers: request.enabledMcpServers
      ? new Set(request.enabledMcpServers)
      : undefined,
  };
}

export function mergeQueuedChatTurns(
  existing: QueuedChatTurn,
  incoming: QueuedChatTurn,
): QueuedChatTurn {
  const existingRequest = existing.request;
  const incomingRequest = incoming.request;

  return {
    displayContent: mergeText(existing.displayContent, incoming.displayContent),
    request: {
      ...cloneChatTurnRequest(incomingRequest),
      text: mergeText(existingRequest.text, incomingRequest.text),
      images: mergeImages(existingRequest.images, incomingRequest.images),
      currentNotePath: incomingRequest.currentNotePath ?? existingRequest.currentNotePath,
      vaultSearchContext: cloneVaultSearchContext(
        incomingRequest.vaultSearchContext ?? existingRequest.vaultSearchContext,
      ),
      projectWorkspaceContext: cloneProjectWorkspaceContext(
        incomingRequest.projectWorkspaceContext ?? existingRequest.projectWorkspaceContext,
      ),
      externalContextPaths: mergeStringLists(
        existingRequest.externalContextPaths,
        incomingRequest.externalContextPaths,
      ),
      contextFiles: mergeStringLists(
        existingRequest.contextFiles,
        incomingRequest.contextFiles,
      ),
      excludedFolders: mergeStringLists(
        existingRequest.excludedFolders,
        incomingRequest.excludedFolders,
      ),
      enabledMcpServers: mergeSets(
        existingRequest.enabledMcpServers,
        incomingRequest.enabledMcpServers,
      ),
    },
  };
}

function mergeText(first: string, second: string): string {
  return [first, second]
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .join('\n\n');
}

function cloneImages(images: ImageAttachment[] | undefined): ImageAttachment[] | undefined {
  return images && images.length > 0 ? [...images] : undefined;
}

function cloneVaultSearchContext(
  context: VaultSearchTurnContext | undefined,
): VaultSearchTurnContext | undefined {
  if (!context) {
    return undefined;
  }

  return {
    query: context.query,
    snippets: context.snippets.map((snippet) => ({
      ...snippet,
      source: { ...snippet.source },
      matchedTerms: [...snippet.matchedTerms],
    })),
  };
}

function cloneProjectWorkspaceContext(
  context: ProjectWorkspaceTurnContext | undefined,
): ProjectWorkspaceTurnContext | undefined {
  if (!context) {
    return undefined;
  }

  return {
    workspace: {
      ...context.workspace,
      vaultFolders: [...context.workspace.vaultFolders],
      vaultFiles: [...context.workspace.vaultFiles],
      tags: [...context.workspace.tags],
      externalContextPaths: [...context.workspace.externalContextPaths],
    },
  };
}

function mergeImages(
  first: ImageAttachment[] | undefined,
  second: ImageAttachment[] | undefined,
): ImageAttachment[] | undefined {
  const merged = [...(first ?? []), ...(second ?? [])];
  return merged.length > 0 ? merged : undefined;
}

function mergeStringLists(
  first: string[] | undefined,
  second: string[] | undefined,
): string[] | undefined {
  const merged = [...(first ?? []), ...(second ?? [])];
  if (merged.length === 0) {
    return undefined;
  }
  return Array.from(new Set(merged));
}

function mergeSets<T>(
  first: Set<T> | undefined,
  second: Set<T> | undefined,
): Set<T> | undefined {
  const merged = new Set<T>();
  for (const value of first ?? []) {
    merged.add(value);
  }
  for (const value of second ?? []) {
    merged.add(value);
  }
  return merged.size > 0 ? merged : undefined;
}
