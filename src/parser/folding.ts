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
  const add = (start: number, end: number, kind?: Fold['kind']) => {
    if (end > start) {
      out.push({ start, end, kind });
    }
  };
  const isComment = (l: number) => l >= 0 && l < n && lines[l].trimStart().startsWith('$');
  const isMarker = (l: number) => REGION_START.test(lines[l]) || REGION_END.test(lines[l]);
  /** Lines taken over as the title of a card-run fold; excluded from comment-block folds. */
  const claimed = new Uint8Array(n);

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
    cardRuns(deck, lines, isComment, isMarker, claimed, add);
  }

  // ---- multi-line cards
  for (const c of deck.cards) {
    add(c.startLine, c.endLine);
  }

  // ---- comment blocks
  let start = -1;
  for (let l = 0; l <= n; l++) {
    const c = l < n && isComment(l) && !isMarker(l) && !claimed[l];
    if (c && start < 0) {
      start = l;
    } else if (!c && start >= 0) {
      add(start, l - 1, 'comment');
      start = -1;
    }
  }

  return sanitize(out);
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
    if (BEGIN_LINE.test(lines[l]) || isMarker(l)) {
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
