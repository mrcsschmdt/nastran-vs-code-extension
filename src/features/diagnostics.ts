import * as vscode from 'vscode';
import { Model, isOutputDocument } from '../model';
import { Card, FieldSlot, ParsedDeck } from '../parser/deck';
import { classify, ValueKind, withDecimalPoint } from '../parser/values';
import { CARDS, defForCard, fieldDef } from '../data/cards';
import { FieldDef } from '../data/types';
import { toRange } from '../util';
import { reformatCards } from './formatting';
import { computeF06Diagnostics } from './output';

export const DIAG_SOURCE = 'nastran';

export const enum Code {
  NeedsDecimalPoint = 'needs-decimal-point',
  NoPointExponent = 'no-point-exponent',
  WrongType = 'wrong-type',
  InvalidValue = 'invalid-value',
  EmbeddedBlank = 'embedded-blank',
  Beyond80 = 'beyond-column-80',
  TooManyFreeFields = 'too-many-free-fields',
  OrphanContinuation = 'orphan-continuation',
  Required = 'required-field',
  UnknownCard = 'unknown-card',
  DuplicateId = 'duplicate-id',
  IncludeNotFound = 'include-not-found',
}

function typeAllows(type: string, kind: ValueKind): boolean {
  switch (kind) {
    case 'blank':
      return true;
    case 'int':
      return type.includes('I') || type === 'A' || type === '';
    case 'real':
      return type.includes('R') || type === 'A' || type === '';
    case 'string':
      return type.includes('S') || type === 'A' || type === '';
    default:
      return type === 'A' || type === '';
  }
}

function checkField(card: Card, i: number, slot: FieldSlot, fd: FieldDef | undefined, out: vscode.Diagnostic[]) {
  const text = slot.text;
  const kind = classify(text);
  const range = toRange(slot.span);
  const name = fd?.name ? `${card.name} ${fd.name}` : `${card.name} field ${(i % 8) + 2}`;

  if (kind === 'blank') {
    if (fd?.required) {
      const d = new vscode.Diagnostic(range, `${name} is required.`, vscode.DiagnosticSeverity.Warning);
      d.code = Code.Required;
      out.push(d);
    }
    return;
  }
  if (/\s/.test(text) && card.lines.find((l) => l.line === slot.span.line)?.format !== 'free') {
    const d = new vscode.Diagnostic(
      range,
      `${name}: embedded blank in "${text}". A fixed-format field cannot contain spaces — a value may have spilled over from the neighbouring field.`,
      vscode.DiagnosticSeverity.Error,
    );
    d.code = Code.EmbeddedBlank;
    out.push(d);
    return;
  }
  if (kind === 'badReal') {
    const d = new vscode.Diagnostic(range, `${name}: "${text}" is not a valid Nastran number — reals need a decimal point, e.g. "${withDecimalPoint(text)}".`, vscode.DiagnosticSeverity.Error);
    d.code = Code.NoPointExponent;
    out.push(d);
    return;
  }
  if (!fd) {
    if (kind === 'other' && CARDS.has(card.name)) {
      const d = new vscode.Diagnostic(range, `${name}: "${text}" is neither a valid number nor a character value.`, vscode.DiagnosticSeverity.Warning);
      d.code = Code.InvalidValue;
      out.push(d);
    }
    return;
  }
  if (fd.name === '' && fd.type === '') {
    // field documented as unused
    const d = new vscode.Diagnostic(range, `${card.name} field ${(i % 8) + 2}${i >= 8 ? ` (continuation ${Math.floor(i / 8)})` : ''} is not used and should be blank.`, vscode.DiagnosticSeverity.Warning);
    d.code = Code.WrongType;
    out.push(d);
    return;
  }
  if (typeAllows(fd.type, kind)) {
    return;
  }
  if (kind === 'int' && fd.type.includes('R')) {
    const d = new vscode.Diagnostic(range, `${name} expects a real number — add a decimal point ("${text}." instead of "${text}"). Nastran rejects integers in real fields.`, vscode.DiagnosticSeverity.Error);
    d.code = Code.NeedsDecimalPoint;
    out.push(d);
    return;
  }
  if (kind === 'other') {
    const d = new vscode.Diagnostic(range, `${name}: "${text}" is not a valid value (expected ${typeWord(fd.type)}).`, vscode.DiagnosticSeverity.Error);
    d.code = Code.InvalidValue;
    out.push(d);
    return;
  }
  const d = new vscode.Diagnostic(range, `${name} expects ${typeWord(fd.type)}, found ${kindWord(kind)} "${text}".`, vscode.DiagnosticSeverity.Warning);
  d.code = Code.WrongType;
  out.push(d);
}

