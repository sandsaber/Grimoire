const { copyFileSync, existsSync, mkdirSync, rmSync } = require('fs');
const path = require('path');

const RELEASE_FILES = ['main.js', 'manifest.json', 'styles.css'];

function createReleaseBundle({
  rootDir = process.cwd(),
  outputDir = path.join(rootDir, 'dist', 'grimoire'),
  files = RELEASE_FILES,
} = {}) {
  const missingFiles = files.filter((file) => !existsSync(path.join(rootDir, file)));

  if (missingFiles.length > 0) {
    throw new Error(`Missing release artifact(s): ${missingFiles.join(', ')}`);
  }

  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });

  for (const file of files) {
    copyFileSync(path.join(rootDir, file), path.join(outputDir, file));
  }

  return {
    outputDir,
    files: [...files],
  };
}

module.exports = {
  RELEASE_FILES,
  createReleaseBundle,
};
