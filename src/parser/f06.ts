/**
 * Scanner for Nastran output (.f06) files. Pure logic (no vscode import) so it can be unit tested.
 *
 * What it finds:
 *  - sections: the .f06 prints its headings with blanks between the letters
 *    ("R E A L   E I G E N V A L U E S"). A table repeats its heading on every page, so
 *    consecutive pages with the same heading, subcase and design cycle form one section.
 *  - solver messages: "*** USER FATAL MESSAGE 2101 (GP1)", "^^^ USER WARNING MESSAGE ...",
 *    "*** SYSTEM INFORMATION MESSAGE ..." with the text printed below them.
 *  - subcases (from the page header), FREQUENCY / TIME / LOAD STEP values printed above
 *    the heading on each page, design cycles of SOL 200 ("DESIGN CYCLE NUMBER = 2") and
 *    the "* * * END OF JOB * * *" line.
 *
 * Every page starts with "1" in column 1 (carriage control), followed by the page header.
 */

export type F06Severity = 'fatal' | 'warning' | 'information';

export interface F06Message {
  /** Line of the "*** ... MESSAGE" header. */
  line: number;
  /** Last line of the message text (= line if there is no text). */
  endLine: number;
  severity: F06Severity;
  /** Normalized header, e.g. "USER FATAL MESSAGE 2101 (GP1)". */
  header: string;
  number?: number;
  /** Module in parentheses, e.g. "GP1" or "SUBDMAP MODEFSRS". */
  module?: string;
  /** Text printed below the header, joined into one line. */
  text: string;
  /** "***" lines directly above the header (e.g. "*** INVALID CHARACTER ..." before "THE MESSAGES ABOVE ARE FROM CRCARD"). */
  preceding: string[];
}

export interface F06Steps {
  /** FREQUENCY, TIME, LOAD STEP, POINT-ID or ELEMENT-ID. */
  label: string;
  first: string;
  last: string;
  /** Number of pages with a value. */
  count: number;
}

export interface F06Section {
  /** Heading without the letter spacing, e.g. "REAL EIGENVALUES" or "REAL EIGENVECTOR NO. 3". */
  title: string;
  /** Line of the first heading. */
  line: number;
  endLine: number;
  /** Line of the last repetition of the heading. */
  lastTitleLine: number;
  subcase?: number;
  cycle?: number;
  firstPage?: number;
  lastPage?: number;
  /** Number of times the heading is printed (usually one per page). */
  occurrences: number;
  steps?: F06Steps;
}

export interface F06Cycle {
  cycle: number;
  line: number;
  endLine: number;
}

export interface ParsedF06 {
  sections: F06Section[];
  messages: F06Message[];
  cycles: F06Cycle[];
  /** Line of "* * * END OF JOB * * *", or -1. */
  endOfJob: number;
  pages: number;
  /** Text before the first section (copyright notice, news file), if any. */
  preamble?: { line: number; endLine: number };
}

// ---------------------------------------------------------------------------
// Headings

/** Characters of a letter-spaced heading word ("( Q U A D 4 )", "N O ."). */
const CH = "[A-Z0-9().,=/+&'-]";
const WORD = `${CH}(?: ${CH})+(?!\\S)`;
/** Letter-spaced words separated by 2-8 blanks. */
const SPACED_RUN = new RegExp(`(?<!\\S)${WORD}(?:\\s{2,8}${WORD})*`, 'g');
const QUICK = /[A-Z] [A-Z] [A-Z]/;

export interface SpacedTitle {
  title: string;
  start: number;
  end: number;
}

/**
 * The letter-spaced heading on a line, e.g. "R E A L   E I G E N V A L U E S" -> "REAL EIGENVALUES".
 * Needs at least 6 letters and one word of 3+ letters, so table rows like "1 = 1" or the
 * "M O" label of the grid point weight generator are not headings.
 */
