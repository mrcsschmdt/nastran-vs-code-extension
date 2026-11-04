/**
 * Nastran input deck parser.
 *
 * Splits a file into Executive Control / Case Control / Bulk Data sections,
 * parses bulk data cards in small-field (8 char), large-field (16 char) and
 * free-field (comma separated) formats including continuations, and records
 * INCLUDE statements and case control commands.
 *
 * Pure TypeScript (no vscode dependency) so it can be unit tested.
 */

export type FieldFormat = 'small' | 'large' | 'free';
export type SectionKind = 'exec' | 'case' | 'bulk' | 'end';

/** Character range [start, end) on a single line (original, un-expanded columns). */
export interface Span {
  line: number;
  start: number;
  end: number;
}

export interface FieldSlot {
  /** Trimmed field text, original case. */
  text: string;
  span: Span;
  /** True if the slot was padded (does not physically exist on the line). */
  virtual?: boolean;
}

export interface CardLine {
  line: number;
  format: FieldFormat;
  /** Field 1: card name or continuation marker. */
  head: FieldSlot;
  /** Data fields (8 for small, 4 for large, padded); index into card.fields starts at `firstIndex`. */
  data: FieldSlot[];
  firstIndex: number;
  /** Field 10 (continuation marker), if present. */
  cont?: FieldSlot;
  /** Non-blank characters after column 80 (fixed format only). */
  overflow?: Span;
  /** Free-field line with more fields than allowed. */
  tooManyFreeFields?: boolean;
}

export interface Card {
  /** Upper-case card name without the large-field '*'. */
  name: string;
  nameSpan: Span;
  format: FieldFormat;
  startLine: number;
  endLine: number;
  lines: CardLine[];
  /** Flattened data fields; index 0 = field 2 of the first line. */
  fields: FieldSlot[];
  /** Comment lines located between the first and last line of the card. */
  innerComments: number[];
}

export interface IncludeStatement {
  path: string;
  /** Spans of the path text (several if the path continues over lines). */
  spans: Span[];
  startLine: number;
  endLine: number;
  section: SectionKind;
}

export interface CaseCommand {
  /** Upper-case command name, e.g. "DISPLACEMENT" or "SUBCASE". */
  name: string;
  nameSpan: Span;
  /** Describers in parentheses, e.g. ["PLOT", "SORT1"]. */
  describers: FieldSlot[];
  /** Text to the right of '=' (or after the name for SUBCASE/SET-less forms). */
  value: string;
  valueSpan?: Span;
  startLine: number;
  endLine: number;
  /** Subcase ID the command belongs to (undefined = global / above first subcase). */
  subcase?: number;
}

export interface ExecStatement {
  name: string;
  nameSpan: Span;
  args: string;
  argsSpan?: Span;
  line: number;
}

export interface SectionRange {
  kind: SectionKind;
  startLine: number;
  endLine: number;
}

export interface Subcase {
  id: number;
  line: number;
  endLine: number;
}

export interface ParsedDeck {
  lineCount: number;
  sections: SectionRange[];
  cards: Card[];
  includes: IncludeStatement[];
  caseCommands: CaseCommand[];
  execStatements: ExecStatement[];
  subcases: Subcase[];
  /** Continuation lines with no parent card. */
  orphanContinuations: number[];
  /** Number of result records in a results punch file (DISP(PUNCH) etc.), which are not cards. */
  punchRecords: number;
  /** First line of punch results, or -1. */
  punchStart: number;
  sectionOf(line: number): SectionKind;
  /** Index into `cards` of the card covering `line`, or -1. */
  cardIndexAt(line: number): number;
}

// ---------------------------------------------------------------------------
// Line helpers

interface ExpandedLine {
  text: string;
  /** map[expandedCol] = original char index */
  map?: number[];
  origLength: number;
}

