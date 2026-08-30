import type { ChatProjectionHarness } from '@test/integration/app/chat/chatProjectionLiveHarness';
import { userMessage } from '@test/integration/app/chat/chatProjectionLiveHarness';

/**
 * The matrix rows that are about the *path* rather than about a provider.
 *
 * Rows 11, 12 and 13 — a tab closed mid-turn, two tabs on one conversation, and
 * the turn's usage — were left to a person because the flip's first harness had
 * one surface, released it at the end of a row, and read nothing back but the
 * messages. None of the three needs a person: what row 11 asks is whether the
 * kernel finishes a turn nobody is drawing and the barrier stores it, row 12
 * whether one run reaches both surfaces, and row 13 whether the count the meter
 * draws survives the save. All three are observable at the seam this harness
 * already sits on.
 *
 * The **bodies** are shared and the `it` stays in each provider's file, so a
 * file still lists the rows it runs — a matrix whose rows are hidden behind a
 * call is a matrix nobody can read. Sharing the body is the same rule the
 * assembly follows: a row copied nine times is nine rows that can disagree
 * about what they measure.
 *
 * Each row spends a turn.
 */

export interface ChatProjectionSurfaceRowOptions {
  /** A harness with its kernel, its vault and its first surface already open. */
  createHarness(): Promise<ChatProjectionHarness>;
  report(...parts: readonly string[]): void;
  /** A prompt this provider's account answers quickly. */
  readonly prompt?: string;
  /**
   * A prompt that keeps the provider busy long enough for a tab to close on it.
   *
   * Row 11 is about a turn that outlives its surface, so the surface has to go
   * away while there is still a turn — with a one-word answer the run can be
   * over before `detach` is reached, and the row would certify nothing.
   */
  readonly slowPrompt?: string;
}

export interface ChatProjectionSurfaceRows {
  /** Matrix row 11. */
  tabClosedMidTurn(): Promise<void>;
  /** Matrix row 12. */
  twoSurfacesOneConversation(): Promise<void>;
  /** Matrix row 13, for a provider that reports usage at all. */
  usageAfterTurn(): Promise<void>;
  /** Matrix row 8, for a provider that queues rather than steers. */
  queuedInputWaitsForDurability(): Promise<void>;
}

const ANSWER_PROMPT = 'Reply with exactly: ok';
const SLOW_PROMPT = 'Count from 1 to 20, one number per line, then reply with exactly: done';

