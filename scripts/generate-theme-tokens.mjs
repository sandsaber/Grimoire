#!/usr/bin/env node
/*
 * Regenerates tests/fixtures/obsidian/theme-tokens.json — the environment
 * tests/unit/style/themeAdaptation.test.ts resolves the Grimoire token layer
 * against.
 *
 * The values are read out of the app.css inside the installed Obsidian asar
 * rather than remembered, because a token that does not exist fails silently:
 * `color: var(--missing)` inherits rather than falling back. That is how this
 * plugin shipped a fixed violet on thirty-two surfaces — Obsidian defines
 * `--color-<hue>-rgb` for its palette and no accent triple at all.
 *
 * Only the root tables are read (`body`, `.theme-light`, `.theme-dark`).
 * Collecting every declaration in the file picks up component-scoped ones and
 * makes `--background-modifier-border` resolve to `transparent` on both themes.
 *
 *   node scripts/generate-theme-tokens.mjs [path/to/obsidian-x.y.z.asar]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TOKEN_LAYER = 'src/style/base/variables.css';
const FIXTURE = 'tests/fixtures/obsidian/theme-tokens.json';

function defaultAsarDirectory() {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'obsidian');
  }
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Obsidian');
  }
  return join(homedir(), '.config', 'obsidian');
}

function newestAsar() {
  const directory = defaultAsarDirectory();
  const candidates = readdirSync(directory)
    .filter((entry) => /^obsidian-\d+\.\d+\.\d+\.asar$/.test(entry))
    .sort((a, b) => compareVersions(versionOf(a), versionOf(b)));
  const newest = candidates.at(-1);
  if (!newest) {
    throw new Error(`No obsidian-<version>.asar under ${directory}. Pass one as an argument.`);
  }
  return join(directory, newest);
}

const versionOf = (name) => name.replace(/^obsidian-|\.asar$/g, '');

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/** Reads one file out of an asar archive without unpacking the rest of it. */
function readFromAsar(asarPath, wanted) {
  const archive = readFileSync(asarPath);
  const headerPickleSize = archive.readUInt32LE(4);
  const jsonSize = archive.readUInt32LE(12);
  const header = JSON.parse(archive.subarray(16, 16 + jsonSize).toString('utf8'));
  const contentBase = 16 + headerPickleSize - 8;

  const walk = (node, path) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const childPath = `${path}/${name}`;
      if (child.files) {
        const found = walk(child, childPath);
        if (found) return found;
      } else if (childPath === wanted) {
        return child;
      }
    }
    return null;
  };

  const entry = walk(header, '');
  if (!entry) throw new Error(`${wanted} is not in ${asarPath}`);
  const offset = contentBase + Number(entry.offset);
  return archive.subarray(offset, offset + entry.size).toString('utf8');
}

/**
 * Every custom property declared by one root selector, last declaration winning.
 *
 * The pattern matches innermost rules and consumes no closing brace of its own,
 * which matters: anchoring each rule on the previous `}` makes the scan skip
 * every other rule, and the first draft of this silently missed `.theme-light`
 * entirely — the light theme resolved to `body` alone and looked plausible.
 */
function rootTable(css, selector) {
  const table = {};
  const rule = /([^{}]*)\{([^{}]*)\}/g;
  for (const match of css.matchAll(rule)) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (!selectors.includes(selector)) continue;
    for (const declaration of match[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+)/g)) {
      table[declaration[1]] = declaration[2].trim();
    }
  }
  return table;
}

/** The Obsidian variables the Grimoire layer reads, and everything they reach. */
function closure(seeds, table) {
  const reached = new Map();
  const absent = new Set();
  const queue = [...seeds];
  while (queue.length > 0) {
    const name = queue.shift();
    if (reached.has(name)) continue;
    const value = table[name];
    if (value === undefined) {
      absent.add(name);
      continue;
    }
    reached.set(name, value);
    for (const reference of value.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      queue.push(reference[1]);
    }
  }
  return { reached, absent };
}

const asarPath = process.argv[2] ?? newestAsar();
const appCss = readFromAsar(asarPath, '/app.css');

const layer = readFileSync(TOKEN_LAYER, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const seeds = new Set();
for (const reference of layer.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
  if (!reference[1].startsWith('--grimoire-')) seeds.add(reference[1]);
}

const body = rootTable(appCss, 'body');
const themes = {
  light: { ...body, ...rootTable(appCss, '.theme-light') },
  dark: { ...body, ...rootTable(appCss, '.theme-dark') },
};

const absentFromObsidian = new Set();
const fixture = {
  source: `app.css from ${asarPath.split('/').at(-1)}, read rather than remembered`,
  note: 'The transitive closure of the Obsidian variables Grimoire depends on, taken from the root tables only (body, .theme-light, .theme-dark). Regenerate with scripts/generate-theme-tokens.mjs when the app is upgraded.',
  light: {},
  dark: {},
  absentFromObsidian: [],
};

for (const theme of ['light', 'dark']) {
  const { reached, absent } = closure(seeds, themes[theme]);
  for (const name of absent) absentFromObsidian.add(name);
  fixture[theme] = Object.fromEntries([...reached].sort(([a], [b]) => a.localeCompare(b)));
}
fixture.absentFromObsidian = [...absentFromObsidian].sort();

writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
process.stdout.write(
  `${FIXTURE}: ${Object.keys(fixture.dark).length} variables from ${asarPath}\n`
  + (fixture.absentFromObsidian.length > 0
    ? `absent from Obsidian: ${fixture.absentFromObsidian.join(', ')}\n`
    : ''),
);