function expandTabs(line: string): ExpandedLine {
  if (!line.includes('\t')) {
    return { text: line, origLength: line.length };
  }
  let out = '';
  const map: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\t') {
      const n = 8 - (out.length % 8);
      for (let k = 0; k < n; k++) {
        out += ' ';
        map.push(i);
      }
    } else {
      out += ch;
      map.push(i);
    }
  }
  return { text: out, map, origLength: line.length };
}

function toOrig(e: ExpandedLine, col: number): number {
  if (!e.map) {
    return Math.min(col, e.origLength);
  }
  if (col >= e.map.length) {
    return e.origLength;
  }
  return e.map[col];
}

/** Index of the first '$' that starts a comment, or -1. */
function commentStart(line: string): number {
  return line.indexOf('$');
}

function isCommentOrBlank(line: string): boolean {
  const t = line.trimStart();
  return t.length === 0 || t[0] === '$';
}

function codePart(line: string): string {
  const c = commentStart(line);
  return c >= 0 ? line.slice(0, c) : line;
}

const CEND_RE = /^\s*CEND\b/i;
const BEGIN_RE = /^\s*BEGIN\s+(BULK|SUPER|AFPM|TRMC|\w+)/i;
const ENDDATA_RE = /^\s*ENDDATA\b/i;
const INCLUDE_RE = /^\s*INCLUDE\b/i;
const PUNCH_HEADER_RE = /^\$(TITLE\s*=|SUBTITLE\s*=|LABEL\s*=|SUBCASE ID\s*=|EIGENVALUE\s*=|EIGENVECTOR|DISPLACEMENTS|VELOCITY|ACCELERATION|SPCF|MPCF|OLOAD|ELEMENT|REAL OUTPUT|REAL-IMAGINARY|MAGNITUDE-PHASE|FREQUENCY\s*=|TIME\s*=)/i;

// ---------------------------------------------------------------------------
// Field splitting

function slot(text: string, line: number, start: number, end: number, virtual = false): FieldSlot {
  return { text: text.trim(), span: { line, start, end }, virtual: virtual || undefined };
}

/** Split a free-field line into comma separated tokens with spans. */
function splitFree(code: string, line: number): FieldSlot[] {
  const out: FieldSlot[] = [];
  let start = 0;
  for (let i = 0; i <= code.length; i++) {
    if (i === code.length || code[i] === ',') {
      out.push(slot(code.slice(start, i), line, start, i));
      start = i + 1;
    }
  }
  // Trailing whitespace-only final token after last comma is a real (blank) field.
  return out;
}

function parseFixedLine(raw: string, lineNo: number, large: boolean): Omit<CardLine, 'firstIndex'> {
  const code = codePart(raw);
  const e = expandTabs(code);
  const text = e.text;
  const sub = (a: number, b: number): FieldSlot => {
    const s = toOrig(e, a);
    const en = toOrig(e, b);
    return slot(text.slice(a, b), lineNo, s, Math.max(en, s), a >= text.length);
  };
  const head = sub(0, 8);
  const data: FieldSlot[] = [];
  if (large) {
    for (let k = 0; k < 4; k++) {
      data.push(sub(8 + 16 * k, 24 + 16 * k));
    }
  } else {
    for (let k = 0; k < 8; k++) {
      data.push(sub(8 + 8 * k, 16 + 8 * k));
    }
  }
  const cont = sub(72, 80);
  let overflow: Span | undefined;
  if (text.length > 80 && text.slice(80).trim().length > 0) {
    overflow = { line: lineNo, start: toOrig(e, 80), end: e.origLength };
  }
  return { line: lineNo, format: large ? 'large' : 'small', head, data, cont, overflow };
}

