#!/usr/bin/env python3
"""Run deployed Grimoire in real Obsidian with official CLI, no mic/network.

Linux developer acceptance only. No normal vault/profile is opened by this test.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = None if str(Path(__file__)) == '/qa/runner.py' else Path(__file__).resolve().parents[5]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_native(args):
    assert str(Path(__file__)) == '/qa/runner.py'
    assert Path('/qa/vault/.qa-marker').read_text() == 'grimoire-audio-native-qa'
    assert os.geteuid() == 1000 and not Path('/dev/snd').exists()
    assert [x.split(':')[0].strip() for x in Path('/proc/net/dev').read_text().splitlines()[2:]] == ['lo']
    assert not Path('/proc/net/route').read_text().splitlines()[1:]
    def cli(*values, timeout=30):
        result = subprocess.run([args.obsidian.with_name('obsidian-cli'), *values],
                                capture_output=True, text=True, timeout=timeout)
        assert result.returncode == 0 and not result.stdout.startswith('Error:'), 'Official CLI operation failed'
        return result.stdout
    def evaluate(code, timeout=30):
        output = cli('eval', 'code=' + code, timeout=timeout)
        assert '=>' in output, 'Missing native eval result'
        value = json.loads(output.split('=>', 1)[1].strip())
        return json.loads(value) if isinstance(value, str) else value
    x = subprocess.Popen(['/qa/Xvfb', ':178', '-screen', '0', '1440x1080x24', '-nolisten', 'tcp'],
                         stdout=subprocess.DEVNULL, stderr=open('/qa/xvfb.log', 'wb'))
    app = None
    try:
        end = time.monotonic() + 10
        while not Path('/tmp/.X11-unix/X178').exists():
            assert x.poll() is None and time.monotonic() < end
            time.sleep(.05)
        os.environ.update(DISPLAY=':178', XDG_RUNTIME_DIR='/tmp/qa-runtime', ATSPI_DBUS_IMPLEMENTATION='dbus-daemon')
        Path('/tmp/qa-runtime').mkdir(mode=0o700)
        os.environ['DBUS_SESSION_BUS_ADDRESS'] = subprocess.check_output(
            ['dbus-daemon', '--session', '--fork', '--print-address=1'], text=True).strip()
        app = subprocess.Popen([args.obsidian, '--disable-gpu', '--ozone-platform=x11',
            '--user-data-dir=/home/m5/.config/obsidian', 'obsidian://open?path=/qa/vault'],
            stdout=open('/qa/native.log', 'wb'), stderr=subprocess.STDOUT)
        for _ in range(50):
            assert app.poll() is None
            time.sleep(.2)
            try:
                state = evaluate('({base:app.vault.adapter.getBasePath()})', timeout=5)
                if state['base'] == '/qa/vault': break
            except (AssertionError, subprocess.TimeoutExpired): pass
        else: raise AssertionError('Native QA vault startup failed')
        # Trust only our authored empty vault containing the requested plugin.
        cli('plugins:restrict', 'off')
        time.sleep(8)  # Obsidian explicitly reloads its renderer after this operation.
        state = evaluate('({base:app.vault.adapter.getBasePath(),loaded:!!app.plugins.plugins.grimoire})')
        assert state == {'base': '/qa/vault', 'loaded': True}
        print('STAGE: deployed Grimoire loaded in real Obsidian', flush=True)
        metrics = evaluate("(async()=>await eval(await app.vault.adapter.read('.qa-audio.js')))()", timeout=150)
        assert metrics['recoveryPassed'] and metrics['sameAudioGuiPid'] and metrics['engineLoads'] == 1
        assert metrics['keyboardEvents'] == metrics['submitEvents'] == 0 and not metrics['microphone']
        time.sleep(.7)  # Let the sidebar/focus animation settle before capturing an empty draft.
        cli('dev:screenshot', 'path=/qa/native-checked.png')  # Acceptance cleared the draft first.
        Path('/qa/result.json').write_text(json.dumps({'passed': True, 'native': metrics,
            'chromiumSandboxRetained': True, 'physicalAudioDevices': False,
            'normalProfileMounted': False, 'externalRoutes': False}, indent=2) + '\n')
        print('PASS: native Obsidian -> deployed Grimoire -> real Audio -> native editor/cancel/edit/tab/recovery', flush=True)
    finally:
        if app is not None and app.poll() is None:
            app.terminate()
            try: app.wait(timeout=10)
            except subprocess.TimeoutExpired: app.kill(); app.wait(timeout=5)
        x.terminate(); x.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['obsidian', 'asar', 'xvfb', 'base', 'wav', 'plugin', 'work']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--child', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.child: run_native(args); return
    work = args.work.resolve()
    assert work.is_relative_to(ROOT / '.build')
    assert sha(args.base) == '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
    assert sha(args.wav) == 'e24a6e888efe70ed67685172d5f2ce37f1881835ce439a396621f1b3997ddffb'
    original = (sha(args.base), args.base.stat().st_ino, args.base.stat().st_mtime_ns)
    work.mkdir(parents=True, exist_ok=False)
    home = work / 'home'; profile = home / '.config/obsidian'; profile.mkdir(parents=True)
    plugin = work / 'vault/.obsidian/plugins/grimoire'; plugin.mkdir(parents=True)
    for name in ['main.js', 'manifest.json', 'styles.css']:
        assert sha(args.plugin / name) == sha(ROOT / 'dist/grimoire' / name), 'Deploy the current bundle first'
        shutil.copyfile(args.plugin / name, plugin / name)
    (work / 'vault/.obsidian/community-plugins.json').write_text('["grimoire"]')
    (work / 'vault/.qa-marker').write_text('grimoire-audio-native-qa')
    shutil.copyfile(Path(__file__).with_name('nativeObsidianAcceptance.js'), work / 'vault/.qa-audio.js')
    subprocess.run(['cp', '--reflink=auto', str(args.asar), str(profile / args.asar.name)], check=True)
    (profile / 'obsidian.json').write_text(json.dumps({'vaults': {'a0d10d1c7a7e1108':
        {'path': '/qa/vault', 'ts': 1, 'open': True}}, 'cli': True}))
    (profile / 'a0d10d1c7a7e1108.json').write_text('{}')
    models = home / '.local/share/io.github.sandsaber.grimoire-audio.prototype/models'; models.mkdir(parents=True)
    subprocess.run(['cp', '--reflink=auto', str(args.base), str(models / 'ggml-base.bin')], check=True)
    (work / 'synthetic.wav').touch(); (work / 'Xvfb').touch(); shutil.copyfile(__file__, work / 'runner.py')
    forwarded = [item for name in ['obsidian', 'asar', 'xvfb', 'base', 'wav', 'plugin', 'work']
                 for item in ['--' + name, str(getattr(args, name).resolve())]]
    command = ['bwrap', '--unshare-user', '--unshare-pid', '--uid', '1000', '--gid', '1000', '--unshare-net', '--unshare-ipc',
        '--tmpfs', '/', '--ro-bind', '/usr', '/usr', '--ro-bind', '/etc', '/etc',
        '--ro-bind', str(args.obsidian.parent), str(args.obsidian.parent),
        '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib', '/lib64',
        '--bind', str(work), '/qa', '--bind', str(home), '/home/m5', '--ro-bind', str(args.xvfb.resolve()), '/qa/Xvfb',
        '--ro-bind', str(args.wav.resolve()), '/qa/synthetic.wav', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
        '--dir', '/tmp/.X11-unix', '--tmpfs', '/run', '--tmpfs', '/dev/shm', '--die-with-parent', '--clearenv',
        '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'LANG', 'C.UTF-8', '--', sys.executable, '/qa/runner.py', *forwarded, '--child']
    subprocess.run(command, check=True, timeout=230)
    assert original == (sha(args.base), args.base.stat().st_ino, args.base.stat().st_mtime_ns)
    result = json.loads((work / 'result.json').read_text()); result.update(approvedCacheUnchanged=True,
        obsidianArchive=args.asar.name, audioSha256=sha(Path('/usr/bin/grimoire-audio')),
        deployedHashes={name: sha(args.plugin / name) for name in ['main.js', 'manifest.json', 'styles.css']})
    shutil.rmtree(home)
    shutil.rmtree(work / 'vault')
    result['qaProfileAndVaultRemoved'] = True
    (work / 'result.json').write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__': main()
