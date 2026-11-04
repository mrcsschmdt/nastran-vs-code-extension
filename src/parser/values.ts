/**
 * Helpers for Nastran field values: classification, parsing of the Nastran
 * real-number shorthand (e.g. "1.5-3" == 1.5e-3), and fitting reals into
 * 8- or 16-character fields with the best possible precision.
 */

export type ValueKind =
  | 'blank'
  | 'int'
  | 'real'
  /** Looks numeric but is not a valid Nastran real/int, e.g. "1E5" (no decimal point). */
  | 'badReal'
  | 'string'
  | 'other';

const INT_RE = /^[+-]?\d+$/;
const REAL_RE = /^[+-]?(\d+\.\d*|\.\d+)([eEdD][+-]?\d+|[+-]\d+)?$/;
const NO_POINT_REAL_RE = /^[+-]?\d+([eEdD][+-]?\d+|[+-]\d+)$/;
const STRING_RE = /^[A-Za-z]/;

export function classify(text: string): ValueKind {
  const t = text.trim();
  if (t.length === 0) {
    return 'blank';
  }
  if (INT_RE.test(t)) {
    return 'int';
  }
  if (REAL_RE.test(t)) {
    return 'real';
  }
  if (NO_POINT_REAL_RE.test(t)) {
    return 'badReal';
  }
  if (STRING_RE.test(t)) {
    return 'string';
  }
  return 'other';
}

/** Parse a Nastran real or integer (supports "1.5-3", "1.D5", ".5", "7.") */
export function parseNumber(text: string): number {
  let t = text.trim().replace(/[dD]/, 'e');
  // Nastran shorthand exponent: mantissa directly followed by sign, e.g. 1.5-3
  t = t.replace(/^([+-]?[0-9.]*[0-9.])([+-]\d+)$/, '$1e$2');
  return Number(t);
}

/**
 * Add the missing decimal point to an integer-looking value. E exponents use
 * the compact Nastran shorthand (no 'E', explicit sign) to save field width,
 * the same form the formatter writes:
 *   "0" -> "0.", "2E11" -> "2.+11", "2e-5" -> "2.-5", "7-3" -> "7.-3".
 * D (double precision) exponents keep their letter: "1D5" -> "1.D+5".
 */
export function withDecimalPoint(text: string): string {
  const t = text.trim();
  const exp = /^([+-]?\d+)([eEdD])([+-]?)(\d+)$/.exec(t);
  if (exp) {
    const sign = exp[3] || '+';
    const letter = exp[2].toUpperCase() === 'D' ? 'D' : '';
    return `${exp[1]}.${letter}${sign}${exp[4]}`;
  }
  const shorthand = /^([+-]?\d+)([+-]\d+)$/.exec(t);
  if (shorthand) {
    return `${shorthand[1]}.${shorthand[2]}`;
  }
  return /^[+-]?\d+$/.test(t) ? `${t}.` : t;
}

function trimFixed(s: string): string {
  // s always contains a '.'
  let out = s.replace(/0+$/, '');
  out = out.replace(/^(-?)0\./, '$1.');
  if (out === '.' || out === '-.') {
    out = '0.';
  }
  return out;
}

function exponentCandidates(v: number, width: number): string[] {
  const out: string[] = [];
  for (let p = 0; p <= width; p++) {
    const s = v.toExponential(p);
    let [m, e] = s.split('e');
    if (!m.includes('.')) {
      m += '.';
    }
    m = m.replace(/0+$/, '');
    const en = parseInt(e, 10);
    out.push(`${m}${en < 0 ? '-' : '+'}${Math.abs(en)}`);
  }
  return out;
}

/**
 * Format a real so that it fits in `width` characters with the smallest
 * possible rounding error. Always includes a decimal point (Nastran requires it).
 */
export function formatReal(v: number, width: number): string {
  if (!Number.isFinite(v)) {
    return String(v);
  }
  if (v === 0) {
    return '0.';
  }
  const candidates: string[] = [];
  if (Math.abs(v) < 1e15) {
    for (let d = 0; d <= width; d++) {
      let s = v.toFixed(d);
      if (!s.includes('.')) {
        s += '.';
      }
      candidates.push(trimFixed(s));
    }
  }
  candidates.push(...exponentCandidates(v, width));

  let best: string | undefined;
  let bestErr = Infinity;
  for (const c of candidates) {
    if (c.length > width) {
      continue;
    }
    const parsed = parseNumber(c);
    if (parsed === 0) {
      continue; // never round a non-zero value to zero
    }
    const err = Math.abs(parsed - v) / Math.abs(v);
    if (err < bestErr || (err === bestErr && best !== undefined && c.length < best.length)) {
      best = c;
      bestErr = err;
    }
  }
  if (best === undefined) {
    // Could not fit at all (tiny width); return the shortest representation.
    best = candidates.reduce((a, b) => (b.length < a.length ? b : a));
  }
  return best;
}

export interface FitResult {
  text: string;
  /** The value had to be rounded to fit. */
  rounded: boolean;
  /** The value still does not fit (integer/string too long). */
  overflow: boolean;
}

/** Make a field value fit into `width` characters, rounding reals if needed. */
export function fitValue(text: string, width: number): FitResult {
  const t = text.trim();
  if (t.length <= width) {
    return { text: t, rounded: false, overflow: false };
  }
  if (classify(t) === 'real') {
    const v = parseNumber(t);
    const s = formatReal(v, width);
    return { text: s, rounded: parseNumber(s) !== v, overflow: s.length > width };
  }
  return { text: t, rounded: false, overflow: true };
}
