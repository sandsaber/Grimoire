import { getCliBinaryFingerprint } from '@/core/providers/cliBinaryFingerprint';
import { buildQwenModelCatalogFingerprint } from '@/providers/qwen/modelCatalogFingerprint';
import { getQwenProviderSettings } from '@/providers/qwen/settings';

jest.mock('@/core/providers/cliBinaryFingerprint', () => ({
  getCliBinaryFingerprint: jest.fn().mockReturnValue(''),
}));

const mockedFingerprint = getCliBinaryFingerprint as jest.MockedFunction<
  typeof getCliBinaryFingerprint
>;

describe('buildQwenModelCatalogFingerprint', () => {
  beforeEach(() => mockedFingerprint.mockReset());

  it('changes when the CLI is upgraded in place', () => {
    const settings = getQwenProviderSettings({});

    mockedFingerprint.mockReturnValue('4096:1700000000000');
    const before = buildQwenModelCatalogFingerprint(settings, '/usr/local/bin/qwen', '');

    // An upgrade over the same path is the whole reason this exists: without the
    // binary in the key a settled catalog keeps the previous release's models.
    mockedFingerprint.mockReturnValue('5120:1700000999999');
    const after = buildQwenModelCatalogFingerprint(settings, '/usr/local/bin/qwen', '');

    expect(mockedFingerprint).toHaveBeenCalledWith('/usr/local/bin/qwen');
    expect(after).not.toBe(before);
  });

  it('stays stable while the same build sits at the same path', () => {
    const settings = getQwenProviderSettings({});
    mockedFingerprint.mockReturnValue('4096:1700000000000');

    expect(buildQwenModelCatalogFingerprint(settings, '/usr/local/bin/qwen', ''))
      .toBe(buildQwenModelCatalogFingerprint(settings, '/usr/local/bin/qwen', ''));
  });
});
