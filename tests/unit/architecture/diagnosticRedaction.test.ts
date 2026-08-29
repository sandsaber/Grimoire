import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { DebugLogService, sanitizeDebugLogData } from '@/core/debug/DebugLogService';

/**
 * D7, checked against what the execution path actually logs.
 *
 * The decision says a debug log "must never record prompt text, provider
 * payloads, tool inputs and outputs, local shell output, secrets, or absolute
 * paths outside the vault". `DebugLogService` enforces that by key and by
 * content, and its own tests prove the redaction works — on values those tests
 * chose.
 *
 * This is the half that was missing, and the reason the obligation stayed open
 * until the kernel emitted log records: **nothing tied the rule to the call
 * sites.** A composition that logged `{ prompt }` tomorrow would be caught by
 * the service and by nothing that reads like a rule, so the leak would be a
 * silent `[redacted]` in a field somebody meant to be able to read — or, for a
 * key the pattern does not know, not redacted at all.
 *
 * So this reads every `recordDebugLog` in the execution path, takes the keys
 * each one logs, and runs a value through each key that would be a D7 violation
 * if it survived.
 */
/**
 * Every directory the execution path logs from.
 *
 * **The provider list is derived, not typed out.** These were four fixed roots,
 * one of them `src/app/execution`, and when each provider's composition moved
 * under `src/providers/<id>/execution` the gate went on passing while reading
 * *nothing* — a rule over a subset reads exactly like a rule over everything.
 * It now walks `src/providers` for the same directory name, so a provider added
 * later is covered by existing, and the count assertion below refuses a run
 * that found no call sites at all.
 */
const ROOTS = [
  // **`src/app`, not `src/app/execution`.** The composition root logs through
  // its own `report` port rather than `recordDebugLog`, and it is where startup
  // recovery reports what it could not finish — so the gate read neither the
  // file nor the call shape, which is the same subset-shaped hole this comment
  // already describes one paragraph up.
  'src/app',
  'src/core/execution',
  'src/core/runtime/execution',
  ...readdirSync(resolve(process.cwd(), 'src/providers'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => `src/providers/${entry.name}/execution`)
    .filter(root => existsSync(resolve(process.cwd(), root))),
];

/**
 * The half of D7 a redactor can enforce on its own: content that is
 * *recognisable* whatever key it arrives under.
 */
const RECOGNISABLE: Readonly<Record<string, string>> = {
  'a secret': 'sk-live-9f8e7d6c5b4a3210deadbeef',
  'an absolute path outside the vault': '/home/someone/.config/gemini/credentials.json',
  'an address': 'someone@example.com',
};

/**
 * The other half, which **no content rule can catch**: prose.
 *
 * "Summarize the note about my medication schedule" and "yolo" are both just
 * strings; nothing about the first says prompt. So D7 rests on **default-deny**:
 * a string is redacted unless its key is on the service's safe list, and putting
 * a key on that list is a claim that what goes under it is never something a
 * person typed. The sensitive-key pattern is a second net for names that might
 * otherwise look harmless — it is not what does the work, which a break proved:
 * taking `prompt` out of it changes nothing, because `prompt` was never allowed.
 *
 * The safe list is therefore the only thing a reviewer has to read, and this
 * file's job is to make adding to it visible.
 */
const UNRECOGNISABLE: Readonly<Record<string, string>> = {
  'prompt text': 'Summarize the note about my medication schedule',
  'a provider payload': '{"sessionUpdate":"agent_message_chunk","content":"the answer"}',
  'a tool input': '{"path":"my vault/Private.md"}',
  'local shell output': 'total 48\ndrwxr-xr-x 12 someone someone 4096 Notes',
};

/** Keys D7 names, plus one nobody has ever used, to show the rule is default-deny. */
const UNSAFE_KEYS = [
  'prompt', 'content', 'input', 'output', 'text', 'transcript', 'selection', 'somethingNewEntirely',
];

/** Enough of a vault to read back what the service wrote. */
class FakeVaultFileAdapter {
  files = new Map<string, string>();
  private readonly folders = new Set<string>();

  exists = async (path: string): Promise<boolean> => this.files.has(path) || this.folders.has(path);
  read = async (path: string): Promise<string> => this.files.get(path) ?? '';
  write = async (path: string, content: string): Promise<void> => {
    this.files.set(path, content);
  };
  append = async (path: string, content: string): Promise<void> => {
    this.files.set(path, `${this.files.get(path) ?? ''}${content}`);
  };
  ensureFolder = async (path: string): Promise<void> => {
    this.folders.add(path);
  };
}

function sourceFiles(root: string): string[] {
  const absolute = resolve(process.cwd(), root);
  const walk = (directory: string): string[] => readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return walk(path);
    }
    return path.endsWith('.ts') ? [path] : [];
  });
  return walk(absolute);
}

