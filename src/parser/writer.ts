/**
 * Writes bulk data cards in small-field, large-field or free-field format.
 */
import { FieldFormat } from './deck';
import { classify, fitValue } from './values';

/** left / right: every value; mixed: numbers right, text left (FEMAP style). */
export type Alignment = 'left' | 'right' | 'mixed';

export interface WriteOptions {
  alignment: Alignment;
  /** Field 1 text for small-field continuation lines ('' = blank continuation). */
  continuationMarker: string;
  uppercase: boolean;
}

export const DEFAULT_WRITE_OPTIONS: WriteOptions = {
  alignment: 'left',
  continuationMarker: '+',
  uppercase: true,
};

export interface WriteResult {
  lines: string[];
  /** Format actually written (small may be promoted to large if a value cannot fit). */
  format: FieldFormat;
  /** Number of real values that had to be rounded to fit the field width. */
  rounded: number;
  /** Number of values that do not fit even after rounding. */
  overflow: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  if (out.length === 0) {
    out.push([]);
  }
  return out;
}

function trimTrailingBlanks(values: string[]): string[] {
  const v = values.slice();
  while (v.length && v[v.length - 1].trim() === '') {
    v.pop();
  }
  return v;
}

function fitAll(values: string[], width: number) {
  let rounded = 0;
  let overflow = 0;
  const out = values.map((v) => {
    const r = fitValue(v, width);
    if (r.rounded) {
      rounded++;
    }
    if (r.overflow) {
      overflow++;
    }
    return r.text;
  });
  return { out, rounded, overflow };
}

function pad(s: string, width: number, align: Alignment): string {
  const right = align === 'right' || (align === 'mixed' && classify(s) !== 'string');
  return right ? s.padStart(width) : s.padEnd(width);
}

function writeFixed(name: string, values: string[], large: boolean, opts: WriteOptions): WriteResult {
  const width = large ? 16 : 8;
  const per = large ? 4 : 8;
  const { out, rounded, overflow } = fitAll(values, width);
  const rows = chunk(out, per);
  const lines = rows.map((row, r) => {
    let head: string;
    if (r === 0) {
      head = (large ? name + '*' : name).padEnd(8);
    } else if (large) {
      head = '*'.padEnd(8);
    } else {
      head = opts.continuationMarker.padEnd(8).slice(0, 8);
    }
    let line = head + row.map((v) => pad(v, width, opts.alignment)).join('');
    const marker = opts.continuationMarker.trim().slice(0, 8);
    if (!large && marker && r < rows.length - 1) {
      // Field 10 of a line that is continued repeats the marker of the next line's field 1 (FEMAP style).
      line = line.padEnd(72) + marker;
    }
    line = line.replace(/\s+$/, '');
    if (line.length === 0) {
      // A completely blank line would be ignored by Nastran: force a marker.
      line = '+';
    }
    return line;
  });
  return { lines, format: large ? 'large' : 'small', rounded, overflow };
}

function writeFree(name: string, values: string[]): WriteResult {
  // Use small free field (8 values per line) when all values fit in 8
  // characters without rounding; otherwise use large free field ('NAME*,')
  // with 4 values per line so no precision is lost.
  const small = fitAll(values, 8);
  const large = small.rounded > 0 || small.overflow > 0;
  const per = large ? 4 : 8;
  const vals = large ? fitAll(values, 16) : small;
  const rows = chunk(vals.out, per);
  const lines = rows.map((row, r) => {
    const head = r === 0 ? (large ? name + '*' : name) : large ? '*' : '+';
    const trimmed = trimTrailingBlanks(row);
    return [head, ...trimmed].join(',');
  });
  return { lines, format: 'free', rounded: vals.rounded, overflow: vals.overflow };
}

/**
 * Write a card. `values` are the data fields (index 0 = field 2).
 */
export function writeCard(
  name: string,
  values: string[],
  format: FieldFormat,
  opts: WriteOptions = DEFAULT_WRITE_OPTIONS,
): WriteResult {
  let n = name.trim().replace(/\*$/, '');
  let vals = trimTrailingBlanks(values.map((v) => v.trim()));
  if (opts.uppercase) {
    n = n.toUpperCase();
    vals = vals.map((v) => v.toUpperCase());
  }
  if (format === 'free') {
    return writeFree(n, vals);
  }
  if (format === 'small') {
    const res = writeFixed(n, vals, false, opts);
    if (res.overflow > 0) {
      // Something (long integer / label) cannot be represented in 8 chars.
      const big = writeFixed(n, vals, true, opts);
      if (big.overflow < res.overflow) {
        return big;
      }
    }
    return res;
  }
  return writeFixed(n, vals, true, opts);
}
