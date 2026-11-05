/**
 * Folding ranges for a parsed deck. Pure logic (no vscode import) so it can be unit tested.
 *
 * Folds, outermost first:
 *  - File Management statements (NASTRAN, ASSIGN, INIT, ...) and the Executive Control statements after them
 *  - Case Control and Bulk Data sections, BEGIN SUPER/AUXMODEL/... parts inside the bulk data
 *  - user regions:  $ #region <name>  ...  $ #endregion
 *  - subcases, OUTPUT(PLOT/XYPLOT/POST) blocks, multi-line case control commands (SET lists)
 *  - COMPILE / ALTER / MALTER DMAP packages
 *  - runs of consecutive bulk cards of one category (Grids & coordinates, Elements, Properties,
 *    Materials, Constraints, Loads, Parameters, ...), and inside those, runs of one card type
 *    (CQUAD4, CTRIA3, CHEXA ...). A comment header directly above a run becomes the fold's title line.
 *  - multi-line cards, comment blocks
 */
import { CARDS } from '../data/cards';
import { Card, ParsedDeck } from './deck';

export interface Fold {
  start: number;
  end: number;
  kind?: 'region' | 'comment';
}

export interface FoldOptions {
  /** Fold runs of cards by category and by card type (default true). */
  cardGroups?: boolean;
  /** Fold by comment headers such as the ones Simcenter writes (default true). */
  commentHeaders?: boolean;
  /** Most folds to return (VS Code's editor.foldingMaximumRegions); the least useful are dropped. */
  maxFolds?: number;
}

/**
 * A comment header written by a pre-processor, e.g. by Simcenter:
 *
 *   level 1  boxed title          $*$$$$$$$$$$$ / $* BULK DATA / $*$$$$$$$$$$$   (also $----- and $===== boxes)
 *   level 2  title between blank comment lines   $* / $* ELEMENT CARDS / $*
 *   level 3  "Key: value" object  $*  Mesh Collector: Thin Shell(1)
 *   level 4  sub-object           $*  Mesh: 2d_mesh(1),  $*  Section: Seam Weld Connection1
 */
export interface CommentHeader {
  /** Line with the title; the header's fold starts here. */
  line: number;
  /** First and last line of the header block (box borders, blank comment lines around it). */
  top: number;
  bottom: number;
  level: number;
  title: string;
  /** A repeat of the previous level 3 header (Simcenter writes a collector once per mesh). */
  repeat?: boolean;
}

const BORDER = /^\$[*$#=\-]{10,}\s*$/;
const BLANK_COMMENT = /^\$[*$]?\s*$/;
const CAPS_TITLE = /^\$[*$]?\s+([A-Z][A-Z0-9&/().,_+-]*(?: [A-Z0-9&/().,_+-]+)*[A-Z)])\s*$/;
const KEY_VALUE = /^\$\*\s{2,}([A-Z][A-Za-z0-9 ]*?)\s*:\s*(\S.*?)\s*$/;
/** Level 4 keys: they belong to the level 3 header above them. */
const SUB_KEYS = new Set(['Mesh', 'Section']);
/** Keys Simcenter writes; they are headers even right after another comment (e.g. a hand-added "$MASSES"). */
const KNOWN_KEYS = new Set([
  'Mesh Collector', 'Mesh', 'Property', 'Section', 'Material', 'Modeling Object', 'Simulation Object',
  'Step', 'Load', 'Constraint', 'Coordinate System', 'DOF Set', 'Region',
]);
const MAX_BOX_LINES = 60;

