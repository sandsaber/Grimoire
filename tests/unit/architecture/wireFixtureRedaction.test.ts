import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * What a wire recording is allowed to carry.
 *
 * These files are checked in, replayed by the wire-vocabulary gate on every
 * run, and read by anyone debugging a provider — so whatever is in them is
 * published to everyone who clones the repository. A recording is taken from a
 * real session on a real machine, which is exactly why it has to be scrubbed:
 * the first Grok capture caught a live API key, and two files still carried the
 * recorder's home directory in tool payloads. A home path is the account name
 * of whoever recorded it.
 *
 * The recordings keep the *shape* of a path, which is all any assertion needs.
 */
const WIRE = resolve(process.cwd(), 'tests/fixtures/provider-traces/wire');

/** Home directories on the three platforms this plugin runs on. */
const HOME_PATH = /\/home\/(?!grimoire\b)[A-Za-z0-9._-]+|\/Users\/(?!grimoire\b)[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\(?!grimoire\b)[A-Za-z0-9._-]+/g;

/** Shapes that are a credential whatever else they are. */
const SECRET = /\b(?:sk-[A-Za-z0-9_-]{16,}|xai-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{12,})\b/g;

function wireFixtures(): string[] {
  return readdirSync(WIRE).filter(name => name.endsWith('.json')).sort();
}

describe('wire fixture redaction', () => {
  const fixtures = wireFixtures();

  it('finds the recordings it is meant to guard', () => {
    // Guards the guard: a directory that matched nothing would make every
    // assertion below vacuously true.
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(wireFixtures())('%s names nobody\'s home directory', name => {
    const source = readFileSync(join(WIRE, name), 'utf8');

    expect(source.match(HOME_PATH) ?? []).toEqual([]);
  });

  it.each(wireFixtures())('%s carries no credential shape', name => {
    const source = readFileSync(join(WIRE, name), 'utf8');

    expect(source.match(SECRET) ?? []).toEqual([]);
  });

  it('recognises the things it is looking for', () => {
    // The patterns are the whole test, so they are exercised directly rather
    // than trusted: a regex that matched nothing would pass every row above.
    expect('/home/alice/notes'.match(HOME_PATH)).toEqual(['/home/alice']);
    expect('/Users/bob/vault'.match(HOME_PATH)).toEqual(['/Users/bob']);
    expect('C:\\Users\\carol\\vault'.match(HOME_PATH)).toEqual(['C:\\Users\\carol']);
    // And leaves the placeholder alone, or the fixtures could never pass.
    expect('/home/grimoire/vault'.match(HOME_PATH)).toBeNull();
    expect('xai-abcdefghijklmnopqrstuvwx'.match(SECRET)).toHaveLength(1);
  });
});
