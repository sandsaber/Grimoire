import type { ExecutionInteractionPresentation } from '../../../app/runtime/ExecutionInteractionPresentationStore';
import type { InteractionProjection } from '../projections/ChatProjection';

/**
 * Renders open execution interactions so the user can answer them.
 *
 * The durable interaction record carries only a content-addressed
 * `presentationRef`; the readable title, description, and answer options live
 * in display-only presentation storage. Provider-specific detail is normalized
 * away by each provider's interaction bridge on purpose, so this renderer is
 * provider-neutral and all user-visible copy comes from the presentation.
 *
 * It owns presentation only. Selecting an option calls back to the view, which
 * submits the resolution through the runtime; the renderer never resolves an
 * interaction itself.
 */

export interface InteractionPromptModel {
  readonly interaction: InteractionProjection;
  readonly presentation: ExecutionInteractionPresentation;
}

export interface InteractionPromptCallbacks {
  onRespond(interactionId: string, responseId: string): void;
}

/** Interactions the user can still act on. */
export function isAnswerable(interaction: InteractionProjection): boolean {
  return interaction.status === 'open';
}

/** True while a response has been submitted but not yet confirmed. */
function isSettling(interaction: InteractionProjection): boolean {
  return interaction.status === 'resolving' || interaction.status === 'cancelling';
}

export class InteractionPromptRenderer {
  constructor(
    private readonly containerEl: HTMLElement,
    private readonly callbacks: InteractionPromptCallbacks,
  ) {}

  /**
   * Replaces the rendered prompts with `models`. Rendering is a full replace so
   * a resolved interaction cannot linger after the projection drops it.
   */
  render(models: readonly InteractionPromptModel[]): void {
    this.containerEl.empty();
    if (models.length === 0) {
      this.containerEl.addClass('is-empty');
    } else {
      this.containerEl.removeClass('is-empty');
    }
    for (const model of models) {
      this.renderPrompt(model);
    }
  }

  private renderPrompt(model: InteractionPromptModel): void {
    const { interaction, presentation } = model;
    const rootEl = this.containerEl.createDiv({
      cls: `grimoire-interaction grimoire-interaction--${presentation.kind}`,
    });
    rootEl.setAttribute('role', 'group');
    rootEl.setAttribute('data-interaction-id', interaction.interactionId);

    rootEl.createDiv({ cls: 'grimoire-interaction-title', text: presentation.title });
    if (presentation.description) {
      rootEl.createDiv({
        cls: 'grimoire-interaction-description',
        text: presentation.description,
      });
    }

    const settling = isSettling(interaction);
    const optionsEl = rootEl.createDiv({ cls: 'grimoire-interaction-options' });
    for (const option of presentation.options) {
      const buttonEl = optionsEl.createEl('button', {
        cls: 'grimoire-interaction-option',
        text: option.label,
      });
      if (option.description) {
        buttonEl.setAttribute('aria-label', `${option.label}: ${option.description}`);
        buttonEl.setAttribute('title', option.description);
      }
      // A settled or settling interaction keeps its options visible for context
      // but cannot accept a second answer.
      buttonEl.disabled = settling || !isAnswerable(interaction);
      if (interaction.selectedResponseId === option.responseId) {
        buttonEl.addClass('is-selected');
      }
      buttonEl.addEventListener('click', () => {
        if (buttonEl.disabled) return;
        this.callbacks.onRespond(interaction.interactionId, option.responseId);
      });
    }
  }
}
