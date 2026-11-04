/**
 * Hard wrapping of `$` comment lines.
 */

/** Comment prefix of a full comment line (leading blanks, `$` signs, blanks), or undefined. */
export function commentPrefix(line: string): string | undefined {
  const m = /^(\s*\$+\s*)/.exec(line);
  return m ? m[1] : undefined;
}

/**
 * Where to break a comment line that is longer than `column` characters:
 * the start/end of the blank run to replace by a line break plus the prefix.
 * Returns undefined if the line is not a comment, fits, or has no blank to
 * break at (e.g. a long `$----` separator).
 */
export function commentBreak(line: string, column: number): { start: number; end: number; prefix: string } | undefined {
  const prefix = commentPrefix(line);
  if (prefix === undefined || line.length <= column) {
    return undefined;
  }
  // last blank at or before the limit, after the prefix
  let bp = line.lastIndexOf(' ', column);
  while (bp > 0 && line[bp - 1] === ' ') {
    bp--;
  }
  if (bp <= prefix.length) {
    return undefined;
  }
  let end = bp;
  while (end < line.length && line[end] === ' ') {
    end++;
  }
  if (end >= line.length) {
    return undefined; // only trailing blanks beyond the limit
  }
  // continuation lines keep the original indentation and $ signs, with at least one blank
  const cont = /\s$/.test(prefix) ? prefix : prefix + ' ';
  return { start: bp, end, prefix: cont };
}

/**
 * All breaks needed to wrap a comment line, as ranges of the ORIGINAL line
 * (blank runs to replace by a line break plus `prefix`). Applying them
 * together gives the same result as wrapCommentLine().
 */
export function commentBreaks(line: string, column: number): { start: number; end: number; prefix: string }[] {
  const out: { start: number; end: number; prefix: string }[] = [];
  let rest = line;
  // rest[i] corresponds to line[offset + i - prefixLen] for i >= prefixLen
  let offset = 0;
  let prefixLen = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const b = commentBreak(rest, column);
    if (!b) {
      break;
    }
    const start = offset + b.start - prefixLen;
    const end = offset + b.end - prefixLen;
    out.push({ start, end, prefix: b.prefix });
    rest = b.prefix + rest.slice(b.end);
    offset = end;
    prefixLen = b.prefix.length;
  }
  return out;
}

/** Wrap one comment line into as many lines as needed (each at most `column` long when possible). */
export function wrapCommentLine(line: string, column: number): string[] {
  const out: string[] = [];
  let rest = line;
  for (let guard = 0; guard < 1000; guard++) {
    const b = commentBreak(rest, column);
    if (!b) {
      break;
    }
    out.push(rest.slice(0, b.start));
    rest = b.prefix + rest.slice(b.end);
  }
  out.push(rest);
  return out;
}