export function spacedTitle(line: string): SpacedTitle | undefined {
  if (!QUICK.test(line)) {
    return undefined;
  }
  let best: { words: string[]; start: number; end: number } | undefined;
  for (const m of line.matchAll(SPACED_RUN)) {
    const words = m[0].split(/\s{2,}/).map((w) => w.replace(/ /g, ''));
    const letters = words.join('').replace(/[^A-Z]/g, '').length;
    if (letters < 6 || !words.some((w) => /[A-Z]{3}/.test(w))) {
      continue;
    }
    if (!best || m[0].length > best.end - best.start) {
      best = { words, start: m.index!, end: m.index! + m[0].length };
    }
  }
  // a "$ S U B C A S E S" comment in the echoed input deck is not a heading
  if (!best || line.lastIndexOf('$', best.start) >= 0) {
    return undefined;
  }
  let title = best.words.join(' ');
  // a mode number after "N O ." and a note in parentheses ("(READ MODULE)") belong to the heading
  const rest = line.slice(best.end).trim();
  if (/NO\.$/.test(title) && /^\d+$/.test(rest)) {
    title += ' ' + rest;
  } else if (/^\([^()]*\)$/.test(rest)) {
    title += ' ' + rest.replace(/\s+/g, ' ');
  }
  return { title, start: best.start, end: best.end };
}

// ---------------------------------------------------------------------------
// Scanner

const PAGE_BREAK = /^1(?:\s|$)/;
const PAGE_NUMBER = /\bPAGE\s+(\d+)\s*$/;
const SUBCASE_RE = /\b(SUBCASE|SUBCOM|SYMCOM|REPCASE)\s*=?\s*(\d+)\s*$/;
const STEP_RE = /^.?\s+(FREQUENCY|TIME|LOAD STEP|POINT-ID|ELEMENT-ID)\s*=\s*(\S+)/;
const CYCLE_RE = /DESIGN CYCLE NUMBER\s*=\s*(\d+)/;
const CYCLE_HISTORY = /DESIGN CYCLE HISTORY/;
const END_OF_JOB = /\*\s*\*\s*\*\s*END OF JOB\s*\*\s*\*\s*\*/;
const MESSAGE_RE = /^.?\s*(?:\*\*\*|\^\^\^)\s*((?:[A-Z]+\s+)*?)(FATAL|WARNING|INFORMATION|INFORMATIVE)\s+MESSAGE\b\s*(\d+)?\s*(?:\(\s*([^)]*?)\s*\))?/;
const MARKER = /^.?\s*(?:\*\*\*|\^\^\^)/;
/** Blank lines, a lone carriage control character, and lines of '*', '-', '=' (boxes around headings). */
const FILLER = /^[01]?[\s*=\-^]*$/;
const MAX_MESSAGE_LINES = 12;
const MAX_MESSAGE_TEXT = 500;

