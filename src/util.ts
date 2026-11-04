import * as vscode from 'vscode';
import { CaseCommand, ExecStatement, FieldHit, IncludeStatement, ParsedDeck, SectionKind, Span, fieldAt } from './parser/deck';
import { Alignment, WriteOptions } from './parser/writer';
import { CARDS, fieldDef, layoutLength } from './data/cards';
import { CardDef } from './data/types';

export function toRange(s: Span): vscode.Range {
  return new vscode.Range(s.line, s.start, s.line, s.end);
}

export function writeOptions(): WriteOptions {
  const cfg = vscode.workspace.getConfiguration('nastran.format');
  return {
    alignment: cfg.get<Alignment>('alignment', 'mixed'),
    continuationMarker: cfg.get<string>('continuationMarker', '+'),
    uppercase: cfg.get<boolean>('uppercase', true),
  };
}

export interface PositionContext {
  section: SectionKind;
  hit?: FieldHit;
  caseCommand?: CaseCommand;
  exec?: ExecStatement;
  include?: IncludeStatement;
}

export function contextAt(deck: ParsedDeck, pos: vscode.Position): PositionContext {
  const section = deck.sectionOf(pos.line);
  const include = deck.includes.find((i) => pos.line >= i.startLine && pos.line <= i.endLine);
  if (include) {
    return { section, include };
  }
  if (section === 'bulk') {
    const ci = deck.cardIndexAt(pos.line);
    if (ci >= 0) {
      return { section, hit: fieldAt(deck.cards[ci], pos.line, pos.character) };
    }
    return { section };
  }
  if (section === 'case') {
    const cmd = deck.caseCommands.find((c) => pos.line >= c.startLine && pos.line <= c.endLine);
    return { section, caseCommand: cmd };
  }
  if (section === 'exec') {
    return { section, exec: deck.execStatements.find((e) => e.line === pos.line) };
  }
  return { section };
}

/** Lines (start..end) of cards that intersect the selections (or the cursor line). */
export function selectedCardIndices(deck: ParsedDeck, selections: readonly vscode.Selection[]): number[] {
  const set = new Set<number>();
  for (const sel of selections) {
    let end = sel.end.line;
    if (!sel.isEmpty && sel.end.character === 0 && end > sel.start.line) {
      end--;
    }
    for (let l = sel.start.line; l <= end; l++) {
      const ci = deck.cardIndexAt(l);
      if (ci >= 0) {
        set.add(ci);
      }
    }
  }
  return [...set].sort((a, b) => a - b);
}

const TYPE_NAMES: Record<string, string> = {
  I: 'integer',
  R: 'real',
  S: 'character',
  IR: 'integer or real',
  IS: 'integer or character',
  RS: 'real or character',
  IRS: 'integer, real or character',
  A: 'any',
  '': 'blank',
};

export function typeName(t: string): string {
  return TYPE_NAMES[t] ?? t;
}

function esc(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\*/g, '\\*').replace(/_/g, '\\_');
}

/**
 * Inline HTML that VS Code's hover sanitizer keeps. VS Code 1.85 only allows
 * `color` and `background-color` (newer versions also allow border-radius),
 * so nothing else may be added or the whole style is dropped. Theme variables
 * keep it readable in every theme; the badge colors are a strong accent.
 */
const HIGHLIGHT_STYLE = 'color:var(--vscode-badge-foreground);background-color:var(--vscode-badge-background);';
const HEADER_STYLE = 'color:var(--vscode-textLink-foreground);';

/**
 * Markdown table showing the field layout of a card (fields 1-10 per line).
 * `highlight` = data-field index to emphasize; `count` = number of data fields to show.
 * With `html`, the highlighted field is drawn as a colored badge and its column
 * number is colored (the MarkdownString must have `supportHtml = true`).
 */
export function layoutTable(def: CardDef, highlight?: number, count?: number, html = false): string {
  let n = count ?? layoutLength(def);
  if (highlight !== undefined && highlight >= n) {
    n = (Math.floor(highlight / 8) + 1) * 8;
  }
  const lines = Math.max(1, Math.ceil(n / 8));
  const hlField = highlight !== undefined ? fieldPosition(highlight).field : -1;
  const header =
    '| ' +
    Array.from({ length: 10 }, (_, c) => (html && c + 1 === hlField ? `<span style="${HEADER_STYLE}">${c + 1}</span>` : String(c + 1))).join(' | ') +
    ' |';
  const sep = '|---|---|---|---|---|---|---|---|---|---|';
  const rows: string[] = [header, sep];
  for (let l = 0; l < lines; l++) {
    const cells: string[] = [l === 0 ? `**${def.name}**` : '+'];
    for (let k = 0; k < 8; k++) {
      const i = l * 8 + k;
      const fd = i < n ? fieldDef(def, i) : undefined;
      let name = fd?.name ? esc(fd.name) : '';
      if (i === highlight) {
        const label = fd?.name ? esc(fd.name) : '(blank)';
        name = html ? `<span style="${HIGHLIGHT_STYLE}">&nbsp;**${label}**&nbsp;</span>` : `**\`${fd?.name || '(blank)'}\`**`;
      }
      cells.push(name);
    }
    cells.push('');
    rows.push('| ' + cells.join(' | ') + ' |');
  }
  if (def.repeat) {
    rows.push('');
    rows.push('*…fields repeat as needed*');
  }
  return rows.join('\n');
}

export function lookupCard(name: string): CardDef | undefined {
  return CARDS.get(name.toUpperCase());
}

/** 1-based field number (1-10) and line number within the card of a data-field index. */
export function fieldPosition(index: number): { line: number; field: number } {
  return { line: Math.floor(index / 8), field: (index % 8) + 2 };
}

/** Columns covered by a field in a fixed-format line, as a human readable string. */
export function columnsOf(format: 'small' | 'large' | 'free', localIndex: number): string {
  if (format === 'free') {
    return '';
  }
  const w = format === 'large' ? 16 : 8;
  const start = 8 + localIndex * w + 1;
  return `columns ${start}-${start + w - 1}`;
}