function typeWord(t: string): string {
  const parts: string[] = [];
  if (t.includes('I')) parts.push('an integer');
  if (t.includes('R')) parts.push('a real (with decimal point)');
  if (t.includes('S')) parts.push('a character value');
  return parts.join(' or ') || 'a value';
}

function kindWord(k: ValueKind): string {
  return k === 'int' ? 'integer' : k === 'real' ? 'real' : k === 'string' ? 'character value' : 'value';
}

const DUP_SPACES = new Set(['grid', 'element', 'property', 'material', 'coord']);

export function computeDiagnostics(model: Model, doc: vscode.TextDocument, deck: ParsedDeck): vscode.Diagnostic[] {
  const cfg = vscode.workspace.getConfiguration('nastran.diagnostics');
  const out: vscode.Diagnostic[] = [];
  const unknownCards = cfg.get<boolean>('unknownCards', false);
  const dupCheck = cfg.get<boolean>('duplicateIds', true);
  const seen = new Map<string, Card>();

  for (const card of deck.cards) {
    const def = defForCard(card);
    if (!def && unknownCards) {
      const d = new vscode.Diagnostic(toRange(card.nameSpan), `Unknown card "${card.name}" (not in the extension's card database).`, vscode.DiagnosticSeverity.Information);
      d.code = Code.UnknownCard;
      out.push(d);
    }
    for (const cl of card.lines) {
      if (cl.overflow) {
        const d = new vscode.Diagnostic(toRange(cl.overflow), 'Text beyond column 80 is ignored by Nastran.', vscode.DiagnosticSeverity.Warning);
        d.code = Code.Beyond80;
        out.push(d);
      }
      if (cl.tooManyFreeFields) {
        const d = new vscode.Diagnostic(new vscode.Range(cl.line, 0, cl.line, doc.lineAt(cl.line).text.length), 'Free-field line has more than 10 fields. Put at most 8 data fields per line and continue on the next line.', vscode.DiagnosticSeverity.Warning);
        d.code = Code.TooManyFreeFields;
        out.push(d);
      }
    }
    if (def) {
      card.fields.forEach((slot, i) => {
        const fd = fieldDef(def, i);
        if (slot.virtual && !fd?.required) {
          return;
        }
        checkField(card, i, slot, fd, out);
      });
      // required fields beyond the written fields
      for (let i = card.fields.length; i < def.fields.length; i++) {
        if (def.fields[i].required) {
          const d = new vscode.Diagnostic(toRange(card.nameSpan), `${card.name}: required field ${def.fields[i].name} is missing.`, vscode.DiagnosticSeverity.Warning);
          d.code = Code.Required;
          out.push(d);
          break;
        }
      }
      if (dupCheck && def.idSpace && DUP_SPACES.has(def.idSpace) && !def.listIds && card.fields[0]?.text) {
        const key = `${def.idSpace}:${parseInt(card.fields[0].text, 10)}`;
        const prev = seen.get(key);
        if (prev) {
          const d = new vscode.Diagnostic(
            toRange(card.fields[0].span),
            `Duplicate ${def.idSpace} ID ${card.fields[0].text} (also used by ${prev.name} on line ${prev.startLine + 1}).`,
            vscode.DiagnosticSeverity.Warning,
          );
          d.code = Code.DuplicateId;
          d.relatedInformation = [new vscode.DiagnosticRelatedInformation(new vscode.Location(doc.uri, toRange(prev.fields[0].span)), 'first definition')];
          out.push(d);
        } else {
          seen.set(key, card);
        }
      }
    }
  }

  for (const l of deck.orphanContinuations) {
    const d = new vscode.Diagnostic(new vscode.Range(l, 0, l, doc.lineAt(l).text.length), 'Continuation line without a parent card.', vscode.DiagnosticSeverity.Error);
    d.code = Code.OrphanContinuation;
    out.push(d);
  }

  for (const inc of deck.includes) {
    if (!model.resolveInclude(inc.path, doc.uri)) {
      const first = inc.spans[0];
      const last = inc.spans[inc.spans.length - 1];
      const d = new vscode.Diagnostic(
        new vscode.Range(first.line, first.start, last.line, last.end),
        `INCLUDE file not found: ${inc.path}`,
        vscode.DiagnosticSeverity.Error,
      );
      d.code = Code.IncludeNotFound;
      out.push(d);
    }
  }
  for (const d of out) {
    d.source = DIAG_SOURCE;
  }
  return out;
}