function parseFreeLine(raw: string, lineNo: number): Omit<CardLine, 'firstIndex'> {
  const code = codePart(raw).replace(/\s+$/, '');
  const tokens = splitFree(code, lineNo);
  const head = tokens[0];
  const large = head.text.endsWith('*') || head.text.startsWith('*');
  const per = large ? 4 : 8;
  const rest = tokens.slice(1);
  let data: FieldSlot[];
  let cont: FieldSlot | undefined;
  let tooMany = false;
  if (rest.length <= per) {
    data = rest;
  } else if (rest.length === per + 1) {
    data = rest.slice(0, per);
    cont = rest[per];
  } else {
    data = rest;
    tooMany = true;
  }
  const endCol = code.length;
  while (data.length < per) {
    data.push(slot('', lineNo, endCol, endCol, true));
  }
  return { line: lineNo, format: 'free', head, data, cont, tooManyFreeFields: tooMany || undefined };
}

/** Parse one physical bulk data line (must not be a comment/blank line). */
export function parseCardLine(raw: string, lineNo: number): Omit<CardLine, 'firstIndex'> {
  const code = codePart(raw);
  if (code.includes(',')) {
    return parseFreeLine(raw, lineNo);
  }
  const e = expandTabs(code);
  const head = e.text.slice(0, 8).trim();
  const large = head.endsWith('*') || head.startsWith('*');
  return parseFixedLine(raw, lineNo, large);
}

function isContinuationHead(head: string): boolean {
  return head.length === 0 || head[0] === '+' || head[0] === '*';
}

// ---------------------------------------------------------------------------
// INCLUDE

function parseInclude(
  lines: string[],
  start: number,
  section: SectionKind,
): IncludeStatement {
  const first = lines[start];
  const m = /^(\s*INCLUDE\s*)/i.exec(first)!;
  let pos = m[1].length;
  const q = first[pos];
  if (q === "'" || q === '"') {
    const spans: Span[] = [];
    let path = '';
    let lineNo = start;
    let col = pos + 1;
    for (;;) {
      const text = lines[lineNo] ?? '';
      const close = text.indexOf(q, col);
      if (close >= 0) {
        path += text.slice(col, close);
        spans.push({ line: lineNo, start: col, end: close });
        break;
      }
      const seg = text.slice(col).replace(/\s+$/, '');
      path += seg;
      spans.push({ line: lineNo, start: col, end: col + seg.length });
      if (lineNo + 1 >= lines.length) {
        break;
      }
      lineNo++;
      col = 0;
      // continuation lines of a path are usually indented; skip leading blanks
      const lead = /^\s*/.exec(lines[lineNo])![0].length;
      col = lead;
    }
    return { path: path.trim(), spans, startLine: start, endLine: lineNo, section };
  }
  const restRaw = codePart(first).slice(pos);
  const lead = /^\s*/.exec(restRaw)![0].length;
  const path = restRaw.trim();
  pos += lead;
  return {
    path,
    spans: [{ line: start, start: pos, end: pos + path.length }],
    startLine: start,
    endLine: start,
    section,
  };
}

// ---------------------------------------------------------------------------
// Case control / executive control

const CASE_NAME_RE = /^(\s*)([A-Za-z][A-Za-z0-9_]*)/;