interface LogCallSite {
  readonly file: string;
  readonly event: string;
  readonly dataKeys: readonly string[];
}

/**
 * Every `recordDebugLog({ … })` in the execution path, with the keys it logs.
 *
 * Read from the source rather than from a list somebody maintains: a list is a
 * thing that goes stale the first time nobody updates it, and the whole point
 * of this gate is to notice a call site that was added without thinking about
 * what it carries.
 */
function readLogCallSites(): LogCallSite[] {
  const sites: LogCallSite[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, 'utf8');
      // Up to the first `})`, not to a newline-indented one: a single-line
      // call has no newline before its close, so the lazy match ran past it and
      // swallowed the *next* block — hiding one event entirely and filing its
      // keys under the call above.
      for (const match of source.matchAll(/(?:recordDebugLog|report)\(\{([\s\S]*?)\}\)/g)) {
        const block = match[1];
        const event = /event:\s*'([^']+)'/.exec(block)?.[1] ?? '(unnamed)';
        const data = /data:\s*\{([^}]*)\}/.exec(block)?.[1] ?? '';
        // Split rather than matched: requiring a delimiter after each name
        // silently dropped the last key of every call site, which for `data: {
        // modeId }` is the only key there is — and an empty list makes every
        // assertion below pass without checking anything.
        const dataKeys = data
          .split(',')
          .map(entry => /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(entry)?.[1])
          .filter((key): key is string => Boolean(key));
        sites.push({ file: relative(process.cwd(), file), event, dataKeys });
      }
    }
  }
  return sites;
}

