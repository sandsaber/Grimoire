import wire from '@test/fixtures/provider-traces/wire/gemini-wire.json';

import {
  GEMINI_AUTO_EDIT_MODE_ID,
  GEMINI_DEFAULT_MODE_ID,
  GEMINI_PLAN_MODE_ID,
  GEMINI_YOLO_MODE_ID,
  mapGeminiModeToGrimoire,
  mapGrimoireModeToGemini,
} from '@/providers/gemini/modes';

/**
 * The two vocabularies a Gemini session lives between.
 *
 * The fourth review's Critical was that neither direction translated: the
 * toolbar's `full_access` went out as a `modeId` the agent does not have, and
 * the agent's `autoEdit` came back into a field the toolbar cannot render. These
 * assertions were reached through `GeminiChatRuntime` before the flip deleted
 * it; the mapping is the same one, and this is where it is pinned now.
 */
describe('Gemini modes', () => {
  it('names the four modes the recorded session actually offers', () => {
    // Not a list anybody chose: `gemini 0.55.1` answered `session/new` with
    // exactly these, and a mode invented here is one the agent rejects.
    const answered = wire.exchange
      .map(entry => (entry.message as {
        result?: { modes?: { availableModes?: Array<{ id: string }> } };
      }).result)
      .find(result => result?.modes !== undefined);

    expect(answered?.modes?.availableModes?.map(mode => mode.id)).toEqual([
      GEMINI_DEFAULT_MODE_ID,
      GEMINI_AUTO_EDIT_MODE_ID,
      GEMINI_YOLO_MODE_ID,
      GEMINI_PLAN_MODE_ID,
    ]);
  });

  describe('into the agent vocabulary', () => {
    it.each([
      ['normal', 'default'],
      ['plan', 'plan'],
      ['full_access', 'yolo'],
    ])('sends %s as %s', (grimoire, gemini) => {
      expect(mapGrimoireModeToGemini(grimoire)).toBe(gemini);
    });

    it('passes an agent id back through unchanged', () => {
      // A mode that arrived from the session and was stored has to survive the
      // round trip, or the next turn asks for something else.
      for (const id of ['default', 'autoEdit', 'yolo', 'plan']) {
        expect(mapGrimoireModeToGemini(id)).toBe(id);
      }
    });

    it('falls back to the mode that asks before it acts', () => {
      // The safe way to be wrong about a permission. `default` prompts for
      // approval; every other mode gives something away.
      expect(mapGrimoireModeToGemini('')).toBe(GEMINI_DEFAULT_MODE_ID);
      expect(mapGrimoireModeToGemini(null)).toBe(GEMINI_DEFAULT_MODE_ID);
      expect(mapGrimoireModeToGemini(undefined)).toBe(GEMINI_DEFAULT_MODE_ID);
      expect(mapGrimoireModeToGemini('grimoire-safe')).toBe(GEMINI_DEFAULT_MODE_ID);
    });
  });

  describe('into the toolbar vocabulary', () => {
    it.each([
      ['yolo', 'full_access'],
      ['plan', 'plan'],
      ['default', 'normal'],
    ])('shows %s as %s', (gemini, grimoire) => {
      expect(mapGeminiModeToGrimoire(gemini)).toBe(grimoire);
    });

    it('calls auto-edit Safe rather than Auto-approve', () => {
      // It auto-approves an edit and still asks before a command. Calling it
      // Auto-approve would tell the user they had given away more than they
      // have — which is the direction that matters.
      expect(mapGeminiModeToGrimoire(GEMINI_AUTO_EDIT_MODE_ID)).toBe('normal');
    });

    it('shows an unknown mode as the least it could be', () => {
      expect(mapGeminiModeToGrimoire('something-new')).toBe('normal');
      expect(mapGeminiModeToGrimoire(null)).toBe('normal');
    });
  });

  it('round-trips every value the toolbar can hold', () => {
    for (const grimoire of ['normal', 'plan', 'full_access'] as const) {
      expect(mapGeminiModeToGrimoire(mapGrimoireModeToGemini(grimoire))).toBe(grimoire);
    }
  });
});