export function findCommentHeaders(lines: string[]): CommentHeader[] {
  const n = lines.length;
  const out: CommentHeader[] = [];
  const isComment = (l: number) => l >= 0 && l < n && lines[l].trimStart().startsWith('$');
  const blank = (l: number) => l >= 0 && l < n && BLANK_COMMENT.test(lines[l]);
  const grow = (h: CommentHeader) => {
    while (blank(h.top - 1)) {
      h.top--;
    }
    while (blank(h.bottom + 1)) {
      h.bottom++;
    }
    return h;
  };
  let lastL3: CommentHeader | undefined;
  for (let i = 0; i < n; i++) {
    const text = lines[i];
    if (!text.startsWith('$')) {
      continue;
    }
    if (BORDER.test(text)) {
      // a box: border, comment lines, border
      let j = i + 1;
      while (j < n && j <= i + MAX_BOX_LINES && isComment(j) && !BORDER.test(lines[j])) {
        j++;
      }
      if (j < n && BORDER.test(lines[j])) {
        const t = lines.slice(i + 1, j).findIndex((l) => !BLANK_COMMENT.test(l));
        if (t >= 0) {
          const title = lines[i + 1 + t].replace(/^\$[*$]?\s*/, '').replace(/\s*\$*\s*$/, '');
          out.push(grow({ line: i + 1 + t, top: i, bottom: j, level: 1, title }));
          lastL3 = undefined;
          i = j;
        }
      }
      continue;
    }
    const caps = CAPS_TITLE.exec(text);
    if (caps && blank(i - 1) && blank(i + 1)) {
      out.push(grow({ line: i, top: i, bottom: i, level: 2, title: caps[1] }));
      lastL3 = undefined;
      continue;
    }
    // An unknown "Key: value" is a header only after a card, a blank comment line or another header;
    // inside a paragraph of comments ("$*  NOTE: SET3 for ERP must ...") it is just text.
    const kv = KEY_VALUE.exec(text);
    const prev = i - 1;
    const afterText = isComment(prev) && !blank(prev) && out[out.length - 1]?.bottom !== prev;
    if (kv && kv[1].length <= 30 && (KNOWN_KEYS.has(kv[1]) || !afterText)) {
      const level = SUB_KEYS.has(kv[1]) ? 4 : 3;
      const h: CommentHeader = { line: i, top: i, bottom: i, level, title: `${kv[1]}: ${kv[2]}` };
      if (level === 3) {
        h.repeat = lastL3?.title === h.title;
        lastL3 = h;
      }
      out.push(h);
    }
  }
  return out;
}

/**
 * Fold of each header: from its title line to the line before the title of the next header at the
 * same or a higher level, so a collapsed deck shows one line per header. A fold also ends before
 * ENDDATA, and before a CEND / BEGIN line that has no boxed header near it.
 */
export function headerFolds(headers: CommentHeader[], lines: string[]): Fold[] {
  const n = lines.length;
  const heads = headers.filter((h) => !h.repeat);
  const boxes = heads.filter((h) => h.level === 1);
  /** A box near line l whose title names the section that starts there ("CASE CONTROL" at CEND). */
  const labeled = (l: number, title: RegExp) => boxes.some((b) => Math.abs(b.line - l) <= 8 && title.test(b.title));
  const stops: number[] = [];
  for (let l = 0; l < n; l++) {
    if (ENDDATA_LINE.test(lines[l])) {
      stops.push(l);
    } else if (/^\s*CEND\b/i.test(lines[l])) {
      if (!labeled(l, /CASE\s+CONTROL/i)) {
        stops.push(l);
      }
    } else if (/^\s*BEGIN\s+BULK\b/i.test(lines[l])) {
      if (!labeled(l, /BULK/i)) {
        stops.push(l);
      }
    } else if (BEGIN_LINE.test(lines[l])) {
      stops.push(l);
    }
  }
  const out: Fold[] = [];
  // walk backwards, remembering the closest following header of each level
  const next = new Map<number, number>();
  for (let k = heads.length - 1; k >= 0; k--) {
    const h = heads[k];
    let end = n - 1;
    for (const [level, line] of next) {
      if (level <= h.level && line - 1 < end) {
        end = line - 1;
      }
    }
    next.set(h.level, h.line);
    out.push({ start: h.line, end, kind: 'region' });
  }
  // end before the closest stop after each header (stops and headers are both sorted by line)
  out.reverse();
  let si = 0;
  const res: Fold[] = [];
  for (const f of out) {
    while (si < stops.length && stops[si] <= f.start) {
      si++;
    }
    if (si < stops.length && stops[si] - 1 < f.end) {
      f.end = stops[si] - 1;
    }
    while (f.end > f.start && !lines[f.end].trim()) {
      f.end--;
    }
    if (f.end > f.start) {
      res.push(f);
    }
  }
  return res;
}

/**
 * Folds that do not cross any header fold (overlap it without nesting). Header folds nest, so the
 * header folds around a line form a chain, found by binary search plus parent links.
 */
