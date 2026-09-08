import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';

/**
 * What a file will cost, roughly.
 *
 * No provider exposes a tokeniser Grimoire can call before the turn is sent,
 * so this is a character estimate and every surface that shows it says "est."
 * A precise-looking number that was guessed is worse than an obviously rough
 * one: the reader decides what to remove based on it.
 *
 * Four characters to the token is the ratio the vendors publish for English
 * prose; a note that is mostly code or CJK will be under-counted, which is why
 * the label matters more than the constant.
 */
const CHARACTERS_PER_TOKEN = 4;

/** The estimate for a size in bytes, or `null` when the size is unknown. */
export function estimateTokensFromBytes(bytes: number | null | undefined): number | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  return Math.max(1, Math.round(bytes / CHARACTERS_PER_TOKEN));
}

/**
 * The estimate for a vault path.
 *
 * Reads `stat.size` rather than the file, because opening every attachment to
 * count it would make the manage dialog cost more than the turn it is about.
 */
export function estimateVaultFileTokens(app: App, path: string): number | null {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return null;
  return estimateTokensFromBytes(file.stat?.size);
}

/** Every markdown-ish file under a folder, one level deep and below. */
export function listFolderFiles(app: App, path: string): TFile[] {
  const folder = app.vault.getAbstractFileByPath(path);
  if (!(folder instanceof TFolder)) return [];
  const files: TFile[] = [];
  const walk = (node: TFolder): void => {
    for (const child of node.children) {
      if (child instanceof TFolder) walk(child);
      else if (child instanceof TFile) files.push(child);
    }
  };
  walk(folder);
  return files;
}
