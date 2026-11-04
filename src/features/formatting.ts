import * as vscode from 'vscode';
import { Model } from '../model';
import { Card, FieldFormat, ParsedDeck, cardValues } from '../parser/deck';
import { WriteOptions, writeCard } from '../parser/writer';
import { CARDS, defForCard, fieldDef } from '../data/cards';
import { selectedCardIndices, writeOptions } from '../util';
import { commentPrefix, wrapCommentLine } from '../parser/comments';

export type TargetFormat = FieldFormat | 'preserve';

export interface ReformatResult {
  edits: vscode.TextEdit[];
  changed: number;
  rounded: number;
  skipped: number;
  promoted: number;
}

function eolOf(doc: vscode.TextDocument): string {
  return doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
}

/**
 * Column at which formatting wraps `$` comment lines, or undefined when
 * nastran.format.wrapComments is off.
 */
export function formatWrapColumn(doc?: vscode.TextDocument): number | undefined {
  if (!vscode.workspace.getConfiguration('nastran.format', doc).get<boolean>('wrapComments', true)) {
    return undefined;
  }
  return Math.max(20, vscode.workspace.getConfiguration('nastran.comments', doc).get<number>('wrapColumn', 80));
}

function wrapComments(lines: string[], column: number | undefined): string[] {
  if (column === undefined) {
    return lines;
  }
  return lines.flatMap((l) => (l.length > column && commentPrefix(l) !== undefined ? wrapCommentLine(l, column) : [l]));
}

/**
 * Edits that wrap full `$` comment lines in [startLine, endLine] that are longer
 * than the wrap column, skipping lines inside `skip` (cards that are rewritten anyway).
 */
export function commentWrapEdits(doc: vscode.TextDocument, startLine: number, endLine: number, skip: vscode.Range[] = []): vscode.TextEdit[] {
  const column = formatWrapColumn(doc);
  if (column === undefined) {
    return [];
  }
  const eol = eolOf(doc);
  const out: vscode.TextEdit[] = [];
  for (let l = Math.max(0, startLine); l <= Math.min(endLine, doc.lineCount - 1); l++) {
    const line = doc.lineAt(l);
    if (line.text.length <= column || commentPrefix(line.text) === undefined) {
      continue;
    }
    if (skip.some((r) => l >= r.start.line && l <= r.end.line)) {
      continue;
    }
    const wrapped = wrapCommentLine(line.text, column);
    if (wrapped.length > 1) {
      out.push(vscode.TextEdit.replace(line.range, wrapped.join(eol)));
    }
  }
  return out;
}

/** Text for one card in the requested format (comments inside the card are moved above it). */
export function renderCard(doc: vscode.TextDocument, card: Card, target: TargetFormat, opts: WriteOptions) {
  const format = target === 'preserve' ? card.format : target;
  const res = writeCard(card.name, cardValues(card), format, opts);
  const comments: string[] = [];
  for (const l of card.innerComments) {
    comments.push(doc.lineAt(l).text);
  }
  for (const cl of card.lines) {
    const text = doc.lineAt(cl.line).text;
    const c = text.indexOf('$');
    if (c >= 0) {
      comments.push(text.slice(c));
    }
  }
  return { lines: [...wrapComments(comments, formatWrapColumn(doc)), ...res.lines], res, format };
}

export function reformatCards(
  doc: vscode.TextDocument,
  deck: ParsedDeck,
  indices: number[],
  target: TargetFormat,
  opts: WriteOptions = writeOptions(),
): ReformatResult {
  const eol = eolOf(doc);
  const out: ReformatResult = { edits: [], changed: 0, rounded: 0, skipped: 0, promoted: 0 };
  for (const ci of indices) {
    const card = deck.cards[ci];
    if (card.lines.some((l) => l.tooManyFreeFields)) {
      out.skipped++;
      continue;
    }
    const { lines, res, format } = renderCard(doc, card, target, opts);
    const range = new vscode.Range(card.startLine, 0, card.endLine, doc.lineAt(card.endLine).text.length);
    const newText = lines.join(eol);
    if (doc.getText(range) === newText) {
      continue;
    }
    out.edits.push(vscode.TextEdit.replace(range, newText));
    out.changed++;
    out.rounded += res.rounded;
    if (format === 'small' && res.format === 'large') {
      out.promoted++;
    }
  }
  return out;
}

function report(r: ReformatResult, what: string): void {
  const parts = [`${what}: ${r.changed} card${r.changed === 1 ? '' : 's'} changed`];
  if (r.rounded) {
    parts.push(`${r.rounded} real value${r.rounded === 1 ? ' was' : 's were'} rounded to fit the field width`);
  }
  if (r.promoted) {
    parts.push(`${r.promoted} card(s) kept in large field because a value does not fit in 8 characters`);
  }
  if (r.skipped) {
    parts.push(`${r.skipped} card(s) skipped (free-field lines with too many fields)`);
  }
  const msg = parts.join('; ') + '.';
  if (r.rounded || r.promoted || r.skipped) {
    void vscode.window.showWarningMessage(msg);
  } else {
    vscode.window.setStatusBarMessage(msg, 4000);
  }
}

