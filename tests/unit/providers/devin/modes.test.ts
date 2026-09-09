import { mapDevinModeToGrimoire, mapGrimoireModeToDevin } from '@/providers/devin/modes';

describe('Devin ACP mode mapping', () => {
  it('maps Grimoire modes to the modes the recorded session offers', () => {
    expect(mapGrimoireModeToDevin('normal')).toBe('accept-edits');
    expect(mapGrimoireModeToDevin('full_access')).toBe('bypass');
    expect(mapGrimoireModeToDevin('plan')).toBe('plan');
    expect(mapGrimoireModeToDevin(undefined)).toBe('accept-edits');
  });

  it('reads every Devin mode that is not bypass or plan as Safe', () => {
    expect(mapDevinModeToGrimoire('accept-edits')).toBe('normal');
    expect(mapDevinModeToGrimoire('smart')).toBe('normal');
    expect(mapDevinModeToGrimoire('ask')).toBe('normal');
    expect(mapDevinModeToGrimoire('bypass')).toBe('full_access');
    expect(mapDevinModeToGrimoire('plan')).toBe('plan');
  });
});
