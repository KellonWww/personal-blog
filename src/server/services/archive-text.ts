import { sha256Hex } from '@/server/auth/crypto';
import { ARCHIVE_PARSER_VERSION, type ImportItemInput } from '@/server/services/archive-import-model';

function normalizeLabels(labels: string[]): string[] {
  return [...new Set(labels.map((label) => label.normalize('NFC').trim()))].sort();
}

/** Preserve Markdown/code and all references as inert text; this does not fetch or render HTML. */
export async function prepareArchiveText(input: Pick<ImportItemInput, 'title' | 'rawContent' | 'metadata'>) {
  const title = input.title.normalize('NFC').trim();
  const content = input.rawContent.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').normalize('NFC');
  const metadata = { categories: normalizeLabels(input.metadata.categories), tags: normalizeLabels(input.metadata.tags) };
  const contentHash = await sha256Hex(JSON.stringify({ title, content, metadata }));
  return {
    title, content, metadata, metadataJson: JSON.stringify(metadata), contentHash,
    rawHash: await sha256Hex(input.rawContent), parserVersion: ARCHIVE_PARSER_VERSION,
    // Keep code block contents, unlike the old public-blog importer that discards them.
    plainText: content
  };
}
