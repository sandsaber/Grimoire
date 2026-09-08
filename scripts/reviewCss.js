const { existsSync, readFileSync, readdirSync } = require('fs');
const { join } = require('path');

/**
 * CSS features that Obsidian community plugin CSS review flags as only
 * partially supported against their Electron / 1.11.4 compatibility baseline.
 *
 * Keep this list in sync with recurring review warnings — intentionally small
 * and explicit rather than a full browserslist matrix. When Obsidian reports a
 * new partial-support CSS warning:
 *   1. Rewrite the stylesheet to avoid the feature (preferred).
 *   2. Append an entry here (same feature id / message wording when possible).
 *   3. Cover it in tests/unit/scripts/reviewGate.test.ts.
 *   4. Document recurring patterns in src/style/AGENTS.md and CONTRIBUTING.md.
 */
const OBSIDIAN_PARTIAL_CSS_FEATURES = Object.freeze([
  {
    id: 'css-display-contents',
    pattern: /display\s*:\s*contents\b/i,
    message:
      'Unexpected browser feature "css-display-contents" is only partially supported by Obsidian 1.11.4',
  },
  {
    // The Level 3 longhands and the multi-value shorthand, not the plain
    // `text-decoration: underline | line-through | none` the sheet uses in
    // eight places and Obsidian does not flag.
    //
    // The shorthand's values stop at a brace as well as at a semicolon. The
    // built sheet is one minified line, so without that a plain
    // `text-decoration:underline}` ran on into the next rule and found its
    // "second value" in a neighbouring declaration — which is why
    // `build:release` passed on a clean checkout and failed on the second run,
    // once the previous build had left `styles.css` behind to be scanned.
    id: 'text-decoration',
    pattern:
      /(?:text-decoration-(?:color|line|style|thickness)|text-underline-(?:offset|position))\s*:|text-decoration\s*:\s*[^;{}\s]+\s+[^;{}\s]+/i,
    message:
      'Unexpected browser feature "text-decoration" is only partially supported by Obsidian 1.11.4',
  },
]);

function findImportantDeclarations(inputs) {
  const findings = [];

  for (const input of inputs) {
    const contents = stripCssComments(input.contents);
    const lines = contents.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      if (!line.includes('!important')) {
        continue;
      }

      findings.push({
        file: input.file,
        line: index + 1,
        declaration: line.trim(),
      });
    }
  }

  return findings;
}

function findPartialCssSupportFeatures(inputs, features = OBSIDIAN_PARTIAL_CSS_FEATURES) {
  const findings = [];

  for (const input of inputs) {
    const contents = stripCssComments(input.contents);
    const lines = contents.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      for (const feature of features) {
        if (!feature.pattern.test(line)) {
          continue;
        }

        findings.push({
          file: input.file,
          line: index + 1,
          featureId: feature.id,
          declaration: line.trim(),
          message: feature.message,
        });
      }
    }
  }

  return findings;
}

function collectReviewCssFiles(rootDir) {
  return [
    ...collectCssFiles(join(rootDir, 'src', 'style')),
    join(rootDir, 'styles.css'),
  ].filter((file) => existsSync(file));
}

function readReviewCssInputs(rootDir, relativePath) {
  return collectReviewCssFiles(rootDir).map((file) => ({
    file: relativePath(rootDir, file),
    contents: readFileSync(file, 'utf8'),
  }));
}

function collectCssFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }

  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectCssFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      files.push(path);
    }
  }
  return files;
}

function stripCssComments(contents) {
  return contents.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, ''));
}

module.exports = {
  OBSIDIAN_PARTIAL_CSS_FEATURES,
  collectReviewCssFiles,
  findImportantDeclarations,
  findPartialCssSupportFeatures,
  readReviewCssInputs,
};
