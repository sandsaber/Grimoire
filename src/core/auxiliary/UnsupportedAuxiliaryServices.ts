import type {
  InlineEditRequest,
  InlineEditResult,
  InlineEditService,
  InstructionRefineService,
  RefineProgressCallback,
  TitleGenerationCallback,
  TitleGenerationService,
} from '../providers/types';
import type { InstructionRefineResult } from '../types';

/**
 * What a provider with no auxiliary source answers.
 *
 * Three providers shipped a file of these each — nine classes, identical but
 * for a provider name in one string — and every one of them was reachable only
 * because the registration required something in the slot. The absence is the
 * statement now; this is the host saying it in the provider's own words, once.
 *
 * It still *answers*, rather than throwing or returning nothing: the caller is
 * a title callback, a refine modal and an inline-edit modal, and all three show
 * the error to the user. Silence is the failure this migration removes.
 */

export function unsupportedAuxiliaryMessage(displayName: string): string {
  return `${displayName} auxiliary tasks are not implemented yet.`;
}

export class UnsupportedTitleGenerationService implements TitleGenerationService {
  constructor(private readonly displayName: string) {}

  async generateTitle(
    conversationId: string,
    _userMessage: string,
    callback: TitleGenerationCallback,
  ): Promise<void> {
    await callback(conversationId, {
      success: false,
      error: unsupportedAuxiliaryMessage(this.displayName),
    });
  }

  cancel(): void {}
}

export class UnsupportedInstructionRefineService implements InstructionRefineService {
  constructor(private readonly displayName: string) {}

  setModelOverride(_model?: string): void {}

  resetConversation(): void {}

  async refineInstruction(
    _rawInstruction: string,
    _existingInstructions: string,
    _onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    return { success: false, error: unsupportedAuxiliaryMessage(this.displayName) };
  }

  async continueConversation(
    _message: string,
    _onProgress?: RefineProgressCallback,
  ): Promise<InstructionRefineResult> {
    return { success: false, error: unsupportedAuxiliaryMessage(this.displayName) };
  }

  cancel(): void {}
}

export class UnsupportedInlineEditService implements InlineEditService {
  constructor(private readonly displayName: string) {}

  setModelOverride(_model?: string): void {}

  resetConversation(): void {}

  async editText(_request: InlineEditRequest): Promise<InlineEditResult> {
    return { success: false, error: unsupportedAuxiliaryMessage(this.displayName) };
  }

  async continueConversation(
    _message: string,
    _contextFiles?: string[],
  ): Promise<InlineEditResult> {
    return { success: false, error: unsupportedAuxiliaryMessage(this.displayName) };
  }

  cancel(): void {}
}
