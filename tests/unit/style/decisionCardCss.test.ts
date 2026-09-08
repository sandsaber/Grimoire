import { readFileSync } from 'fs';

/**
 * Every decision the plugin asks for wears one shape.
 *
 * The design's rule for screen 2d: a glyph, what is being decided, the material
 * it acts on, and numbered choices. Three surfaces ask — a plan to approve, a
 * question to answer, a permission to grant — and before this each of them had
 * its own card weight, its own glyph treatment and its own idea of what a
 * chosen row looks like.
 */
const DECISION_SHEETS = [
  'src/style/features/ask-user-question.css',
  'src/style/features/plan-mode.css',
] as const;

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

function getRule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('decision cards', () => {
  it('sits on the transcript rather than floating over it', () => {
    // A decision is part of the thread, not a modal. Both cards were a raised
    // plane with a full drop shadow and an accent inset ring.
    for (const [sheet, selector] of [
      [DECISION_SHEETS[0], '.grimoire-ask-form'],
      [DECISION_SHEETS[0], '.grimoire-permission-request'],
      [DECISION_SHEETS[1], '.grimoire-plan-approval-inline'],
    ] as const) {
      const rule = getRule(read(sheet), selector);
      expect(rule).toContain('border: 1px solid var(--grimoire-line)');
      expect(rule).toContain('border-radius: var(--grimoire-radius-2)');
      expect(rule).toContain('background: var(--grimoire-ground)');
      expect(rule).toContain('box-shadow: var(--grimoire-lift-0)');
    }
  });

  it('draws the glyph as a glyph, not as a tinted tile', () => {
    for (const [sheet, selector] of [
      [DECISION_SHEETS[0], '.grimoire-ask-glyph'],
      [DECISION_SHEETS[0], '.grimoire-permission-shield'],
      [DECISION_SHEETS[1], '.grimoire-plan-glyph'],
    ] as const) {
      const rule = getRule(read(sheet), selector);
      expect(rule).toContain('width: var(--grimoire-icon-l)');
      expect(rule).toContain('background: none');
      expect(rule).toContain('box-shadow: none');
      expect(rule).toContain('color: var(--grimoire-accent)');
    }
  });

  it('marks the chosen row with the same rule everywhere it offers a choice', () => {
    // The accent may be a line here, and the line is the one the history row
    // and the thread outline already use for "this one".
    const askOption = getRule(read(DECISION_SHEETS[0]), '.grimoire-ask-opt');
    const askChosen = getRule(read(DECISION_SHEETS[0]), '.grimoire-ask-opt.is-selected');
    const planOption = getRule(read(DECISION_SHEETS[1]), '.grimoire-plan-approval-inline .grimoire-ask-item');
    const planChosen = getRule(
      read(DECISION_SHEETS[1]),
      '.grimoire-plan-approval-inline .grimoire-ask-item.is-focused',
    );

    for (const rule of [askOption, planOption]) {
      expect(rule).toContain('height: 32px');
      expect(rule).toContain('border-inline-start: 1.5px solid transparent');
    }
    for (const rule of [askChosen, planChosen]) {
      expect(rule).toContain('border-inline-start-color: var(--grimoire-accent)');
      expect(rule).toContain('background: var(--grimoire-hover)');
    }
  });

  it('keeps the keyboard hint in the system\'s meta type', () => {
    const hints = getRule(read(DECISION_SHEETS[1]), '.grimoire-plan-approval-inline .grimoire-ask-hints');

    expect(hints).toContain('font-family: var(--grimoire-mono)');
    expect(hints).toContain('font-size: var(--grimoire-text-2xs)');
  });

  /*
   * The hint is the last line of the card, not a footer band. It carried a rule
   * above it and its own padding, so a card whose choices already sat under a
   * rule ended in two horizontal lines eight pixels apart.
   */
  it('ends the plan card on a line of text, not on a second band', () => {
    const hints = getRule(read(DECISION_SHEETS[1]), '.grimoire-plan-approval-inline .grimoire-ask-hints');

    expect(hints).not.toContain('border-top');
  });

  /*
   * The plan is the card's own material, set flush in it. It was a second card
   * inside the first - its own ring, its own raised ground, its own radius -
   * which is the one thing screen 2d never does: the decision surface has one
   * frame, and what is being decided is written inside it.
   */
  it('sets the plan flush in the card rather than in a card of its own', () => {
    const preview = getRule(read(DECISION_SHEETS[1]), '.grimoire-plan-content-preview');

    expect(preview).toContain('background: none');
    expect(preview).not.toContain('box-shadow: inset');
    expect(preview).not.toContain('border-radius');
  });

  /*
   * One column, one gap: the card's parts are stacked by the card, so a part
   * that grows or is hidden does not leave a row of padding behind it.
   */
  it('stacks the plan card in one column with one gap', () => {
    const card = getRule(read(DECISION_SHEETS[1]), '.grimoire-plan-approval-inline');

    expect(card).toContain('flex-direction: column');
    expect(card).toContain('gap: var(--grimoire-space-12)');
    expect(card).toContain('padding: var(--grimoire-space-14)');
    expect(card).not.toContain('grid-template-rows');
  });
});