function withoutCrossing(folds: Fold[], hFolds: Fold[]): Fold[] {
  const hs = [...hFolds].sort((a, b) => a.start - b.start || b.end - a.end);
  const parent = new Int32Array(hs.length).fill(-1);
  const stack: number[] = [];
  hs.forEach((h, i) => {
    while (stack.length && hs[stack[stack.length - 1]].end < h.start) {
      stack.pop();
    }
    parent[i] = stack.length ? stack[stack.length - 1] : -1;
    stack.push(i);
  });
  /** Index of the last header fold starting at or before line p, or -1. */
  const lastAtOrBefore = (p: number) => {
    let lo = 0;
    let hi = hs.length - 1;
    let r = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (hs[mid].start <= p) {
        r = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return r;
  };
  return folds.filter((f) => {
    const before = lastAtOrBefore(f.start);
    // header folds that start inside f must also end inside it
    for (let i = before + 1; i < hs.length && hs[i].start <= f.end; i++) {
      if (hs[i].end > f.end) {
        return false;
      }
    }
    // header folds around f's first line must not end inside f
    for (let i = before; i >= 0; i = parent[i]) {
      const h = hs[i];
      if (h.end >= f.start && h.start < f.start && h.end < f.end) {
        return false;
      }
    }
    return true;
  });
}

/** File Management Section statements (they precede the executive control statements). */
const FMS = new Set([
  'NASTRAN', 'ASSIGN', 'INIT', 'RESTART', 'DBLOCATE', 'EXPAND', 'DBSETDEL', 'DBDICT', 'ACQUIRE', 'DBCLEAN',
  'DBDIR', 'DBFIX', 'DBLOAD', 'DBUNLOAD', 'DBUPDATE', 'DBDELETE', 'ENDJOB', 'PROJ', 'DEFINE', 'RFINCLUDE',
]);
const DMAP_BLOCK = new Set(['COMPILE', 'ALTER', 'MALTER']);

const REGION_START = /^\s*\$\s*#region\b/i;
const REGION_END = /^\s*\$\s*#endregion\b/i;
const BEGIN_LINE = /^\s*BEGIN\b/i;
const ENDDATA_LINE = /^\s*ENDDATA\b/i;

/** Category used to group consecutive bulk cards, e.g. "Elements", "Materials", "Parameters". */
export function cardCategory(name: string): string {
  if (name === 'PARAM' || name === 'MDLPRM') {
    return 'Parameters';
  }
  const def = CARDS.get(name);
  // unknown cards only group with cards of the same name
  return def ? def.group.split(':')[0].trim() : `card:${name}`;
}

export function computeFolds(deck: ParsedDeck, lines: string[], opts: FoldOptions = {}): Fold[] {
  const n = lines.length;
  const out: Fold[] = [];
  /** Priority of each fold when VS Code's limit on folding regions is reached (0 = keep first). */
  const ranks = new Map<Fold, number>();
  const add = (start: number, end: number, kind?: Fold['kind'], rank = 0) => {
    if (end > start) {
      const f = { start, end, kind };
      out.push(f);
      ranks.set(f, rank);
    }
  };
  const isComment = (l: number) => l >= 0 && l < n && lines[l].trimStart().startsWith('$');
  const isMarker = (l: number) => REGION_START.test(lines[l]) || REGION_END.test(lines[l]);
  /** Lines taken over as the title of a card-run fold; excluded from comment-block folds. */
  const claimed = new Uint8Array(n);

  // ---- comment headers (Simcenter ...). Their folds take priority over the folds below: any
  // fold that would cross one is dropped. Header lines are not folded as comment blocks.
  const headers = opts.commentHeaders === false ? [] : findCommentHeaders(lines);
  const hFolds = headerFolds(headers, lines);
  const headerLines = new Set<number>();
  for (const h of headers) {
    headerLines.add(h.line);
    for (let l = h.top; l <= h.bottom; l++) {
      claimed[l] = 1;
    }
  }

  // ---- sections. Each fold starts on the section's delimiter line, so a collapsed deck reads
  // "ID ...", "CEND", "BEGIN BULK", "ENDDATA". The CEND / BEGIN line is the last line of the
  // previous section in the parsed deck.
  const CEND_LINE = /^\s*CEND\b/i;
  for (const s of deck.sections) {
    const endsWith = (re: RegExp) => re.test(lines[s.endLine] ?? '');
    if (s.kind === 'exec') {
      execFolds(deck, lines, s.startLine, endsWith(CEND_LINE) ? s.endLine - 1 : s.endLine, add);
    } else if (s.kind === 'case') {
      const start = s.startLine > 0 && CEND_LINE.test(lines[s.startLine - 1]) ? s.startLine - 1 : s.startLine;
      add(start, endsWith(BEGIN_LINE) ? s.endLine - 1 : s.endLine, 'region');
    } else if (s.kind === 'bulk' && s.startLine > 0 && BEGIN_LINE.test(lines[s.startLine - 1])) {
      // pure bulk files (INCLUDEs) get no whole-file fold
      add(s.startLine - 1, s.endLine, 'region');
    }
    if (s.kind === 'bulk') {
      bulkParts(lines, s.startLine, s.endLine, add);
    }
  }

  // ---- user regions
  const open: number[] = [];
  for (let l = 0; l < n; l++) {
    if (REGION_START.test(lines[l])) {
      open.push(l);
    } else if (REGION_END.test(lines[l]) && open.length) {
      add(open.pop()!, l, 'region');
    }
  }

  // ---- case control
  for (const sc of deck.subcases) {
    add(sc.line, sc.endLine);
  }
  const cmds = deck.caseCommands;
  for (let k = 0; k < cmds.length; k++) {
    const c = cmds[k];
    add(c.startLine, c.endLine);
    if (c.name === 'OUTPUT') {
      let end = c.endLine;
      for (let j = k + 1; j < cmds.length && !['OUTPUT', 'BEGIN', 'SUBCASE'].includes(cmds[j].name); j++) {
        end = cmds[j].endLine;
      }
      add(c.startLine, end);
    }
  }

  // ---- bulk card runs
  if (opts.cardGroups !== false) {
    cardRuns(deck, lines, isComment, isMarker, claimed, (s, e, k) => add(s, e, k, RANK_RUN), headerLines);
  }

  // ---- multi-line cards
  for (const c of deck.cards) {
    add(c.startLine, c.endLine, undefined, RANK_CARD);
  }

  // ---- comment blocks
  let start = -1;
  for (let l = 0; l <= n; l++) {
    const c = l < n && isComment(l) && !isMarker(l) && !claimed[l];
    if (c && start < 0) {
      start = l;
    } else if (!c && start >= 0) {
      add(start, l - 1, 'comment', RANK_COMMENT);
      start = -1;
    }
  }

  const folds = hFolds.length ? sanitize([...hFolds, ...withoutCrossing(out, hFolds)]) : sanitize(out);
  return withinLimit(folds, ranks, opts.maxFolds);
}

const RANK_RUN = 1;
const RANK_COMMENT = 2;
const RANK_CARD = 3;

/**
 * At most `max` folds. VS Code keeps only editor.foldingMaximumRegions folds (5000 by default) and
 * drops whole nesting levels to get there, which would lose e.g. mesh collector folds in a deck
 * with thousands of multi-line cards. So drop the least useful ones first: single cards, then
 * comment blocks, then card runs; within a kind the smallest go first. Sections and headers
 * (rank 0) stay.
 */
function withinLimit(folds: Fold[], ranks: Map<Fold, number>, max = Infinity): Fold[] {
  if (folds.length <= max) {
    return folds;
  }
  const rank = (f: Fold) => ranks.get(f) ?? 0;
  const keep = new Set(
    [...folds].sort((a, b) => rank(a) - rank(b) || b.end - b.start - (a.end - a.start)).slice(0, Math.max(0, max)),
  );
  return folds.filter((f) => keep.has(f));
}

function execFolds(deck: ParsedDeck, lines: string[], secStart: number, secEnd: number, add: (s: number, e: number, k?: Fold['kind']) => void): void {
  const sts = deck.execStatements.filter((st) => st.line >= secStart && st.line <= secEnd);
  let fmsFirst = -1;
  let fmsLast = -1;
  let i = 0;
  let continued = false;
  for (; i < sts.length; i++) {
    const st = sts[i];
    if (!continued && !FMS.has(st.name)) {
      break;
    }
    if (fmsFirst < 0) {
      fmsFirst = st.line;
    }
    fmsLast = st.line;
    // ASSIGN ..., (trailing comma) continues on the next line
    continued = /,\s*$/.test(lines[st.line].split('$')[0]);
  }
  if (fmsFirst >= 0 && i < sts.length) {
    add(fmsFirst, fmsLast, 'region'); // File Management
    add(sts[i].line, secEnd, 'region'); // Executive Control
  } else {
    add(secStart, secEnd, 'region');
  }

  // DMAP packages: COMPILE / ALTER / MALTER up to ENDALTER or the next package
  for (let k = 0; k < sts.length; k++) {
    if (!DMAP_BLOCK.has(sts[k].name)) {
      continue;
    }
    let end = sts[k].line;
    for (let j = k + 1; j < sts.length; j++) {
      const name = sts[j].name;
      if (name === 'ENDALTER') {
        end = sts[j].line;
        break;
      }
      if (DMAP_BLOCK.has(name) || name === 'CEND' || name === 'SOL') {
        break;
      }
      end = sts[j].line;
    }
    add(sts[k].line, end);
  }
}

/** BEGIN SUPER=n / BEGIN AUXMODEL=n ... parts inside the bulk data section. */
function bulkParts(lines: string[], secStart: number, secEnd: number, add: (s: number, e: number, k?: Fold['kind']) => void): void {
  const begins: number[] = [];
  for (let l = secStart; l <= secEnd; l++) {
    if (BEGIN_LINE.test(lines[l])) {
      begins.push(l);
    }
  }
  const last = ENDDATA_LINE.test(lines[secEnd] ?? '') ? secEnd - 1 : secEnd;
  begins.forEach((b, k) => add(b, k + 1 < begins.length ? begins[k + 1] - 1 : last, 'region'));
}

function cardRuns(
  deck: ParsedDeck,
  lines: string[],
  isComment: (l: number) => boolean,
  isMarker: (l: number) => boolean,
  claimed: Uint8Array,
  add: (s: number, e: number, k?: Fold['kind']) => void,
  /** Comment header lines: a run of cards ends at a header (e.g. a new Simcenter mesh). */
  headerLines: Set<number> = new Set(),
): void {
  const cards = deck.cards;
  if (cards.length < 2) {
    return;
  }
  // lines that end a run: INCLUDE, BEGIN ..., region markers
  const n = lines.length;
  const breaks = new Int32Array(n + 1); // prefix count
  const isBreak = new Uint8Array(n);
  for (const inc of deck.includes) {
    for (let l = inc.startLine; l <= inc.endLine && l < n; l++) {
      isBreak[l] = 1;
    }
  }
  for (let l = 0; l < n; l++) {
    if (BEGIN_LINE.test(lines[l]) || isMarker(l) || headerLines.has(l)) {
      isBreak[l] = 1;
    }
    breaks[l + 1] = breaks[l] + isBreak[l];
  }
  const broken = (a: Card, b: Card) => breaks[b.startLine] - breaks[a.endLine + 1] > 0;

  const runs = (key: (c: Card) => string): Array<[number, number]> => {
    const res: Array<[number, number]> = [];
    let first = 0;
    for (let k = 1; k <= cards.length; k++) {
      if (k < cards.length && key(cards[k]) === key(cards[k - 1]) && !broken(cards[k - 1], cards[k])) {
        continue;
      }
      if (k - first >= 2) {
        res.push([first, k - 1]);
      }
      first = k;
    }
    return res;
  };

  const catRuns = runs((c) => cardCategory(c.name));
  const seen = new Set(catRuns.map(([a, b]) => `${a}:${b}`));
  const nameRuns = runs((c) => c.name).filter(([a, b]) => !seen.has(`${a}:${b}`));

  const nameRunStarts = new Set(nameRuns.map(([a]) => a));
  for (const [a, b] of catRuns) {
    const floor = a > 0 ? cards[a - 1].endLine + 1 : 0;
    const start = headerStart(cards[a].startLine, floor, isComment, isMarker, lines, claimed);
    // Without a comment header the category fold and the first card-type fold would start on the
    // same line and only one can exist; the per-type fold (CQUAD4, CTRIA3 ...) is the more useful one.
    if (start === cards[a].startLine && nameRunStarts.has(a)) {
      continue;
    }
    add(start, cards[b].endLine);
  }
  for (const [a, b] of nameRuns) {
    add(cards[a].startLine, cards[b].endLine);
  }
}

/**
 * If a comment block sits directly above the card at `startLine`, return the first line of it that has text,
 * so the folded run shows e.g. "$ Elements and Element Properties for region : wing".
 */
function headerStart(startLine: number, floor: number, isComment: (l: number) => boolean, isMarker: (l: number) => boolean, lines: string[], claimed: Uint8Array): number {
  let h = startLine;
  while (h - 1 >= floor && isComment(h - 1) && !isMarker(h - 1)) {
    h--;
  }
  for (let l = h; l < startLine; l++) {
    if (/[A-Za-z0-9]/.test(lines[l])) {
      for (let k = l; k < startLine; k++) {
        claimed[k] = 1;
      }
      return l;
    }
  }
  return startLine;
}

/**
 * Keep one fold per start line (the largest) and drop folds that overlap without nesting,
 * the same way VS Code would, so the result is deterministic.
 */
function sanitize(folds: Fold[]): Fold[] {
  const sorted = folds.map((f, i) => ({ f, i })).sort((x, y) => x.f.start - y.f.start || y.f.end - x.f.end || x.i - y.i);
  const res: Fold[] = [];
  const stack: Fold[] = [];
  let lastStart = -1;
  for (const { f } of sorted) {
    if (f.start === lastStart) {
      continue;
    }
    while (stack.length && stack[stack.length - 1].end < f.start) {
      stack.pop();
    }
    if (stack.length && f.end > stack[stack.length - 1].end) {
      continue;
    }
    stack.push(f);
    res.push(f);
    lastStart = f.start;
  }
  return res;
}
