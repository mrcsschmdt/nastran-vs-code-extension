import * as vscode from 'vscode';
import { Model, isOutputDocument, normId } from '../model';
import { f06FoldingRanges, f06Symbols } from './output';
import { Card, ParsedDeck, splitLines } from '../parser/deck';
import { computeFolds, findCommentHeaders } from '../parser/folding';
import { hasSectionHeaders, headerSymbols, statementName } from './headerOutline';
import { CARDS, defForCard, fieldDef } from '../data/cards';
import { REF_GROUPS } from '../data/refs';
import { lookupCaseCommand } from '../data/control';
import { contextAt, toRange } from '../util';

function cardLocation(uri: vscode.Uri, card: Card): vscode.Location {
  const s = card.fields[0]?.text ? card.fields[0].span : card.nameSpan;
  return new vscode.Location(uri, toRange(s));
}

// ---------------------------------------------------------------------------
// Definition

export class NastranDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private model: Model) {}

  async provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Location[] | undefined> {
    const deck = this.model.deck(doc);
    const ctx = contextAt(deck, pos);
    if (ctx.include) {
      const target = this.model.resolveInclude(ctx.include.path, doc.uri);
      return target ? [new vscode.Location(target, new vscode.Position(0, 0))] : undefined;
    }
    if (ctx.hit?.kind === 'data') {
      const def = defForCard(ctx.hit.card);
      const fd = def ? fieldDef(def, ctx.hit.index) : undefined;
      const value = ctx.hit.slot.text;
      if (fd?.ref && /^[+-]?\d+$/.test(value)) {
        const found = await this.model.findCards(doc.uri, fd.ref, value);
        return found.map((f) => cardLocation(f.uri, f.card));
      }
      return undefined;
    }
    if (ctx.caseCommand) {
      const cmd = ctx.caseCommand;
      const def = lookupCaseCommand(cmd.name);
      const value = cmd.value.trim();
      if (!def || !/^\d+$/.test(value)) {
        return undefined;
      }
      if (def.output) {
        // output request -> case control SET
        const sets = deck.caseCommands.filter((c) => c.name === 'SET' && parseInt(c.value, 10) === parseInt(value, 10));
        return sets.map((c) => new vscode.Location(doc.uri, toRange(c.nameSpan)));
      }
      if (def.ref) {
        const found = await this.model.findCards(doc.uri, def.ref, value);
        return found.map((f) => cardLocation(f.uri, f.card));
      }
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// References

function groupsContaining(cardName: string): Set<string> {
  const out = new Set<string>();
  for (const [g, names] of Object.entries(REF_GROUPS)) {
    if (names.includes(cardName)) {
      out.add(g);
    }
  }
  return out;
}

function fieldMatches(card: Card, i: number, id: number): boolean {
  const t = card.fields[i].text;
  if (/^[+-]?\d+$/.test(t)) {
    return parseInt(t, 10) === id;
  }
  if (t.toUpperCase() === 'THRU' && i > 0 && i + 1 < card.fields.length) {
    const a = parseInt(card.fields[i - 1].text, 10);
    const b = parseInt(card.fields[i + 1].text, 10);
    return Number.isFinite(a) && Number.isFinite(b) && id > a && id < b;
  }
  return false;
}

export function findReferencesInDeck(uri: vscode.Uri, deck: ParsedDeck, groups: Set<string>, id: number, out: vscode.Location[]): void {
  for (const card of deck.cards) {
    const def = defForCard(card);
    if (!def) {
      continue;
    }
    for (let i = 0; i < card.fields.length; i++) {
      const slot = card.fields[i];
      if (!slot.text) {
        continue;
      }
      let fd = fieldDef(def, i);
      if (slot.text.toUpperCase() === 'THRU' && i > 0) {
        fd = fieldDef(def, i - 1);
      }
      if (fd?.ref && groups.has(fd.ref) && fieldMatches(card, i, id)) {
        out.push(new vscode.Location(uri, toRange(slot.span)));
      }
    }
  }
  for (const cmd of deck.caseCommands) {
    const def = lookupCaseCommand(cmd.name);
    if (def?.ref && groups.has(def.ref) && cmd.valueSpan && parseInt(cmd.value, 10) === id) {
      out.push(new vscode.Location(uri, toRange(cmd.valueSpan)));
    }
  }
}

export class NastranReferenceProvider implements vscode.ReferenceProvider {
  constructor(private model: Model) {}

  async provideReferences(doc: vscode.TextDocument, pos: vscode.Position, context: vscode.ReferenceContext): Promise<vscode.Location[]> {
    const deck = this.model.deck(doc);
    const ctx = contextAt(deck, pos);
    let card: Card | undefined;
    if (ctx.hit && (ctx.hit.kind === 'name' || (ctx.hit.kind === 'data' && ctx.hit.index === 0))) {
      card = ctx.hit.card;
    }
    let groups: Set<string>;
    let idText: string;
    if (card) {
      groups = groupsContaining(card.name);
      idText = card.fields[0]?.text ?? '';
      if (CARDS.get(card.name)?.listIds && ctx.hit?.kind === 'data') {
        idText = ctx.hit.slot.text;
      }
    } else if (ctx.hit?.kind === 'data') {
      // a referencing field: find all references to the same target
      const def = defForCard(ctx.hit.card);
      const fd = def ? fieldDef(def, ctx.hit.index) : undefined;
      if (!fd?.ref) {
        return [];
      }
      groups = new Set([fd.ref]);
      // include all groups that contain the same card types (e.g. 'grid' and 'excite')
      for (const name of REF_GROUPS[fd.ref] ?? []) {
        groupsContaining(name).forEach((g) => groups.add(g));
      }
      idText = ctx.hit.slot.text;
    } else {
      return [];
    }
    if (!/^[+-]?\d+$/.test(idText) || groups.size === 0) {
      return [];
    }
    const id = parseInt(idText, 10);
    const out: vscode.Location[] = [];
    const scope = await this.model.referenceScope(doc.uri);
    for (const uri of scope) {
      const d = this.model.deckForUri(uri);
      if (d) {
        findReferencesInDeck(uri, d, groups, id, out);
      }
    }
    if (context.includeDeclaration && card) {
      out.unshift(cardLocation(doc.uri, card));
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// INCLUDE links

export class NastranLinkProvider implements vscode.DocumentLinkProvider {
  constructor(private model: Model) {}

  provideDocumentLinks(doc: vscode.TextDocument): vscode.DocumentLink[] {
    const deck = this.model.deck(doc);
    const out: vscode.DocumentLink[] = [];
    for (const inc of deck.includes) {
      const target = this.model.resolveInclude(inc.path, doc.uri);
      if (!target) {
        continue;
      }
      for (const s of inc.spans) {
        if (s.end > s.start) {
          const link = new vscode.DocumentLink(toRange(s), target);
          link.tooltip = target.fsPath;
          out.push(link);
        }
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Outline

const SECTION_NAMES = { exec: 'Executive Control', case: 'Case Control', bulk: 'Bulk Data', end: 'After ENDDATA' };
const MAX_CHILDREN = 500;

function symbolKind(group: string): vscode.SymbolKind {
  if (group.startsWith('Elements')) return vscode.SymbolKind.Object;
  if (group === 'Properties') return vscode.SymbolKind.Property;
  if (group === 'Materials') return vscode.SymbolKind.Constant;
  if (group === 'Geometry') return vscode.SymbolKind.Field;
  if (group === 'Loads' || group === 'Dynamics') return vscode.SymbolKind.Event;
  if (group === 'Constraints') return vscode.SymbolKind.Interface;
  return vscode.SymbolKind.Struct;
}

export class NastranSymbolProvider implements vscode.DocumentSymbolProvider {
  constructor(private model: Model) {}

  provideDocumentSymbols(doc: vscode.TextDocument): vscode.DocumentSymbol[] {
    if (isOutputDocument(doc)) {
      return f06Symbols(doc, this.model.f06(doc));
    }
    const deck = this.model.deck(doc);
    // decks with boxed section headers (Simcenter): outline by header, so sticky scroll shows them
    if (vscode.workspace.getConfiguration('nastran', doc).get<boolean>('folding.commentHeaders', true)) {
      const lines = splitLines(doc.getText());
      const headers = findCommentHeaders(lines);
      if (hasSectionHeaders(headers)) {
        return headerSymbols(doc, deck, lines, headers);
      }
    }
    const lineRange = (a: number, b: number) => new vscode.Range(a, 0, b, doc.lineAt(b).text.length);
    const out: vscode.DocumentSymbol[] = [];
    const multipleSections = deck.sections.filter((s) => s.kind !== 'end').length > 1;

    for (const sec of deck.sections) {
      if (sec.kind === 'end') {
        continue;
      }
      const range = lineRange(sec.startLine, sec.endLine);
      const secSym = new vscode.DocumentSymbol(SECTION_NAMES[sec.kind], '', vscode.SymbolKind.Namespace, range, new vscode.Range(sec.startLine, 0, sec.startLine, 0));
      const inSec = (l: number) => l >= sec.startLine && l <= sec.endLine;

      for (const inc of deck.includes.filter((i) => inSec(i.startLine))) {
        const r = lineRange(inc.startLine, inc.endLine);
        secSym.children.push(new vscode.DocumentSymbol(`INCLUDE ${inc.path}`, '', vscode.SymbolKind.File, r, r));
      }

      if (sec.kind === 'exec') {
        for (const st of deck.execStatements.filter((s) => inSec(s.line))) {
          const r = lineRange(st.line, st.line);
          secSym.children.push(new vscode.DocumentSymbol(statementName(st.name, st.args), '', vscode.SymbolKind.Key, r, toRange(st.nameSpan)));
        }
      } else if (sec.kind === 'case') {
        const subSyms = new Map<number, vscode.DocumentSymbol>();
        for (const sc of deck.subcases) {
          const r = lineRange(sc.line, Math.max(sc.line, sc.endLine));
          const title = deck.caseCommands.find((c) => c.subcase === sc.id && (c.name === 'SUBTITLE' || c.name === 'LABEL'))?.value ?? '';
          const sym = new vscode.DocumentSymbol(`SUBCASE ${sc.id}`, title, vscode.SymbolKind.Module, r, lineRange(sc.line, sc.line));
          subSyms.set(sc.line, sym);
          secSym.children.push(sym);
        }
        for (const cmd of deck.caseCommands.filter((c) => inSec(c.startLine))) {
          if (cmd.name === 'SUBCASE') {
            continue;
          }
          const r = lineRange(cmd.startLine, cmd.endLine);
          const sym = new vscode.DocumentSymbol(cmd.name, cmd.value, vscode.SymbolKind.Variable, r, toRange(cmd.nameSpan));
          const sc = deck.subcases.find((s) => cmd.startLine > s.line && cmd.startLine <= s.endLine);
          (sc ? subSyms.get(sc.line)!.children : secSym.children).push(sym);
        }
      } else {
        const groups = new Map<string, Card[]>();
        for (const c of deck.cards) {
          if (!inSec(c.startLine)) {
            continue;
          }
          const arr = groups.get(c.name);
          arr ? arr.push(c) : groups.set(c.name, [c]);
        }
        for (const [name, cards] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          const def = CARDS.get(name);
          const first = cards[0];
          const last = cards[cards.length - 1];
          const r = lineRange(first.startLine, last.endLine);
          const g = new vscode.DocumentSymbol(name, `${cards.length} ${def ? '· ' + def.desc : ''}`, def ? symbolKind(def.group) : vscode.SymbolKind.Struct, r, toRange(first.nameSpan));
          if (cards.length <= MAX_CHILDREN && name !== 'ENDDATA') {
            for (const c of cards) {
              const cr = lineRange(c.startLine, c.endLine);
              const id = c.fields[0]?.text ?? '';
              g.children.push(new vscode.DocumentSymbol(`${name} ${id}`.trim(), '', g.kind, cr, toRange(c.nameSpan)));
            }
          }
          secSym.children.push(g);
        }
      }
      out.push(secSym);
    }
    if (!multipleSections && out.length === 1) {
      return out[0].children;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Folding

export class NastranFoldingProvider implements vscode.FoldingRangeProvider {
  constructor(private model: Model) {}

  provideFoldingRanges(doc: vscode.TextDocument): vscode.FoldingRange[] {
    if (isOutputDocument(doc)) {
      return f06FoldingRanges(this.model.f06(doc));
    }
    const deck = this.model.deck(doc);
    const lines = splitLines(doc.getText());
    const cfg = vscode.workspace.getConfiguration('nastran', doc);
    const cardGroups = cfg.get<boolean>('folding.cardGroups', true);
    const commentHeaders = cfg.get<boolean>('folding.commentHeaders', true);
    // VS Code shows at most this many folds; computeFolds drops the least useful ones itself
    const maxFolds = vscode.workspace.getConfiguration('editor', doc).get<number>('foldingMaximumRegions', 5000);
    return computeFolds(deck, lines, { cardGroups, commentHeaders, maxFolds }).map(
      (f) => new vscode.FoldingRange(f.start, f.end, f.kind === 'region' ? vscode.FoldingRangeKind.Region : f.kind === 'comment' ? vscode.FoldingRangeKind.Comment : undefined),
    );
  }
}
