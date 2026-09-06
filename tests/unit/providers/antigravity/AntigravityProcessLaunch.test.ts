import {
  buildAntigravityProcessLaunch,
  buildWindowsShellCommandLine,
} from '@/providers/antigravity/runtime/AntigravityProcessLaunch';

describe('buildAntigravityProcessLaunch', () => {
  it('wraps Antigravity launches in the user shell without shell-escaping arguments', () => {
    const launch = buildAntigravityProcessLaunch('/Users/test/.local/bin/agy', [
      '--model',
      'Gemini 3.5 Flash (Medium)',
      '--print',
      'hello && rm -rf nope',
    ], {
      SHELL: '/bin/zsh',
    }, 'darwin');

    expect(launch).toEqual({
      args: [
        '-lc',
        'exec "$0" "$@"',
        '/Users/test/.local/bin/agy',
        '--model',
        'Gemini 3.5 Flash (Medium)',
        '--print',
        'hello && rm -rf nope',
      ],
      command: '/bin/zsh',
      launchMode: 'shellLogin',
      shell: false,
    });
  });

  it('speaks fish to fish, which has no $0 or $@', () => {
    // Recorded from a real failure: with `SHELL=/usr/bin/fish`, the POSIX form
    // is a syntax error — `fish: $@ is not supported. In fish, please use
    // $argv.` — the CLI never runs, and `agy models` comes back as exit 127.
    // Enabling the provider then silently reverts, because a model-catalog
    // refresh that rejects turns the toggle back off.
    if (process.platform === 'win32') {
      return;
    }

    const launch = buildAntigravityProcessLaunch('/home/test/.local/bin/agy', ['models'], {
      SHELL: '/usr/bin/fish',
    });

    expect(launch).toEqual({
      args: ['-lc', 'exec $argv', '/home/test/.local/bin/agy', 'models'],
      command: '/usr/bin/fish',
      launchMode: 'shellLogin',
      shell: false,
    });
  });

  it.each([
    '/bin/sh',
    '/bin/bash',
    '/usr/bin/zsh',
    '/bin/dash',
    '/bin/ksh',
  ])('keeps the POSIX form for %s', shell => {
    if (process.platform === 'win32') {
      return;
    }

    const launch = buildAntigravityProcessLaunch('/home/test/.local/bin/agy', ['models'], {
      SHELL: shell,
    });

    // `exec $argv` is empty in every one of these, so the two forms are not
    // interchangeable and the choice has to be made per shell.
    expect(launch.args.slice(0, 2)).toEqual(['-lc', 'exec "$0" "$@"']);
  });

  it('launches directly under a shell whose syntax it does not know', () => {
    // The honest fallback for nushell, xonsh, csh and friends: a login shell is
    // there to pick up the user's profile, and guessing its syntax trades that
    // convenience for a provider that cannot start at all. The environment is
    // already assembled before this point, so a direct launch still works.
    if (process.platform === 'win32') {
      return;
    }

    const launch = buildAntigravityProcessLaunch('/home/test/.local/bin/agy', ['models'], {
      SHELL: '/usr/bin/nu',
    });

    expect(launch).toEqual({
      args: ['models'],
      command: '/home/test/.local/bin/agy',
      launchMode: 'direct',
      shell: false,
    });
  });

  it('launches a resolved Windows agy.exe directly instead of through cmd.exe', () => {
    const launch = buildAntigravityProcessLaunch('C:\\Users\\test\\AppData\\Local\\agy\\bin\\agy.exe', [
      '--print',
      'hello',
    ], {}, 'win32');

    expect(launch).toEqual({
      args: [
        '--print',
        'hello',
      ],
      command: 'C:\\Users\\test\\AppData\\Local\\agy\\bin\\agy.exe',
      launchMode: 'direct',
      shell: false,
    });
  });

  it('routes Windows .cmd launchers through an explicitly quoted cmd.exe invocation', () => {
    const launch = buildAntigravityProcessLaunch('C:\\Users\\test\\AppData\\agy.cmd', [
      '--print',
      'summarize this & echo injected',
    ], {}, 'win32');

    expect(launch).toEqual({
      args: [
        '/d',
        '/s',
        '/c',
        '"C:\\Users\\test\\AppData\\agy.cmd" "--print" "summarize this & echo injected"',
      ],
      command: 'cmd.exe',
      launchMode: 'cmdShell',
      shell: false,
    });
  });

  it('resolves bare Windows command names through cmd.exe with quoted arguments', () => {
    const launch = buildAntigravityProcessLaunch('agy', [
      '--print',
      'hello',
    ], {}, 'win32');

    expect(launch).toEqual({
      args: ['/d', '/s', '/c', '"agy" "--print" "hello"'],
      command: 'cmd.exe',
      launchMode: 'cmdShell',
      shell: false,
    });
  });
});

describe('buildWindowsShellCommandLine', () => {
  it('keeps cmd.exe metacharacters inert inside quoted arguments', () => {
    expect(buildWindowsShellCommandLine('agy.cmd', ['--print', 'a & b | c < d > e ^ f']))
      .toBe('"agy.cmd" "--print" "a & b | c < d > e ^ f"');
  });

  it('doubles internal quotes so the child receives them as literals', () => {
    expect(buildWindowsShellCommandLine('agy.cmd', ['--print', 'say "hi" now']))
      .toBe('"agy.cmd" "--print" "say ""hi"" now"');
  });

  it('doubles backslashes that precede a quote or the closing quote', () => {
    expect(buildWindowsShellCommandLine('agy.cmd', ['--print', 'path C:\\dir\\ "name"']))
      .toBe('"agy.cmd" "--print" "path C:\\dir\\ ""name"""');
    expect(buildWindowsShellCommandLine('agy.cmd', ['--print', 'before\\"after']))
      .toBe('"agy.cmd" "--print" "before\\\\""after"');
    expect(buildWindowsShellCommandLine('agy.cmd', ['--print', 'trailing\\']))
      .toBe('"agy.cmd" "--print" "trailing\\\\"');
  });

  it('keeps paths with spaces as a single command token', () => {
    expect(buildWindowsShellCommandLine('C:\\Program Files\\agy\\agy.cmd', ['models']))
      .toBe('"C:\\Program Files\\agy\\agy.cmd" "models"');
  });

  it('preserves multibyte prompt content unchanged', () => {
    expect(buildWindowsShellCommandLine('agy.cmd', ['--print', 'привет 世界 🌍']))
      .toBe('"agy.cmd" "--print" "привет 世界 🌍"');
  });
});
