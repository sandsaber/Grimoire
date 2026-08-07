import type { OpencodeExecutionTarget } from '@/providers/opencode/runtime/opencodeLaunchTypes';
import { createOpencodePathMapper } from '@/providers/opencode/runtime/OpencodePathMapper';

describe('createOpencodePathMapper', () => {
  it('maps Windows drive paths into /mnt paths for WSL targets', () => {
    const mapper = createOpencodePathMapper({
      method: 'wsl',
      platformFamily: 'unix',
      platformOs: 'linux',
      distroName: 'Ubuntu',
    });

    expect(mapper.toTargetPath('C:\\repo\\src')).toBe('/mnt/c/repo/src');
    expect(mapper.toHostPath('/mnt/c/repo/src')).toBe('C:\\repo\\src');
  });

  it('maps \\wsl$ paths into Linux paths for the selected distro', () => {
    const mapper = createOpencodePathMapper({
      method: 'wsl',
      platformFamily: 'unix',
      platformOs: 'linux',
      distroName: 'Ubuntu',
    });

    expect(mapper.toTargetPath('\\\\wsl$\\Ubuntu\\home\\user\\repo')).toBe('/home/user/repo');
    expect(mapper.toHostPath('/home/user/repo')).toBe('\\\\wsl$\\Ubuntu\\home\\user\\repo');
  });

  it('maps \\wsl.localhost paths into Linux paths and preserves the UNC flavor on round-trip', () => {
    const mapper = createOpencodePathMapper({
      method: 'wsl',
      platformFamily: 'unix',
      platformOs: 'linux',
      distroName: 'Ubuntu',
      wslHostFlavor: 'wsl.localhost',
    });

    expect(mapper.toTargetPath('\\\\wsl.localhost\\Ubuntu\\home\\user\\repo')).toBe('/home/user/repo');
    expect(mapper.toHostPath('/home/user/repo')).toBe('\\\\wsl.localhost\\Ubuntu\\home\\user\\repo');
  });

  it('rejects WSL UNC paths from a different distro', () => {
    const mapper = createOpencodePathMapper({
      method: 'wsl',
      platformFamily: 'unix',
      platformOs: 'linux',
      distroName: 'Ubuntu',
    });

    expect(mapper.toTargetPath('\\\\wsl$\\Debian\\home\\user\\repo')).toBeNull();
    expect(mapper.toTargetPath('\\\\wsl.localhost\\Debian\\home\\user\\repo')).toBeNull();
  });

  it('keeps host-native paths unchanged', () => {
    const target: OpencodeExecutionTarget = {
      method: 'host-native',
      platformFamily: 'unix',
      platformOs: 'macos',
    };
    const mapper = createOpencodePathMapper(target);

    expect(mapper.toTargetPath('/Users/example/repo')).toBe('/Users/example/repo');
    expect(mapper.toHostPath('/Users/example/repo')).toBe('/Users/example/repo');
  });
});