function parseCaseCommand(lines: string[], start: number, end: number, subcase?: number): CaseCommand | undefined {
  const raw = codePart(lines[start]);
  const m = CASE_NAME_RE.exec(raw);
  if (!m) {
    return undefined;
  }
  const name = m[2].toUpperCase();
  const nameStart = m[1].length;
  const nameSpan: Span = { line: start, start: nameStart, end: nameStart + m[2].length };
  let pos = nameSpan.end;
  const describers: FieldSlot[] = [];
  // PARAM,NAME,VALUE in case control
  const restAfterName = raw.slice(pos);
  const parenM = /^\s*\(/.exec(restAfterName);
  if (parenM) {
    const open = pos + parenM[0].length - 1;
    const close = raw.indexOf(')', open);
    const inner = raw.slice(open + 1, close >= 0 ? close : raw.length);
    let s = open + 1;
    for (const part of inner.split(',')) {
      const lead = /^\s*/.exec(part)![0].length;
      const t = part.trim();
      if (t) {
        describers.push(slot(t, start, s + lead, s + lead + t.length));
      }
      s += part.length + 1;
    }
    pos = close >= 0 ? close + 1 : raw.length;
  }
  let value = '';
  let valueSpan: Span | undefined;
  // SET n = ... keeps the set ID at the start of the value
  const eq = name === 'SET' ? -1 : raw.indexOf('=', pos);
  let vStart: number;
  if (eq >= 0) {
    vStart = eq + 1;
  } else {
    vStart = pos;
  }
  const vRaw = raw.slice(vStart);
  const lead = /^\s*/.exec(vRaw)![0].length;
  value = vRaw.trim();
  if (value) {
    valueSpan = { line: start, start: vStart + lead, end: vStart + lead + value.length };
  }
  for (let l = start + 1; l <= end; l++) {
    if (!isCommentOrBlank(lines[l])) {
      value += ' ' + codePart(lines[l]).trim();
    }
  }
  return { name, nameSpan, describers, value, valueSpan, startLine: start, endLine: end, subcase };
}

function parseExec(raw: string, line: number): ExecStatement | undefined {
  const code = codePart(raw);
  const m = /^(\s*)([A-Za-z][A-Za-z0-9_]*)/.exec(code);
  if (!m) {
    return undefined;
  }
  const nameStart = m[1].length;
  const rest = code.slice(nameStart + m[2].length);
  const lead = /^\s*/.exec(rest)![0].length;
  const args = rest.trim();
  const aStart = nameStart + m[2].length + lead;
  return {
    name: m[2].toUpperCase(),
    nameSpan: { line, start: nameStart, end: nameStart + m[2].length },
    args,
    argsSpan: args ? { line, start: aStart, end: aStart + args.length } : undefined,
    line,
  };
}

// ---------------------------------------------------------------------------
// Sections

const EXEC_FIRST_RE = /^\s*(COMPILE|ALTER|MALTER|SUBDMAP|ENDALTER|ECHOOFF|ECHOON|TYPE\s+(PARM|DB)|DMAP|SOL|TIME|DIAG|ASSIGN|INIT|NASTRAN|RESTART|DBLOCATE|ID\s)\b/i;
const CASE_FIRST_RE = /^\s*(SET\s+\d+\s*=|SUBCASE\s+\d+|SUBCOM\s+\d+|(TITLE|SUBTITLE|LABEL|ECHO)\s*=|[A-Za-z][A-Za-z0-9]*\s*(\([^)]*\))?\s*=)/;

/**
 * Section of a file without CEND / BEGIN BULK (typically an INCLUDE file),
 * guessed from its first statement: DMAP and executive statements -> exec,
 * case control commands (SET n = ..., KEY = value) -> case, otherwise bulk.
 */
export function guessSection(lines: string[]): SectionKind {
  for (const l of lines) {
    if (isCommentOrBlank(l) || INCLUDE_RE.test(l)) {
      continue;
    }
    const code = codePart(l);
    if (EXEC_FIRST_RE.test(code)) {
      return 'exec';
    }
    // A bulk free-field line has a comma right after the name, so it never matches.
    if (CASE_FIRST_RE.test(code)) {
      return 'case';
    }
    return 'bulk';
  }
  return 'bulk';
}

function detectSections(lines: string[]): SectionKind[] {
  const n = lines.length;
  const kinds: SectionKind[] = new Array(n);
  let cend = -1;
  let begin = -1;
  for (let i = 0; i < n; i++) {
    const l = lines[i];
    if (cend < 0 && begin < 0 && CEND_RE.test(l)) {
      cend = i;
    } else if (begin < 0 && BEGIN_RE.test(l)) {
      begin = i;
      break;
    }
  }
  let state: SectionKind = cend >= 0 ? 'exec' : begin >= 0 ? 'case' : guessSection(lines);
  for (let i = 0; i < n; i++) {
    const l = lines[i];
    if (state === 'exec' && i === cend) {
      kinds[i] = 'exec';
      state = 'case';
      continue;
    }
    if (state !== 'end' && BEGIN_RE.test(l) && (state === 'case' || state === 'bulk')) {
      kinds[i] = state === 'case' ? 'case' : 'bulk';
      state = 'bulk';
      continue;
    }
    if (state === 'bulk' && ENDDATA_RE.test(l)) {
      kinds[i] = 'bulk';
      state = 'end';
      continue;
    }
    kinds[i] = state;
  }
  return kinds;
}