export class DiagnosticsManager implements vscode.Disposable {
  private collection = vscode.languages.createDiagnosticCollection('nastran');
  private timers = new Map<string, NodeJS.Timeout>();
  private disposables: vscode.Disposable[] = [];

  constructor(private model: Model) {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((d) => this.schedule(d, 0)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document, 400)),
      vscode.workspace.onDidCloseTextDocument((d) => {
        this.collection.delete(d.uri);
        this.model.forget(d.uri);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('nastran')) {
          vscode.workspace.textDocuments.forEach((d) => this.schedule(d, 0));
        }
      }),
    );
    vscode.workspace.textDocuments.forEach((d) => this.schedule(d, 0));
  }

  /** Re-check every open Nastran document (e.g. after definitions changed). */
  refreshAll(): void {
    vscode.workspace.textDocuments.forEach((d) => this.schedule(d, 0));
  }

  private schedule(doc: vscode.TextDocument, delay: number) {
    if (doc.languageId !== 'nastran' && !isOutputDocument(doc)) {
      return;
    }
    const k = doc.uri.toString();
    clearTimeout(this.timers.get(k));
    this.timers.set(
      k,
      setTimeout(() => {
        this.timers.delete(k);
        this.run(doc);
      }, delay),
    );
  }

  private run(doc: vscode.TextDocument) {
    if (doc.isClosed) {
      return;
    }
    const cfg = vscode.workspace.getConfiguration('nastran');
    if (!cfg.get<boolean>('diagnostics.enabled', true) || doc.lineCount > cfg.get<number>('maxLinesForAnalysis', 400000)) {
      this.collection.delete(doc.uri);
      return;
    }
    if (isOutputDocument(doc)) {
      this.collection.set(doc.uri, computeF06Diagnostics(doc, this.model.f06(doc)));
      return;
    }
    const deck = this.model.deck(doc);
    this.collection.set(doc.uri, computeDiagnostics(this.model, doc, deck));
  }

  dispose() {
    this.collection.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.timers.forEach((t) => clearTimeout(t));
  }
}

// ---------------------------------------------------------------------------
// Quick fixes and refactorings

