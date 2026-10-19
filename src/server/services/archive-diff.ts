import type { ArchiveDiffLine } from '@/types/archive';

export const ARCHIVE_DIFF_MAX_LINES = 2000;
export const ARCHIVE_DIFF_MAX_CELLS = 1_000_000;

/** Plain text only: consumers must use text nodes, never innerHTML/Markdown rendering. */
export function diffArchiveLines(before: string, after: string) {
  const oldLines = before ? before.split('\n') : [];
  const newLines = after ? after.split('\n') : [];
  if (oldLines.length > ARCHIVE_DIFF_MAX_LINES || newLines.length > ARCHIVE_DIFF_MAX_LINES) {
    return null;
  }
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix++;
  }
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > prefix && newEnd > prefix && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const oldCount = oldEnd - prefix;
  const newCount = newEnd - prefix;
  const width = newCount + 1;
  const cells = (oldCount + 1) * width;
  // Bound quadratic work before allocation; callers can export both snapshots instead.
  if (cells > ARCHIVE_DIFF_MAX_CELLS) { return null; }
  const table = new Uint16Array(cells);
  for (let oldIndex = oldCount - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newCount - 1; newIndex >= 0; newIndex--) {
      table[oldIndex * width + newIndex] = oldLines[prefix + oldIndex] === newLines[prefix + newIndex]
        ? table[(oldIndex + 1) * width + newIndex + 1]! + 1
        : Math.max(table[(oldIndex + 1) * width + newIndex]!, table[oldIndex * width + newIndex + 1]!);
    }
  }
  const lines: ArchiveDiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  let added = 0;
  let removed = 0;
  function append(kind: ArchiveDiffLine['kind'], text: string) {
    lines.push({ kind, text, oldLine: kind === 'add' ? null : oldLine++, newLine: kind === 'remove' ? null : newLine++ });
    if (kind === 'add') { added++; }
    if (kind === 'remove') { removed++; }
  }
  for (let index = 0; index < prefix; index++) { append('context', oldLines[index]!); }
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldCount || newIndex < newCount) {
    if (oldIndex < oldCount && newIndex < newCount && oldLines[prefix + oldIndex] === newLines[prefix + newIndex]) {
      append('context', oldLines[prefix + oldIndex++]!);
      newIndex++;
    } else if (oldIndex < oldCount && (newIndex === newCount ||
        table[(oldIndex + 1) * width + newIndex]! >= table[oldIndex * width + newIndex + 1]!)) {
      append('remove', oldLines[prefix + oldIndex++]!);
    } else {
      append('add', newLines[prefix + newIndex++]!);
    }
  }
  for (let index = oldEnd; index < oldLines.length; index++) { append('context', oldLines[index]!); }
  return { lines, added, removed };
}