function toRanges(kinds: SectionKind[]): SectionRange[] {
  const out: SectionRange[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const last = out[out.length - 1];
    if (last && last.kind === kinds[i]) {
      last.endLine = i;
    } else {
      out.push({ kind: kinds[i], startLine: i, endLine: i });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry point

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function parseDeck(input: string | string[]): ParsedDeck {
  const lines = typeof input === 'string' ? splitLines(input) : input;
  const n = lines.length;
  const kinds = detectSections(lines);
  const cards: Card[] = [];
  const includes: IncludeStatement[] = [];
  const caseCommands: CaseCommand[] = [];
  const execStatements: ExecStatement[] = [];
  const subcases: Subcase[] = [];
  const orphanContinuations: number[] = [];
  let punchRecords = 0;
  let punchStart = -1;
  let inPunch = false;
  const cardAt = new Int32Array(n).fill(-1);

  let current: Card | undefined;
  let pendingComments: number[] = [];
  let currentSubcase: Subcase | undefined;

  const closeCard = () => {
    current = undefined;
    pendingComments = [];
  };

  for (let i = 0; i < n; i++) {
    const raw = lines[i];
    const kind = kinds[i];

    if (kind === 'end') {
      closeCard();
      continue;
    }

    if (isCommentOrBlank(raw)) {
      if (kind === 'bulk' && PUNCH_HEADER_RE.test(raw)) {
        // header of results written with e.g. DISP(PUNCH): $TITLE =, $SUBCASE ID =, $EIGENVECTOR ...
        closeCard();
        inPunch = true;
      } else if (current) {
        pendingComments.push(i);
      }
      continue;
    }

    if (INCLUDE_RE.test(raw)) {
      closeCard();
      const inc = parseInclude(lines, i, kind);
      includes.push(inc);
      i = inc.endLine;
      continue;
    }

    if (kind === 'exec') {
      const st = parseExec(raw, i);
      if (st) {
        execStatements.push(st);
      }
      continue;
    }

    if (kind === 'case') {
      // gather continuation lines (line ends with a comma)
      let end = i;
      while (end + 1 < n && /,\s*$/.test(codePart(lines[end])) && kinds[end + 1] === 'case') {
        end++;
      }
      const cmd = parseCaseCommand(lines, i, end, currentSubcase?.id);
      if (cmd) {
        if (cmd.name === 'SUBCASE') {
          if (currentSubcase) {
            currentSubcase.endLine = i - 1;
          }
          const id = parseInt(cmd.value, 10);
          currentSubcase = { id: Number.isFinite(id) ? id : 0, line: i, endLine: i };
          subcases.push(currentSubcase);
          cmd.subcase = currentSubcase.id;
        } else if (cmd.name === 'BEGIN') {
          if (currentSubcase) {
            currentSubcase.endLine = i - 1;
            currentSubcase = undefined;
          }
        }
        caseCommands.push(cmd);
        if (currentSubcase) {
          currentSubcase.endLine = end;
        }
      }
      i = end;
      continue;
    }

    // ---- bulk data
    if (BEGIN_RE.test(raw)) {
      closeCard();
      continue;
    }
    // Results punch records: "-CONT-" lines and lines starting with a point/element ID.
    if (raw.startsWith('-CONT-') || (inPunch && /^\s+[+-]?\d/.test(raw))) {
      closeCard();
      inPunch = true;
      punchRecords++;
      if (punchStart < 0) {
        punchStart = i;
      }
      continue;
    }
    inPunch = false;
    const parsed = parseCardLine(raw, i);
    const head = parsed.head.text;
    if (isContinuationHead(head)) {
      if (!current) {
        orphanContinuations.push(i);
        continue;
      }
      const firstIndex = current.fields.length;
      const cl: CardLine = { ...parsed, firstIndex };
      current.lines.push(cl);
      current.fields.push(...cl.data);
      current.innerComments.push(...pendingComments);
      pendingComments = [];
      for (let k = current.endLine + 1; k <= i; k++) {
        cardAt[k] = cards.length - 1;
      }
      current.endLine = i;
      continue;
    }
    // new card
    const cl: CardLine = { ...parsed, firstIndex: 0 };
    const name = head.replace(/\*$/, '').toUpperCase();
    const nameSpan: Span = { ...parsed.head.span };
    // tighten name span to the name text
    const lineText = raw;
    const idx = lineText.toUpperCase().indexOf(head.toUpperCase(), parsed.head.span.start);
    if (idx >= 0) {
      nameSpan.start = idx;
      nameSpan.end = idx + head.length;
    }
    current = {
      name,
      nameSpan,
      format: parsed.format,
      startLine: i,
      endLine: i,
      lines: [cl],
      fields: [...cl.data],
      innerComments: [],
    };
    pendingComments = [];
    cards.push(current);
    cardAt[i] = cards.length - 1;
    if (name === 'ENDDATA') {
      closeCard();
    }
  }

  const sections = toRanges(kinds);
  return {
    lineCount: n,
    sections,
    cards,
    includes,
    caseCommands,
    execStatements,
    subcases,
    orphanContinuations,
    punchRecords,
    punchStart,
    sectionOf: (line: number) => kinds[Math.max(0, Math.min(n - 1, line))] ?? 'bulk',
    cardIndexAt: (line: number) => (line >= 0 && line < n ? cardAt[line] : -1),
  };
}

// ---------------------------------------------------------------------------
// Position lookup

export type FieldHit =
  | { kind: 'name'; card: Card; line: CardLine }
  | { kind: 'cont'; card: Card; line: CardLine }
  | { kind: 'contHead'; card: Card; line: CardLine }
  | { kind: 'data'; card: Card; line: CardLine; index: number; slot: FieldSlot };

/** Find which field of `card` the character position (line, col) falls into. */
export function fieldAt(card: Card, line: number, col: number): FieldHit | undefined {
  const cl = card.lines.find((l) => l.line === line);
  if (!cl) {
    return undefined;
  }
  const inSpan = (s: Span, inclusiveEnd: boolean) =>
    col >= s.start && (inclusiveEnd ? col <= s.end : col < s.end);
  const free = cl.format === 'free';
  if (inSpan(cl.head.span, free)) {
    return cl.firstIndex === 0 ? { kind: 'name', card, line: cl } : { kind: 'contHead', card, line: cl };
  }
  for (let k = 0; k < cl.data.length; k++) {
    const s = cl.data[k];
    if (!s.virtual && inSpan(s.span, free)) {
      return { kind: 'data', card, line: cl, index: cl.firstIndex + k, slot: s };
    }
  }
  if (cl.cont && inSpan(cl.cont.span, free)) {
    return { kind: 'cont', card, line: cl };
  }
  // Fixed format: positions beyond the end of a short line still belong to a field column.
  if (!free) {
    const expandedCol = col; // approximation (tabs are rare beyond line end)
    if (expandedCol >= 8 && expandedCol < 72) {
      const width = cl.format === 'large' ? 16 : 8;
      const k = Math.floor((expandedCol - 8) / width);
      if (k < cl.data.length) {
        return { kind: 'data', card, line: cl, index: cl.firstIndex + k, slot: cl.data[k] };
      }
    }
  }
  return undefined;
}

/** Field values of a card as plain strings, trailing blanks removed. */
export function cardValues(card: Card): string[] {
  const vals = card.fields.map((f) => f.text);
  while (vals.length && vals[vals.length - 1] === '') {
    vals.pop();
  }
  return vals;
}