export function chatProjectionSurfaceRows(
  options: ChatProjectionSurfaceRowOptions,
): ChatProjectionSurfaceRows {
  const prompt = options.prompt ?? ANSWER_PROMPT;
  const slowPrompt = options.slowPrompt ?? SLOW_PROMPT;

  return {
    async tabClosedMidTurn() {
      // **The claim under row 11 is that a run belongs to the conversation
      // rather than to the surface that started it** — the kernel keeps running
      // it and the persistence barrier writes the answer whether or not anything
      // is drawing. Nothing had ever checked that against a real provider: every
      // other row keeps its surface until the turn is over.
      const harness = await options.createHarness();
      const conversationId = harness.tab.conversationId ?? '';
      const submitted = await harness.tab.send({ text: slowPrompt }, userMessage(slowPrompt));

      // Closed while the provider is still answering, which is what makes this
      // row different from reading the vault after an uninterrupted turn.
      harness.tab.detach();
      const completed = await submitted.ticket.completion;

      options.report('ROW E', completed.terminal.kind, JSON.stringify(conversationId),
        JSON.stringify(harness.column.finished));
      expect(completed.terminal.kind).toBe('succeeded');
      // **Nobody drew the ending**, which is what stops this row passing for the
      // ordinary reason: the tab was detached before the turn reached one, so
      // the column was never told the turn finished.
      expect(harness.column.finished).toEqual([]);
      // So the answer being in the vault is the barrier's doing and nobody
      // else's.
      const stored = await harness.sessions.records.read(conversationId);
      const messages = stored.kind === 'present' ? stored.metadata.messages ?? [] : [];
      options.report('ROW E stored', JSON.stringify(messages.map(message => message.role)));
      expect(messages.map(message => message.role)).toEqual(['user', 'assistant']);
      expect(messages.at(-1)?.content.trim()).not.toBe('');

      // And a tab opened on it afterwards shows that answer rather than an empty
      // chat — the other half of the row, and the half a person was doing.
      const reopened = await harness.openSurface();
      options.report(
        'ROW E reopened',
        JSON.stringify(reopened.column.state.messages.map(message => message.role)),
      );
      expect(reopened.column.state.messages.map(message => message.role))
        .toEqual(['user', 'assistant']);
      expect(reopened.column.state.messages.at(-1)?.content).toBe(messages.at(-1)?.content);
    },

    async twoSurfacesOneConversation() {
      // Row 12: two tabs open on one chat, one run, drawn twice. The projection
      // is what makes that possible — each surface renders successive
      // projections of the same conversation — so what this guards against is a
      // second surface that draws nothing, and a second surface that starts a
      // turn of its own.
      const harness = await options.createHarness();
      const second = await harness.openSurface();

      const submitted = await harness.tab.send({ text: prompt }, userMessage(prompt));
      const completed = await submitted.ticket.completion;
      await harness.tab.settled();
      await second.tab.settled();

      options.report(
        'ROW F',
        completed.terminal.kind,
        JSON.stringify(harness.column.drawn.join('').slice(0, 60)),
        JSON.stringify(second.column.drawn.join('').slice(0, 60)),
      );
      expect(completed.terminal.kind).toBe('succeeded');
      // Both columns were told the same turn ended, once each.
      expect(harness.column.finished).toHaveLength(1);
      expect(second.column.finished).toEqual(harness.column.finished);
      // And both drew the same answer, which is the half a second surface loses
      // when it is attached to a projection nothing is feeding it.
      expect(second.column.drawn.join('').trim()).not.toBe('');
      expect(second.column.drawn.join('')).toBe(harness.column.drawn.join(''));
      expect(second.column.thrown).toEqual([]);
      // One turn, not two: a second surface attaches to the run, it does not
      // start one.
      expect(second.column.state.messages.filter(message => message.role === 'assistant'))
        .toHaveLength(1);
      // And row 6's driven half, which costs nothing here: the question appears
      // **once** on each column, as the provider composed it rather than as it
      // was typed. A provider that echoes the question back as content — Codex
      // does — would otherwise draw it twice, and this path filters that echo
      // out as turn framing.
      for (const surface of [harness.column, second.column]) {
        const questions = surface.state.messages.filter(message => message.role === 'user');
        expect(questions).toHaveLength(1);
        expect(questions[0]?.content).toBe(submitted.userMessage.content);
      }
    },

    async usageAfterTurn() {
      // Row 13, the half that is not a number on screen: the meter reads
      // `state.usage`, and what survives a reload is what the save wrote. Usage
      // is the one thing on this path that arrives as *content* and has to
      // travel back — the kernel carries no token counts — so it is also the one
      // thing a projection could quietly drop with no other row noticing.
      const harness = await options.createHarness();
      const submitted = await harness.tab.send({ text: prompt }, userMessage(prompt));
      await submitted.ticket.completion;
      await harness.tab.settled();

      options.report('ROW G', JSON.stringify(harness.column.state.usage));
      const usage = harness.column.state.usage;
      expect(usage).not.toBeNull();
      // A number the meter can draw, rather than a shape that merely exists.
      expect(usage?.contextTokens ?? 0).toBeGreaterThan(0);

      await harness.saveAfterTurn();
      const stored = await harness.sessions.records.read(harness.tab.conversationId ?? '');
      options.report(
        'ROW G stored',
        JSON.stringify(stored.kind === 'present' ? stored.metadata.usage : null),
      );
      expect(stored.kind === 'present' ? stored.metadata.usage?.contextTokens ?? 0 : 0)
        .toBeGreaterThan(0);
    },

    async queuedInputWaitsForDurability() {
      // Row 8: a second message sent while a turn is running waits, and what it
      // waits for is the first turn being **durable** rather than merely over.
      // That is the coordinator's promise and the reason the queue exists on
      // this path at all — a second turn that started before the first was
      // written would hand the provider a transcript missing the answer it is
      // about to be asked to follow up on.
      const harness = await options.createHarness();
      const conversationId = harness.tab.conversationId ?? '';
      const first = await harness.tab.send({ text: slowPrompt }, userMessage(slowPrompt));
      const second = await harness.tab.send({ text: prompt }, userMessage(prompt));

      options.report('ROW H', first.ticket.admission, second.ticket.admission);
      // The first was admitted, the second was not: one turn runs at a time.
      expect(first.ticket.admission).toBe('started');
      expect(second.ticket.admission).toBe('queued');

      // Read the moment the second turn starts, which is the only moment this
      // row is about: by then the first answer is in the vault.
      await second.ticket.started;
      const atRelease = await harness.sessions.records.read(conversationId);
      const released = atRelease.kind === 'present' ? atRelease.metadata.messages ?? [] : [];
      options.report('ROW H at release', JSON.stringify(released.map(message => message.role)));
      expect(released.filter(message => message.role === 'assistant').length)
        .toBeGreaterThanOrEqual(1);
      expect(released.find(message => message.role === 'assistant')?.content.trim()).not.toBe('');

      const completed = await second.ticket.completion;
      await harness.tab.settled();
      expect(completed.terminal.kind).toBe('succeeded');
      // And the conversation reads as the two turns happened: question, answer,
      // question, answer.
      const stored = await harness.sessions.records.read(conversationId);
      const messages = stored.kind === 'present' ? stored.metadata.messages ?? [] : [];
      options.report('ROW H stored', JSON.stringify(messages.map(message => message.role)));
      expect(messages.map(message => message.role))
        .toEqual(['user', 'assistant', 'user', 'assistant']);
    },
  };
}