export function parseF06(input: string | string[]): ParsedF06 {
  const lines = typeof input === 'string' ? input.split(/\r?\n/) : input;
  const n = lines.length;
  const sections: F06Section[] = [];
  const messages: F06Message[] = [];
  const cycles: F06Cycle[] = [];
  let endOfJob = -1;
  let pages = 0;

  let lastPageBreak = -1;
  let page: number | undefined;
  let pageSubcase: number | undefined;
  let pageStep: { label: string; value: string } | undefined;
  let cycle: number | undefined;
  let openCycle: F06Cycle | undefined;
  let current: F06Section | undefined;

  let lastClosed: F06Section | undefined;

  /**
   * Last line of a block (section or design cycle) whose last heading is on line `from`, when
   * the next block starts on line t: the line before the page header in front of t if t is on
   * a later page, otherwise the line before t. At the end of the job (`last`) the block runs to
   * the line before t. Trailing blank lines and box borders are dropped.
   */
  const endBefore = (t: number, from: number, last = false): number => {
    let e = !last && lastPageBreak > from && lastPageBreak < t ? lastPageBreak - 1 : t - 1;
    while (e > from && FILLER.test(lines[e])) {
      e--;
    }
    return Math.max(e, from);
  };
  const closeSection = (t: number, last = false) => {
    if (current) {
      current.endLine = endBefore(t, current.lastTitleLine, last);
      lastClosed = current;
      current = undefined;
    }
  };
  /** Call after closeSection: a cycle always contains its last section. */
  const closeCycle = (t: number, last = false) => {
    if (openCycle) {
      let e = endBefore(t, openCycle.line, last);
      if (lastClosed && lastClosed.line >= openCycle.line) {
        e = Math.max(e, lastClosed.endLine);
      }
      openCycle.endLine = e;
      openCycle = undefined;
    }
  };

  for (let i = 0; i < n; i++) {
    const raw = lines[i];

    if (END_OF_JOB.test(raw)) {
      closeSection(i, true);
      closeCycle(i, true);
      endOfJob = i;
      break;
    }

    if (PAGE_BREAK.test(raw)) {
      lastPageBreak = i;
      pages++;
      const pm = PAGE_NUMBER.exec(raw);
      page = pm ? parseInt(pm[1], 10) : undefined;
      pageSubcase = undefined;
      pageStep = undefined;
      continue;
    }

    // page header: "0   <label>          SUBCASE 1" (right-aligned)
    if (lastPageBreak >= 0 && i - lastPageBreak <= 3) {
      const sm = SUBCASE_RE.exec(raw);
      if (sm && sm.index >= 40) {
        pageSubcase = parseInt(sm[2], 10);
        continue;
      }
    }

    const msg = MESSAGE_RE.exec(raw);
    if (msg) {
      // the message text is scanned too: it can carry "DESIGN CYCLE NUMBER = n"
      messages.push(readMessage(lines, i, msg));
      continue;
    }

    const cm = CYCLE_RE.exec(raw);
    if (cm) {
      const c = parseInt(cm[1], 10);
      if (c !== cycle) {
        closeSection(i);
        closeCycle(i);
        cycle = c;
        openCycle = { cycle: c, line: i, endLine: i };
        cycles.push(openCycle);
      }
      continue;
    }

    const st = STEP_RE.exec(raw);
    if (st) {
      pageStep = { label: st[1], value: st[2] };
      continue;
    }

    const body = /^[01]/.test(raw) ? ' ' + raw.slice(1) : raw;
    const t = spacedTitle(body);
    if (!t) {
      continue;
    }
    if (openCycle && CYCLE_HISTORY.test(t.title)) {
      closeSection(i);
      closeCycle(i);
      cycle = undefined;
    }
    if (current && current.title === t.title && current.subcase === pageSubcase && current.cycle === cycle) {
      current.lastTitleLine = i;
      current.lastPage = page ?? current.lastPage;
      current.occurrences++;
    } else {
      closeSection(i);
      current = {
        title: t.title,
        line: i,
        endLine: i,
        lastTitleLine: i,
        subcase: pageSubcase,
        cycle,
        firstPage: page,
        lastPage: page,
        occurrences: 1,
      };
      sections.push(current);
    }
    if (pageStep) {
      const s = current.steps;
      if (!s || s.label !== pageStep.label) {
        current.steps = { label: pageStep.label, first: pageStep.value, last: pageStep.value, count: 1 };
      } else {
        s.last = pageStep.value;
        s.count++;
      }
      pageStep = undefined;
    }
  }
  closeSection(n, true);
  closeCycle(n, true);
  return { sections, messages, cycles, endOfJob, pages, preamble: findPreamble(lines, sections, cycles, endOfJob) };
}

/**
 * The text before the first section (copyright notice, news file ...): from its first
 * non-blank line to the line before the page header in front of the first section.
 */
function findPreamble(lines: string[], sections: F06Section[], cycles: F06Cycle[], endOfJob: number): { line: number; endLine: number } | undefined {
  const first = Math.min(sections[0]?.line ?? Infinity, cycles[0]?.line ?? Infinity, endOfJob >= 0 ? endOfJob : Infinity);
  if (!Number.isFinite(first)) {
    return undefined;
  }
  let start = 0;
  while (start < first && FILLER.test(lines[start])) {
    start++;
  }
  let end = first - 1;
  for (let k = first - 1; k > start; k--) {
    if (PAGE_BREAK.test(lines[k])) {
      end = k - 1;
      break;
    }
  }
  while (end > start && FILLER.test(lines[end])) {
    end--;
  }
  return end > start ? { line: start, endLine: end } : undefined;
}

