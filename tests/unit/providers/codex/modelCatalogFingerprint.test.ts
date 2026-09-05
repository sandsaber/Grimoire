import { getCliBinaryFingerprint } from '@/core/providers/cliBinaryFingerprint';
import { buildCodexModelCatalogFingerprint } from '@/providers/codex/modelCatalogFingerprint';
import { getCodexProviderSettings } from '@/providers/codex/settings';

jest.mock('@/core/providers/cliBinaryFingerprint', () => ({
  getCliBinaryFingerprint: jest.fn().mockReturnValue(''),
}));

const mockedFingerprint = getCliBinaryFingerprint as jest.MockedFunction<
  typeof getCliBinaryFingerprint
>;

describe('buildCodexModelCatalogFingerprint', () => {
  beforeEach(() => mockedFingerprint.mockReset());

  it('changes when the CLI is upgraded in place', () => {
    const settings = getCodexProviderSettings({});

    mockedFingerprint.mockReturnValue('4096:1700000000000');
    const before = buildCodexModelCatalogFingerprint(settings, '/usr/local/bin/codex', '');

    // An upgrade over the same path is the whole reason this exists: without the
    // binary in the key a settled catalog keeps the previous release's models.
    mockedFingerprint.mockReturnValue('5120:1700000999999');
    const after = buildCodexModelCatalogFingerprint(settings, '/usr/local/bin/codex', '');

    expect(mockedFingerprint).toHaveBeenCalledWith('/usr/local/bin/codex');
    expect(after).not.toBe(before);
  });

  it('stays stable while the same build sits at the same path', () => {
    const settings = getCodexProviderSettings({});
    mockedFingerprint.mockReturnValue('4096:1700000000000');

    expect(buildCodexModelCatalogFingerprint(settings, '/usr/local/bin/codex', ''))
      .toBe(buildCodexModelCatalogFingerprint(settings, '/usr/local/bin/codex', ''));
  });
});
