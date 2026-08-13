import { createMockEl } from '@test/helpers/mockElement';

import type { ExecutionInteractionPresentation } from '@/app/runtime/ExecutionInteractionPresentationStore';
import type { InteractionProjection } from '@/features/chat/projections/ChatProjection';
import type { InteractionPromptModel } from '@/features/chat/rendering/InteractionPromptRenderer';
import {
  InteractionPromptRenderer,
  isAnswerable,
} from '@/features/chat/rendering/InteractionPromptRenderer';

function presentation(
  overrides: Partial<ExecutionInteractionPresentation> = {},
): ExecutionInteractionPresentation {
  return {
    presentationRef: 'pres-1',
    kind: 'approval',
    title: 'Allow Bash to run?',
    description: 'rm -rf build',
    options: [
      { responseId: 'allow', label: 'Allow', description: 'Run once' },
      { responseId: 'reject', label: 'Reject' },
    ],
    ...overrides,
  };
}

function interaction(
  overrides: Partial<InteractionProjection> = {},
): InteractionProjection {
  return {
    interactionId: 'ix-1',
    runId: 'run-1',
    kind: 'approval',
    presentationRef: 'pres-1',
    responseIds: ['allow', 'reject'],
    status: 'open',
    updatedAt: 1,
    ...overrides,
  };
}

function model(overrides: Partial<InteractionPromptModel> = {}): InteractionPromptModel {
  return { interaction: interaction(), presentation: presentation(), ...overrides };
}

describe('isAnswerable', () => {
  it('accepts only open interactions', () => {
    expect(isAnswerable(interaction({ status: 'open' }))).toBe(true);
    for (const status of ['resolving', 'cancelling', 'resolved', 'cancelled', 'expired'] as const) {
      expect(isAnswerable(interaction({ status }))).toBe(false);
    }
  });
});

describe('InteractionPromptRenderer', () => {
  it('renders the presentation title, description, and one button per option', () => {
    const container = createMockEl();
    new InteractionPromptRenderer(container, { onRespond: () => {} }).render([model()]);

    const root = container.children[0];
    expect(root.hasClass('grimoire-interaction--approval')).toBe(true);
    expect(root.getAttribute('data-interaction-id')).toBe('ix-1');
    expect(root.children[0].textContent).toBe('Allow Bash to run?');
    expect(root.children[1].textContent).toBe('rm -rf build');

    const buttons = root.children[2].children;
    expect(buttons.map((button: { textContent: string }) => button.textContent))
      .toEqual(['Allow', 'Reject']);
  });

  it('reports the chosen response without resolving the interaction itself', () => {
    const container = createMockEl();
    const responses: Array<[string, string]> = [];
    const renderer = new InteractionPromptRenderer(container, {
      onRespond: (interactionId, responseId) => { responses.push([interactionId, responseId]); },
    });
    renderer.render([model()]);

    container.children[0].children[2].children[1].dispatchEvent({ type: 'click' });
    expect(responses).toEqual([['ix-1', 'reject']]);
  });

  it('disables options while a submitted answer is still settling', () => {
    const container = createMockEl();
    const responses: string[] = [];
    const renderer = new InteractionPromptRenderer(container, {
      onRespond: (_id, responseId) => { responses.push(responseId); },
    });

    renderer.render([model({
      interaction: interaction({ status: 'resolving', selectedResponseId: 'allow' }),
    })]);

    const buttons = container.children[0].children[2].children;
    expect(buttons[0].disabled).toBe(true);
    expect(buttons[0].hasClass('is-selected')).toBe(true);

    // A double click during the round trip must not submit a second answer.
    buttons[0].dispatchEvent({ type: 'click' });
    expect(responses).toEqual([]);
  });

  it('replaces previous prompts so a resolved interaction cannot linger', () => {
    const container = createMockEl();
    const renderer = new InteractionPromptRenderer(container, { onRespond: () => {} });

    renderer.render([model()]);
    expect(container.children).toHaveLength(1);
    expect(container.hasClass('is-empty')).toBe(false);

    renderer.render([]);
    expect(container.children).toHaveLength(0);
    expect(container.hasClass('is-empty')).toBe(true);
  });

  it('renders every open interaction, not only the first', () => {
    const container = createMockEl();
    new InteractionPromptRenderer(container, { onRespond: () => {} }).render([
      model(),
      model({
        interaction: interaction({ interactionId: 'ix-2', presentationRef: 'pres-2' }),
        presentation: presentation({ presentationRef: 'pres-2', kind: 'question', title: 'Which file?' }),
      }),
    ]);

    expect(container.children).toHaveLength(2);
    expect(container.children[1].getAttribute('data-interaction-id')).toBe('ix-2');
    expect(container.children[1].hasClass('grimoire-interaction--question')).toBe(true);
  });
});
