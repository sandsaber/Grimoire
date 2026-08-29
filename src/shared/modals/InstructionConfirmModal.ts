/**
 * Grimoire - Instruction modal
 *
 * Unified modal that handles all instruction mode states:
 * - Loading (initial processing)
 * - Clarification (agent asks question)
 * - Confirmation (final instruction review)
 */

import type { App } from 'obsidian';
import { Modal, TextAreaComponent } from 'obsidian';

import { t } from '../../i18n/i18n';

type ModalState = 'loading' | 'clarification' | 'confirmation';

export interface InstructionModalCallbacks {
  onAccept: (finalInstruction: string) => void;
  onReject: () => void;
  onClarificationSubmit: (response: string) => Promise<void>;
}

export class InstructionModal extends Modal {
  private rawInstruction: string;
  private callbacks: InstructionModalCallbacks;
  private state: ModalState = 'loading';
  private resolved = false;

  // UI elements
  private contentSectionEl: HTMLElement | null = null;
  private loadingEl: HTMLElement | null = null;
  private clarificationEl: HTMLElement | null = null;
  private confirmationEl: HTMLElement | null = null;
  private buttonsEl: HTMLElement | null = null;

  // Clarification state
  private clarificationTextEl: HTMLElement | null = null;
  private responseTextarea: TextAreaComponent | null = null;
  private isSubmitting = false;

  // Confirmation state
  private refinedInstruction: string = '';
  private editTextarea: TextAreaComponent | null = null;
  private isEditing = false;
  private refinedDisplayEl: HTMLElement | null = null;
  private editContainerEl: HTMLElement | null = null;
  private editBtnEl: HTMLButtonElement | null = null;

  constructor(
    app: App,
    rawInstruction: string,
    callbacks: InstructionModalCallbacks
  ) {
    super(app);
    this.rawInstruction = rawInstruction;
    this.callbacks = callbacks;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('grimoire-instruction-modal');
    this.setTitle(t('shared.instructionModal.title'));

    // User input section (always visible)
    const inputSection = contentEl.createDiv({ cls: 'grimoire-instruction-section' });
    const inputLabel = inputSection.createDiv({ cls: 'grimoire-instruction-label' });
    inputLabel.setText(t('shared.instructionModal.yourInput'));
    const inputText = inputSection.createDiv({ cls: 'grimoire-instruction-original' });
    inputText.setText(this.rawInstruction);

    // Main content section (changes based on state)
    this.contentSectionEl = contentEl.createDiv({ cls: 'grimoire-instruction-content-section' });

    // Loading state
    this.loadingEl = this.contentSectionEl.createDiv({ cls: 'grimoire-instruction-loading' });
    this.loadingEl.createDiv({ cls: 'grimoire-instruction-spinner' });
    this.loadingEl.createSpan({ text: t('shared.instructionModal.processingInstruction') });

    // Clarification state (hidden initially)
    this.clarificationEl = this.contentSectionEl.createDiv({ cls: 'grimoire-instruction-clarification-section' });
    this.clarificationEl.addClass('grimoire-hidden');
    this.clarificationTextEl = this.clarificationEl.createDiv({ cls: 'grimoire-instruction-clarification' });

    const responseSection = this.clarificationEl.createDiv({ cls: 'grimoire-instruction-section' });
    const responseLabel = responseSection.createDiv({ cls: 'grimoire-instruction-label' });
    responseLabel.setText(t('shared.instructionModal.yourResponse'));

    this.responseTextarea = new TextAreaComponent(responseSection);
    this.responseTextarea.inputEl.addClass('grimoire-instruction-response-textarea');
    this.responseTextarea.inputEl.rows = 3;
    this.responseTextarea.inputEl.placeholder = t('shared.instructionModal.responsePlaceholder');

    this.responseTextarea.inputEl.addEventListener('keydown', (e) => {
      // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !this.isSubmitting) {
        e.preventDefault();
        void this.submitClarification();
      }
    });

    // Confirmation state (hidden initially)
    this.confirmationEl = this.contentSectionEl.createDiv({ cls: 'grimoire-instruction-confirmation-section' });
    this.confirmationEl.addClass('grimoire-hidden');

    // Refined instruction display/edit
    const refinedSection = this.confirmationEl.createDiv({ cls: 'grimoire-instruction-section' });
    const refinedLabel = refinedSection.createDiv({ cls: 'grimoire-instruction-label' });
    refinedLabel.setText(t('shared.instructionModal.refinedSnippet'));

    this.refinedDisplayEl = refinedSection.createDiv({ cls: 'grimoire-instruction-refined' });
    this.editContainerEl = refinedSection.createDiv({ cls: 'grimoire-instruction-edit-container' });
    this.editContainerEl.addClass('grimoire-hidden');

    this.editTextarea = new TextAreaComponent(this.editContainerEl);
    this.editTextarea.inputEl.addClass('grimoire-instruction-edit-textarea');
    this.editTextarea.inputEl.rows = 4;

    // Buttons (changes based on state)
    this.buttonsEl = contentEl.createDiv({ cls: 'grimoire-instruction-buttons' });
    this.updateButtons();