export async function convertSelection(model: Model, target: TargetFormat): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'nastran') {
    return;
  }
  const doc = editor.document;
  const deck = model.deck(doc);
  let indices = selectedCardIndices(deck, editor.selections);
  if (indices.length === 0) {
    const all = editor.selections.length === 1 && editor.selection.isEmpty;
    if (!all) {
      void vscode.window.showInformationMessage('No bulk data cards in the selection.');
      return;
    }
    const pick = await vscode.window.showInformationMessage('The cursor is not on a bulk data card. Convert all cards in the file?', 'Convert all');
    if (pick !== 'Convert all') {
      return;
    }
    indices = deck.cards.map((_, i) => i);
  }
  const r = reformatCards(doc, deck, indices, target);
  if (r.edits.length) {
    const we = new vscode.WorkspaceEdit();
    we.set(doc.uri, r.edits);
    await vscode.workspace.applyEdit(we);
  }
  report(r, target === 'preserve' ? 'Re-aligned' : `Converted to ${target} field`);
}

function defaultStyle(doc: vscode.TextDocument): TargetFormat {
  return vscode.workspace.getConfiguration('nastran.format', doc).get<TargetFormat>('defaultStyle', 'preserve');
}

/** Format every bulk data card in the active file, no selection needed (nastran.format.defaultStyle). */
export async function formatDocument(model: Model): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'nastran') {
    return;
  }
  const doc = editor.document;
  const deck = model.deck(doc);
  const target = defaultStyle(doc);
  const r = reformatCards(doc, deck, deck.cards.map((_, i) => i), target);
  const edits = [...r.edits, ...commentWrapEdits(doc, 0, doc.lineCount - 1, r.edits.map((e) => e.range))];
  if (edits.length) {
    const we = new vscode.WorkspaceEdit();
    we.set(doc.uri, edits);
    await vscode.workspace.applyEdit(we);
  }
  report(r, target === 'preserve' ? 'Formatted file' : `Formatted file as ${target} field`);
}

export class NastranFormatter implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
  constructor(private model: Model) {}

  private target(): TargetFormat {
    return vscode.workspace.getConfiguration('nastran.format').get<TargetFormat>('defaultStyle', 'preserve');
  }

  provideDocumentFormattingEdits(doc: vscode.TextDocument): vscode.TextEdit[] {
    const deck = this.model.deck(doc);
    const r = reformatCards(doc, deck, deck.cards.map((_, i) => i), this.target());
    if (r.rounded || r.promoted) {
      report(r, 'Formatted');
    }
    return [...r.edits, ...commentWrapEdits(doc, 0, doc.lineCount - 1, r.edits.map((e) => e.range))];
  }

  provideDocumentRangeFormattingEdits(doc: vscode.TextDocument, range: vscode.Range): vscode.TextEdit[] {
    const deck = this.model.deck(doc);
    const idx = selectedCardIndices(deck, [new vscode.Selection(range.start, range.end)]);
    const r = reformatCards(doc, deck, idx, this.target());
    return [...r.edits, ...commentWrapEdits(doc, range.start.line, range.end.line, r.edits.map((e) => e.range))];
  }
}

/** "$" comment line(s) naming each field of the card at the cursor, aligned with the card's format. */
export function fieldHeaderLines(card: Card): string[] {
  const def = defForCard(card);
  const nLines = card.lines.length;
  const out: string[] = [];
  const format = card.format;
  const per = format === 'large' ? 4 : 8;
  const width = format === 'large' ? 16 : 8;
  const physical = format === 'large' ? Math.ceil(card.fields.length / 4) : nLines;
  for (let l = 0; l < Math.max(1, physical); l++) {
    const names: string[] = [];
    for (let k = 0; k < per; k++) {
      const fd = def ? fieldDef(def, l * per + k) : undefined;
      names.push(fd?.name ?? '');
    }
    const head = l === 0 ? (format === 'large' ? card.name + '*' : card.name) : format === 'large' ? '*' : '+';
    if (format === 'free') {
      out.push(('$' + [head, ...names].join(',')).replace(/,+$/, ''));
    } else {
      const cell = (s: string) => (s.length >= width ? s.slice(0, width - 1) + ' ' : s.padEnd(width));
      out.push(('$' + head.slice(0, 7).padEnd(7) + names.map(cell).join('')).replace(/\s+$/, ''));
    }
  }
  return out;
}

export async function insertFieldHeader(model: Model): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'nastran') {
    return;
  }
  const deck = model.deck(editor.document);
  const ci = deck.cardIndexAt(editor.selection.active.line);
  if (ci < 0) {
    void vscode.window.showInformationMessage('Place the cursor on a bulk data card.');
    return;
  }
  const card = deck.cards[ci];
  const eol = eolOf(editor.document);
  const text = fieldHeaderLines(card).join(eol) + eol;
  await editor.edit((b) => b.insert(new vscode.Position(card.startLine, 0), text));
}