describe('diagnostic redaction (D7)', () => {
  const sites = readLogCallSites();

  it('finds the call sites and the keys it is meant to be checking', () => {
    // Guards the reader at **both** levels, which is the correction this file
    // needed on its own first run: the call sites were found and the keys were
    // not, so every assertion below passed over an empty list. One regex short
    // of checking nothing, in the gate whose comment says exactly that.
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.map(site => site.event)).toEqual(
      expect.arrayContaining(['execution.cleanup.failed']),
    );
    expect([...new Set(sites.flatMap(site => site.dataKeys))].sort())
      .toEqual(['code', 'modeId', 'phase', 'recordKind']);
  });

  it('writes every key it logs, instead of a row of redactions', () => {
    // **The half the key list could not check.** Naming the keys says a person
    // decided what goes under them; it does not say the redactor lets them
    // through. Three of the four here did not — `stage`, `recordKind` and a
    // `codes` array whose items are sanitized with no key at all — so warnings
    // whose whole content was the key arrived as `[redacted-string]`, on every
    // load, from the recovery that exists to say what it could not finish.
    const probe = 'not-user-content';
    const keys = [...new Set(sites.flatMap(site => site.dataKeys))];
    const written = sanitizeDebugLogData(
      Object.fromEntries(keys.map(key => [key, probe])),
    );

    expect(keys.filter(key => written[key] !== probe)).toEqual([]);
  });

  it('names every event the execution path logs', () => {
    // Printed by being asserted. A new event shows up as a diff here, which is
    // the moment to ask what it carries — not after it has been carrying it.
    expect([...new Set(sites.map(site => site.event))].sort()).toEqual([
      // The composition root's eight, which this gate did not read until it
      // learned the `report` port the root logs through: startup and shutdown
      // failures, both stores' migration requirements, and what agent recovery
      // could not finish.
      'agents.migrationRequired',
      'agents.record.failed',
      'agents.recovery.failed',
      'agents.recovery.incomplete',
      'agents.recovery.recordSkipped',
      'execution.cleanup.failed',
      'execution.connection.lost',
      'execution.migrationRequired',
      'execution.sessionConfig.failed',
      'execution.setMode.refused',
      'execution.shutdown.failed',
      'execution.start.failed',
      'execution.workspace.failed',
    ]);
  });

  it.each(Object.entries(RECOGNISABLE))(
    'never writes %s under any key the execution path logs',
    (_what, value) => {
      const keys = [...new Set(sites.flatMap(site => site.dataKeys))];
      for (const key of keys) {
        const written = JSON.stringify(sanitizeDebugLogData({ [key]: value }));
        expect(written).not.toContain(value);
      }
    },
  );

  it.each(Object.entries(UNRECOGNISABLE))(
    'never writes %s under any key nobody put on the safe list',
    (_what, value) => {
      // **Default-deny, and that is the whole of D7's enforcement.** Nothing
      // about these values could stop them, so what stops them is that a string
      // is redacted unless its key was deliberately allowed. `somethingNewEntirely`
      // is in the list to show it: a key nobody has thought about is refused,
      // which is why the safe list below is the only thing to review.
      for (const key of UNSAFE_KEYS) {
        const written = JSON.stringify(sanitizeDebugLogData({ [key]: value }));
        expect(written).not.toContain(value);
      }
    },
  );

  it('logs only keys somebody decided were never user content', () => {
    // The rule D7 actually rests on. A key here is a claim that what goes under
    // it is provider vocabulary — a mode id, a provider id, a reason — and not
    // anything a person typed. Adding one is a decision, and this is where it
    // gets made rather than noticed.
    // Four across the whole execution path, and each is a name rather than a
    // value: which mode was refused, which recovery phase skipped a record,
    // which kind of record a build cannot read, and which issue code a
    // result-link sweep collected. None of them can carry what a person typed.
    expect([...new Set(sites.flatMap(site => site.dataKeys))].sort())
      .toEqual(['code', 'modeId', 'phase', 'recordKind']);
    const written = sanitizeDebugLogData({ modeId: 'Summarize my private note' });

    // Not redacted, because it is on the safe list — which is exactly why the
    // list is short and why what goes under it has to be checked by a person.
    expect(written).toEqual({ modeId: 'Summarize my private note' });
  });

  it.each(Object.entries(RECOGNISABLE))(
    'never writes %s that reached it as an error message',
    async (_what, value) => {
      // Through the service rather than through `sanitizeDebugLogData`, which
      // is the other correction: an `Error` handed to that function comes back
      // as `{}`, so asserting against it proved nothing at all. The error is
      // sanitized on the way to the file, so the file is what has to be read.
      const adapter = new FakeVaultFileAdapter();
      const logger = new DebugLogService(adapter as never, () => true);

      await logger.write({ error: new Error(value), event: 'probe', scope: 'redaction' });

      const written = [...adapter.files.values()].join('');
      expect(written).not.toBe('');
      expect(written).not.toContain(value);
    },
  );

  it('carries an error message through, which is the residual risk D7 leaves', () => {
    // Recorded rather than fixed, because it cannot be fixed by a rule: an
    // error's own words are the reason to keep a log at all, and a provider
    // that puts a prompt into an error message would put it here. What *is*
    // stopped is everything recognisable — see above. The rest is a review
    // question about what providers raise, not a redaction question.
    const written = sanitizeDebugLogData({ errorSummary: 'the agent said something arbitrary' });

    expect(written).toEqual({ errorSummary: 'the agent said something arbitrary' });
  });

  it('still writes the fields a diagnostic is read for', () => {
    // The other half of the rule, and the one a blunter redactor would break:
    // a log that redacts everything is a log nobody can act on. These are what
    // the execution path actually logs, and they have to survive.
    const written = sanitizeDebugLogData({
      event: 'execution.setMode.refused',
      modeId: 'yolo',
      providerId: 'gemini',
      reason: 'pre-dispatch-rejected',
      scope: 'gemini',
    });

    expect(written).toMatchObject({
      event: 'execution.setMode.refused',
      modeId: 'yolo',
      providerId: 'gemini',
      reason: 'pre-dispatch-rejected',
      scope: 'gemini',
    });
  });
});