export class NastranCodeActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite];

  constructor(private model: Model) {}

  provideCodeActions(doc: vscode.TextDocument, range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const deck = this.model.deck(doc);
    const actions: vscode.CodeAction[] = [];

    const pointFixes: vscode.Diagnostic[] = [];
    for (const d of ctx.diagnostics) {
      if (d.source !== DIAG_SOURCE && d.source !== undefined) {
        continue;
      }
      if (d.code === Code.NeedsDecimalPoint || d.code === Code.NoPointExponent) {
        pointFixes.push(d);
        const fix = this.decimalPointFix(doc, deck, [d]);
        if (fix) {
          fix.title = `Add decimal point to "${doc.getText(d.range).trim()}"`;
          fix.isPreferred = true;
          actions.push(fix);
        }
      }
    }
    // fix all in file
    const all = vscode.languages
      .getDiagnostics(doc.uri)
      .filter((d) => d.code === Code.NeedsDecimalPoint || d.code === Code.NoPointExponent);
    if (pointFixes.length && all.length > 1) {
      const fix = this.decimalPointFix(doc, deck, all);
      if (fix) {
        fix.title = `Add missing decimal points in the whole file (${all.length})`;
        actions.push(fix);
      }
    }

    const ci = deck.cardIndexAt(range.start.line);
    if (ci >= 0) {
      const card = deck.cards[ci];
      for (const [fmt, label] of [['small', 'small field (8)'], ['large', 'large field (16)'], ['free', 'free field (comma)']] as const) {
        if (card.format === fmt) {
          continue;
        }
        const r = reformatCards(doc, deck, [ci], fmt);
        if (r.edits.length) {
          const a = new vscode.CodeAction(`Convert ${card.name} to ${label}`, vscode.CodeActionKind.RefactorRewrite);
          a.edit = new vscode.WorkspaceEdit();
          a.edit.set(doc.uri, r.edits);
          actions.push(a);
        }
      }
    }
    return actions;
  }

  /** Insert '.' into numeric values; rewrites the card if the field is full. */
  private decimalPointFix(doc: vscode.TextDocument, deck: ParsedDeck, diags: vscode.Diagnostic[]): vscode.CodeAction | undefined {
    const edit = new vscode.WorkspaceEdit();
    const rewriteCards = new Map<number, Map<number, string>>();
    for (const d of diags) {
      const ci = deck.cardIndexAt(d.range.start.line);
      if (ci < 0) {
        continue;
      }
      const card = deck.cards[ci];
      const idx = card.fields.findIndex((f) => f.span.line === d.range.start.line && f.span.start === d.range.start.character);
      if (idx < 0) {
        continue;
      }
      const slot = card.fields[idx];
      const fixed = withDecimalPoint(slot.text);
      const line = card.lines.find((l) => l.line === slot.span.line)!;
      const lineText = doc.lineAt(slot.span.line).text;
      const raw = lineText.slice(slot.span.start, slot.span.end);
      const lead = raw.length - raw.trimStart().length;
      const width = line.format === 'large' ? 16 : 8;
      const slotRange = new vscode.Range(slot.span.line, slot.span.start, slot.span.line, slot.span.end);
      if (line.format === 'free') {
        const valueStart = slot.span.start + lead;
        edit.replace(doc.uri, new vscode.Range(slot.span.line, valueStart, slot.span.line, valueStart + slot.text.length), fixed);
      } else if (fixed.length <= width) {
        // keep the field's justification; drop trailing blanks at the end of the line
        let text = lead > 0 ? fixed.padStart(width) : fixed.padEnd(width);
        if (slot.span.end >= lineText.length) {
          text = text.trimEnd();
        }
        edit.replace(doc.uri, slotRange, text);
      } else {
        let m = rewriteCards.get(ci);
        if (!m) {
          m = new Map();
          rewriteCards.set(ci, m);
        }
        m.set(idx, fixed);
      }
    }
    for (const [ci, changes] of rewriteCards) {
      const card = deck.cards[ci];
      const copy: typeof card = { ...card, fields: card.fields.map((f, i) => (changes.has(i) ? { ...f, text: changes.get(i)! } : f)) };
      const fakeDeck = { ...deck, cards: deck.cards.map((c, i) => (i === ci ? copy : c)) };
      const r = reformatCards(doc, fakeDeck, [ci], 'preserve');
      for (const e of r.edits) {
        edit.replace(doc.uri, e.range, e.newText);
      }
    }
    if (edit.size === 0) {
      return undefined;
    }
    const a = new vscode.CodeAction('Add decimal point', vscode.CodeActionKind.QuickFix);
    a.edit = edit;
    a.diagnostics = diags;
    return a;
  }
}
