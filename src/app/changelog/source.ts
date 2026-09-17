import { gunzipSync } from 'node:zlib';

type ReadableAdapter = {
  read: (path: string) => Promise<string>;
};

type ManifestLike = {
  id?: string;
  dir?: string;
};

declare const GRIMOIRE_CHANGELOG_GZIP: string | undefined;

export const GRIMOIRE_CHANGELOG_URL = 'https://github.com/sandsaber/Grimoire/blob/main/CHANGELOG.md';

export function getEmbeddedChangelogMarkdown(): string | null {
  try {
    if (typeof GRIMOIRE_CHANGELOG_GZIP === 'string' && GRIMOIRE_CHANGELOG_GZIP) {
      // Keep the complete changelog without consuming the Sync release size budget.
      return gunzipSync(Buffer.from(GRIMOIRE_CHANGELOG_GZIP, 'base64')).toString('utf8');
    }
  } catch {
    return null;
  }

  return null;
}

export function getBundledChangelogPath(manifest: ManifestLike | null | undefined): string {
  const dir = manifest?.dir?.trim();
  if (dir) {
    return `${dir.replace(/\/+$/, '')}/CHANGELOG.md`;
  }

  const id = manifest?.id?.trim() || 'grimoire';
  return `.obsidian/plugins/${id}/CHANGELOG.md`;
}

export async function readBundledChangelog(
  adapter: ReadableAdapter,
  manifest: ManifestLike | null | undefined,
  options: { embeddedMarkdown?: string | null } = {},
): Promise<string | null> {
  const embeddedMarkdown = options.embeddedMarkdown ?? getEmbeddedChangelogMarkdown();
  if (embeddedMarkdown?.trim()) {
    return embeddedMarkdown;
  }

  try {
    return await adapter.read(getBundledChangelogPath(manifest));
  } catch {
    return null;
  }
}