    this.showState('loading');
  }

  showClarification(clarification: string) {
    if (this.clarificationTextEl) {
      this.clarificationTextEl.setText(clarification);
    }
    if (this.responseTextarea) {
      this.responseTextarea.setValue('');
    }
    this.isSubmitting = false;
    this.showState('clarification');
    this.responseTextarea?.inputEl.focus();
  }

  showConfirmation(refinedInstruction: string) {
    this.refinedInstruction = refinedInstruction;

    if (this.refinedDisplayEl) {
      this.refinedDisplayEl.setText(refinedInstruction);
    }
    if (this.editTextarea) {
      this.editTextarea.setValue(refinedInstruction);
    }

    this.showState('confirmation');
  }

  showError(error: string) {
    // Just close - the error notice will be shown by caller
    this.resolved = true;
    this.close();
  }

  showClarificationLoading() {
    this.isSubmitting = true;
    if (this.loadingEl) {
      this.loadingEl.querySelector('.grimoire-instruction-spinner');
      const text = this.loadingEl.querySelector('span');
      if (text) text.textContent = t('shared.instructionModal.processing');
    }
    this.showState('loading');
  }

  private showState(state: ModalState) {
    this.state = state;

    if (this.loadingEl) {
      this.loadingEl.toggleClass('grimoire-hidden', state !== 'loading');
    }
    if (this.clarificationEl) {
      this.clarificationEl.toggleClass('grimoire-hidden', state !== 'clarification');
    }
    if (this.confirmationEl) {
      this.confirmationEl.toggleClass('grimoire-hidden', state !== 'confirmation');
    }

    this.updateButtons();
  }

  private updateButtons() {
    if (!this.buttonsEl) return;
    this.buttonsEl.empty();

    const cancelBtn = this.buttonsEl.createEl('button', {
      text: t('common.cancel'),
      cls: 'grimoire-instruction-btn grimoire-instruction-reject-btn',
      attr: { 'aria-label': t('common.cancel') }
    });
    cancelBtn.addEventListener('click', () => this.handleReject());

    if (this.state === 'clarification') {
      const submitBtn = this.buttonsEl.createEl('button', {
        text: t('shared.instructionModal.submit'),
        cls: 'grimoire-instruction-btn grimoire-instruction-accept-btn',
        attr: { 'aria-label': t('shared.instructionModal.submitResponseAria') }
      });
      submitBtn.addEventListener('click', () => {
        void this.submitClarification();
      });
    } else if (this.state === 'confirmation') {
      this.editBtnEl = this.buttonsEl.createEl('button', {
        text: t('common.edit'),
        cls: 'grimoire-instruction-btn grimoire-instruction-edit-btn',
        attr: { 'aria-label': t('shared.instructionModal.editAria') }
      });
      this.editBtnEl.addEventListener('click', () => this.toggleEdit());

      const acceptBtn = this.buttonsEl.createEl('button', {
        text: t('shared.instructionModal.accept'),
        cls: 'grimoire-instruction-btn grimoire-instruction-accept-btn',
        attr: { 'aria-label': t('shared.instructionModal.acceptAria') }
      });
      acceptBtn.addEventListener('click', () => this.handleAccept());
      acceptBtn.focus();
    }
  }

  private async submitClarification() {
    const response = this.responseTextarea?.getValue().trim();
    if (!response || this.isSubmitting) return;

    this.showClarificationLoading();

    try {
      await this.callbacks.onClarificationSubmit(response);
    } catch {
      // On error, go back to clarification state
      this.isSubmitting = false;
      this.showState('clarification');
    }
  }

  private toggleEdit() {
    this.isEditing = !this.isEditing;

    if (this.isEditing) {
      this.refinedDisplayEl?.addClass('grimoire-hidden');
      this.editContainerEl?.removeClass('grimoire-hidden');
      if (this.editBtnEl) this.editBtnEl.setText(t('shared.instructionModal.preview'));
      this.editTextarea?.inputEl.focus();
    } else {
      const edited = this.editTextarea?.getValue() || this.refinedInstruction;
      this.refinedInstruction = edited;
      if (this.refinedDisplayEl) {
        this.refinedDisplayEl.setText(edited);
        this.refinedDisplayEl.removeClass('grimoire-hidden');
      }
      this.editContainerEl?.addClass('grimoire-hidden');
      if (this.editBtnEl) this.editBtnEl.setText(t('common.edit'));
    }
  }

  private handleAccept() {
    if (this.resolved) return;
    this.resolved = true;

    const finalInstruction = this.isEditing
      ? (this.editTextarea?.getValue() || this.refinedInstruction)
      : this.refinedInstruction;

    this.callbacks.onAccept(finalInstruction);
    this.close();
  }

  private handleReject() {
    if (this.resolved) return;
    this.resolved = true;
    this.callbacks.onReject();
    this.close();
  }

  onClose() {
    if (!this.resolved) {
      this.resolved = true;
      this.callbacks.onReject();
    }
    this.contentEl.empty();
  }
}
