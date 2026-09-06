import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getOrchestratorModeInstructions } from '../../../core/prompt/mainAgent';
import type { CollaborationMode, SkillInput, UserInput } from '../runtime/codexAppServerTypes';
import { type CodexReasoningSummary, getEffectiveCodexReasoningSummary } from '../settings';
import { DEFAULT_CODEX_PRIMARY_MODEL, FAST_TIER_CODEX_MODEL } from '../types/models';

/** An attachment as the chat surface hands it over: base64 bytes and a media type. */
export interface CodexTurnImageAttachment {
  readonly data: string;
  readonly mediaType: string;
  /** The name the user attached it under, which is `ImageAttachment.name`. */
  readonly name?: string;
}

/**
 * Where a turn's images are written before the daemon reads them.
 *
 * Injected rather than called directly so the bundle can be tested without a
 * real temp directory, and so a target that does not share this filesystem can
 * be given somewhere else to put them.
 */
export interface CodexAttachmentScratch {
  /** Creates the directory this turn's images live in, in host terms. */
  createDirectory(): string;
  writeFile(hostPath: string, data: Buffer): void;
  removeDirectory(hostPath: string): void;
}

export const nodeCodexAttachmentScratch: CodexAttachmentScratch = {
  createDirectory: () => fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-codex-images-')),
  writeFile: (hostPath, data) => {
    fs.writeFileSync(hostPath, data);
  },
  removeDirectory: hostPath => {
    try {
      fs.rmSync(hostPath, { recursive: true, force: true });
    } catch {
      // Best-effort: the turn is over, and a leftover temp directory is not
      // worth failing it for.
    }
  },
};

export interface CodexTurnInputSources {
  readonly text: string;
  readonly images?: readonly CodexTurnImageAttachment[];
  readonly skills?: readonly SkillInput[];
  /** `null` where the target cannot see the path at all. */
  toTargetPath(hostPath: string): string | null;
  readonly scratch?: CodexAttachmentScratch;
}

/**
 * The turn's content, plus the scratch directory it owns.
 *
 * `cleanup` is the caller's obligation and is safe to call more than once, so
 * an owner that disposes the bundle and a shutdown sweep that disposes whatever
 * is still registered cannot fight over it.
 */
export interface CodexTurnInputBundle {
  readonly input: UserInput[];
  cleanup(): void;
}

/**
 * What this turn carries: images, then the prompt, then the skills.
 *
 * The order is the contract. Codex reads the images as context for the text
 * that follows them, so a prompt placed first describes attachments the model
 * has not been given yet.
 *
 * An image the target cannot see is an error rather than a silent omission —
 * the alternative sends a prompt that talks about a picture that was never
 * attached, which reads as the model ignoring it.
 *
 * There is one implementation: the legacy runtime delegates here until the flip
 * deletes it, so the two paths cannot compose a turn differently.
 */
export function buildCodexTurnInput(sources: CodexTurnInputSources): CodexTurnInputBundle {
  const scratch = sources.scratch ?? nodeCodexAttachmentScratch;
  const input: UserInput[] = [];
  let directory: string | null = null;
  let discarded = false;

  const cleanup = (): void => {
    if (!directory || discarded) {
      return;
    }
    discarded = true;
    scratch.removeDirectory(directory);
  };

  try {
    const images = sources.images ?? [];
    if (images.length > 0) {
      directory = scratch.createDirectory();
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        // No bytes means no attachment: writing `Buffer.from('', 'base64')`
        // would hand Codex a zero-byte file as though it were an image.
        if (!image.mediaType.startsWith('image/') || !image.data) {
          continue;
        }

        const hostPath = path.join(directory, `${index + 1}-${toCodexAttachmentFilename(image, index)}`);
        scratch.writeFile(hostPath, Buffer.from(image.data, 'base64'));
        const targetPath = sources.toTargetPath(hostPath);
        if (!targetPath) {
          throw new Error(`Codex cannot access image attachment path from the selected target: ${hostPath}`);
        }
        input.push({ type: 'localImage', path: targetPath });
      }
    }

    if (sources.text) {
      input.push({ type: 'text', text: sources.text, text_elements: [] });
    }

    if (sources.skills && sources.skills.length > 0) {
      input.push(...sources.skills);
    }

    return { input, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function toCodexAttachmentFilename(
  attachment: CodexTurnImageAttachment,
  index: number,
): string {
  const base = (attachment.name ?? '').trim().replace(/[^A-Za-z0-9._-]/g, '_') || `image-${index + 1}`;
  if (base.includes('.')) return base;
  const subtype = attachment.mediaType.split('/')[1] ?? 'img';
  const extension = subtype === 'jpeg' ? 'jpg' : subtype;
  return `${base}.${extension}`;
}

const CODEX_EFFORT_LEVELS: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
};

/** The fast tier exists on one model; asking for it elsewhere is rejected by the daemon. */
export function resolveCodexServiceTier(serviceTier: unknown, model: string | undefined): string | null {
  if (model !== FAST_TIER_CODEX_MODEL) {
    return null;
  }
  return serviceTier === 'fast' ? 'fast' : null;
}

export interface CodexTurnParameterSources {
  /** The provider-projected settings snapshot this turn was prepared against. */
  readonly settings: Record<string, unknown>;
  readonly model: string | undefined;
  readonly orchestratorMode: boolean;
  /**
   * Whether this query already sent base instructions on a thread start or
   * resume. The orchestrator rules ride along there when it did, and repeating
   * them on the turn would state the worker-plan contract twice.
   */
  readonly baseInstructionsAlreadySent: boolean;
}

export interface CodexTurnParameters {
  readonly model: string;
  readonly effort: string;
  readonly serviceTier: string | null;
  readonly summary: CodexReasoningSummary;
  readonly collaborationMode: CollaborationMode;
}

/**
 * What this turn asks the model to be: plan mode, effort, tier, and reasoning.
 *
 * Every field here is a setting the user chose and expects to take effect on
 * the very next turn, which is why they are read per turn rather than captured
 * when the thread was started.
 */
export function buildCodexTurnParameters(sources: CodexTurnParameterSources): CodexTurnParameters {
  const model = sources.model ?? DEFAULT_CODEX_PRIMARY_MODEL;
  const effort = CODEX_EFFORT_LEVELS[sources.settings.effortLevel as string] ?? 'medium';

  return {
    model,
    effort,
    serviceTier: resolveCodexServiceTier(sources.settings.serviceTier, model),
    summary: getEffectiveCodexReasoningSummary(sources.settings, model),
    collaborationMode: {
      mode: sources.settings.permissionMode === 'plan' ? 'plan' : 'default',
      settings: {
        model,
        reasoning_effort: effort,
        developer_instructions: sources.orchestratorMode && !sources.baseInstructionsAlreadySent
          ? getOrchestratorModeInstructions()
          : null,
      },
    },
  };
}