function readMessage(lines: string[], i: number, m: RegExpExecArray): F06Message {
  const origin = m[1].trim().replace(/\s+/g, ' ');
  const sev = m[2] === 'FATAL' ? 'fatal' : m[2] === 'WARNING' ? 'warning' : 'information';
  const num = m[3] ? parseInt(m[3], 10) : undefined;
  const module = m[4]?.replace(/\s+/g, ' ') || undefined;
  const header = [origin, m[2], 'MESSAGE', m[3] ?? '', module ? `(${module})` : ''].filter(Boolean).join(' ');

  const text: string[] = [];
  // text on the header line after "(MODULE)"
  const tail = lines[i].slice(m[0].length).trim();
  if (tail) {
    text.push(tail);
  }
  let end = i;
  for (let k = i + 1; k < lines.length && k <= i + MAX_MESSAGE_LINES; k++) {
    const l = lines[k];
    // the text ends at a blank line, a new page, the next message, a line with carriage control "0"
    // (new paragraph), echoed input ("$..." comments) or a heading
    if (!l.trim() || /^0/.test(l) || l.trimStart().startsWith('$') || PAGE_BREAK.test(l) || MARKER.test(l) || END_OF_JOB.test(l) || spacedTitle(l)) {
      break;
    }
    text.push(l.trim());
    end = k;
  }

  const preceding: string[] = [];
  for (let k = i - 1; k >= 0 && k >= i - 5; k--) {
    const l = lines[k];
    if (!MARKER.test(l) || MESSAGE_RE.test(l)) {
      break;
    }
    const s = l.replace(/^.?\s*(?:\*\*\*|\^\^\^)\s*/, '').trim();
    if (s) {
      preceding.unshift(s);
    }
  }

  let joined = text.join(' ').replace(/\s+/g, ' ');
  if (joined.length > MAX_MESSAGE_TEXT) {
    joined = joined.slice(0, MAX_MESSAGE_TEXT - 1) + '…';
  }
  return { line: i, endLine: end, severity: sev, header, number: num, module, text: joined, preceding };
}

// ---------------------------------------------------------------------------
// Folding

export interface F06Fold {
  start: number;
  end: number;
  kind?: 'region';
}

/** Folds for the preamble, sections, multi-line messages and (with two or more) design cycles. */
export function f06Folds(f: ParsedF06): F06Fold[] {
  const out: F06Fold[] = [];
  if (f.preamble) {
    out.push({ start: f.preamble.line, end: f.preamble.endLine });
  }
  if (f.cycles.length > 1) {
    for (const c of f.cycles) {
      if (c.endLine > c.line) {
        out.push({ start: c.line, end: c.endLine, kind: 'region' });
      }
    }
  }
  for (const s of f.sections) {
    if (s.endLine > s.line) {
      out.push({ start: s.line, end: s.endLine });
    }
  }
  for (const m of f.messages) {
    if (m.endLine > m.line) {
      out.push({ start: m.line, end: m.endLine });
    }
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

const SEVERITY_RANK: Record<F06Severity, number> = { fatal: 0, warning: 1, information: 2 };

/** Messages at or above a minimum severity ('fatal' < 'warning' < 'information'). */
export function messagesAtLeast(f: ParsedF06, min: F06Severity): F06Message[] {
  return f.messages.filter((m) => SEVERITY_RANK[m.severity] <= SEVERITY_RANK[min]);
}

/** The innermost section containing a line. */
export function sectionAt(f: ParsedF06, line: number): F06Section | undefined {
  let lo = 0;
  let hi = f.sections.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = f.sections[mid];
    if (line < s.line) {
      hi = mid - 1;
    } else if (line > s.endLine) {
      lo = mid + 1;
    } else {
      return s;
    }
  }
  return undefined;
}
