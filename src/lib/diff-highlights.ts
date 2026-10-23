import type { DiffRow } from './toolbox';

export interface DiffPart { text: string; changed: boolean }
export interface LineHighlight { kind: 'add' | 'remove'; parts: DiffPart[] }
const INLINE_CELL_BUDGET = 1_000_000;
const PAIR_CELL_LIMIT = 100_000;

function parts(chars: string[], changed: boolean[]): DiffPart[] {
  const result: DiffPart[] = [];
  chars.forEach((char, index) => {
    const last = result[result.length - 1];
    if (last && last.changed === changed[index]) last.text += char;
    else result.push({ text: char, changed: changed[index]! });
  });
  return result;
}

function compareCharacters(before: string, after: string, ignoreWhitespace: boolean, budget: { remaining: number }) {
  const left = Array.from(before), right = Array.from(after);
  const tokens = (chars: string[]) => chars.map((char, index) => ({ char, index })).filter(({ char }) => !ignoreWhitespace || !/\s/u.test(char));
  const a = tokens(left), b = tokens(right);
  const removed = left.map((char) => !ignoreWhitespace || !/\s/u.test(char));
  const added = right.map((char) => !ignoreWhitespace || !/\s/u.test(char));
  function equal(i: number, j: number) { removed[a[i]!.index] = false; added[b[j]!.index] = false; }
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start]!.char === b[start]!.char) { equal(start, start); start++; }
  while (endA > start && endB > start && a[endA - 1]!.char === b[endB - 1]!.char) { equal(--endA, --endB); }
  const width = endB - start + 1;
  const cells = (endA - start + 1) * width;
  // Large replacements keep the common edges and highlight the middle, rather than blocking typing.
  if (cells <= Math.min(PAIR_CELL_LIMIT, budget.remaining)) {
    budget.remaining -= cells;
    const table = new Uint32Array(cells);
    for (let i = endA - start - 1; i >= 0; i--) {
      for (let j = width - 2; j >= 0; j--) {
        table[i * width + j] = a[start + i]!.char === b[start + j]!.char ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
      }
    }
    let i = start, j = start;
    while (i < endA && j < endB) {
      if (a[i]!.char === b[j]!.char) { equal(i++, j++); }
      else if (table[(i - start + 1) * width + j - start]! >= table[(i - start) * width + j - start + 1]!) i++;
      else j++;
    }
  }
  return { before: parts(left, removed), after: parts(right, added) };
}

export function diffHighlights(rows: DiffRow[], ignoreWhitespace: boolean) {
  const before = new Map<number, LineHighlight>(), after = new Map<number, LineHighlight>();
  const budget = { remaining: INLINE_CELL_BUDGET };
  let index = 0;
  while (index < rows.length) {
    if (rows[index]!.kind === 'equal') { index++; continue; }
    const removed: DiffRow[] = [], added: DiffRow[] = [];
    while (index < rows.length && rows[index]!.kind !== 'equal') {
      const row = rows[index++]!;
      (row.kind === 'remove' ? removed : added).push(row);
    }
    for (let pair = 0; pair < Math.max(removed.length, added.length); pair++) {
      const left = removed[pair], right = added[pair];
      const chunks = compareCharacters(left?.text ?? '', right?.text ?? '', ignoreWhitespace, budget);
      if (left) before.set(left.left!, { kind: 'remove', parts: chunks.before });
      if (right) after.set(right.right!, { kind: 'add', parts: chunks.after });
    }
  }
  return { before, after };
}
