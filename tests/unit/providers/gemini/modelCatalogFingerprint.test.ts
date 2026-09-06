import { getCliBinaryFingerprint } from '@/core/providers/cliBinaryFingerprint';
import { buildGeminiModelCatalogFingerprint } from '@/providers/gemini/modelCatalogFingerprint';
import { getGeminiProviderSettings } from '@/providers/gemini/settings';

jest.mock('@/core/providers/cliBinaryFingerprint', () => ({
  getCliBinaryFingerprint: jest.fn().mockReturnValue(''),
}));

const mockedFingerprint = getCliBinaryFingerprint as jest.MockedFunction<
  typeof getCliBinaryFingerprint
>;

describe('buildGeminiModelCatalogFingerprint', () => {
  beforeEach(() => mockedFingerprint.mockReset());

  it('changes when the CLI is upgraded in place', () => {
    const settings = getGeminiProviderSettings({});

    mockedFingerprint.mockReturnValue('4096:1700000000000');
    const before = buildGeminiModelCatalogFingerprint(settings, '/usr/local/bin/gemini', '');

    // An upgrade over the same path is the whole reason this exists: without the
    // binary in the key a settled catalog keeps the previous release's models.
    mockedFingerprint.mockReturnValue('5120:1700000999999');
    const after = buildGeminiModelCatalogFingerprint(settings, '/usr/local/bin/gemini', '');

    expect(mockedFingerprint).toHaveBeenCalledWith('/usr/local/bin/gemini');
    expect(after).not.toBe(before);
  });

  it('stays stable while the same build sits at the same path', () => {
    const settings = getGeminiProviderSettings({});
    mockedFingerprint.mockReturnValue('4096:1700000000000');

    expect(buildGeminiModelCatalogFingerprint(settings, '/usr/local/bin/gemini', ''))
      .toBe(buildGeminiModelCatalogFingerprint(settings, '/usr/local/bin/gemini', ''));
  });
});
