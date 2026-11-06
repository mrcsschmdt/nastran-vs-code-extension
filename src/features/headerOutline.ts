/**
 * Outline of a deck that is structured by comment headers, as the Simcenter translator writes
 * them: boxed sections, card groups, mesh collectors, meshes, properties, materials ...
 *
 * Each header is a symbol that starts on its title line, so VS Code's sticky scroll keeps
 * "$* BULK DATA", "$* ELEMENT CARDS", "$*  Mesh Collector: ..." at the top of the editor while
 * scrolling through the cards below them. Executive control statements and case control
 * commands are listed under their header; cards are summarized in the header's detail
 * ("3960 CQUAD4"), not listed one by one.
 */
import * as vscode from 'vscode';
import { ParsedDeck } from '../parser/deck';
import { CommentHeader, findCommentHeaders, headerFolds } from '../parser/folding';
import { toRange } from '../util';

/** True when the deck labels its sections with boxed headers (a "BULK DATA" box, as Simcenter writes). */
export function hasSectionHeaders(headers: CommentHeader[]): boolean {
  return headers.some((h) => h.level === 1 && /\bBULK\s+DATA\b/i.test(h.title));
}

const KINDS: Record<string, vscode.SymbolKind> = {
  'Mesh Collector': vscode.SymbolKind.Class,
  Mesh: vscode.SymbolKind.Object,
  Property: vscode.SymbolKind.Property,
  Section: vscode.SymbolKind.Property,
  Material: vscode.SymbolKind.Constant,
  Load: vscode.SymbolKind.Event,
  Constraint: vscode.SymbolKind.Interface,
  'Coordinate System': vscode.SymbolKind.Field,
  'DOF Set': vscode.SymbolKind.Interface,
};

function kindOf(h: CommentHeader): vscode.SymbolKind {
  if (h.level === 1) return vscode.SymbolKind.Namespace;
  if (h.level === 2) return vscode.SymbolKind.Package;
  return KINDS[h.title.split(':')[0]] ?? vscode.SymbolKind.Module;
}

interface Node {
  sym: vscode.DocumentSymbol;
  start: number;
  end: number;
  counts: Map<string, number>;
}

/** "SOL 103", "ID,NASTRAN,job" (no blank before a comma). */
export function statementName(name: string, args: string): string {
  const a = args.trim();
  return a.startsWith(',') ? name + a : `${name} ${a}`.trim();
}

function countText(counts: Map<string, number>): string {
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const parts = top.slice(0, 3).map(([name, n]) => `${n} ${name}`);
  return parts.join(', ') + (top.length > 3 ? ', …' : '');
}

export function headerSymbols(doc: vscode.TextDocument, deck: ParsedDeck, lines: string[], headers = findCommentHeaders(lines)): vscode.DocumentSymbol[] {
  const n = lines.length;
  const lineRange = (a: number, b: number) => new vscode.Range(a, 0, b, lines[b]?.length ?? 0);
  const ends = new Map(headerFolds(headers, lines).map((f) => [f.start, f.end]));

  // header nodes, nested by line range (header ranges always nest)
  const roots: vscode.DocumentSymbol[] = [];
  const nodes: Node[] = [];
  const stack: Node[] = [];
  for (const h of headers) {
    if (h.repeat) {
      continue;
    }
    const end = ends.get(h.line) ?? h.line;
    const node: Node = {
      sym: new vscode.DocumentSymbol(h.title, '', kindOf(h), lineRange(h.line, end), lineRange(h.line, h.line)),
      start: h.line,
      end,
      counts: new Map(),
    };
    while (stack.length && stack[stack.length - 1].end < h.line) {
      stack.pop();
    }
    (stack.length ? stack[stack.length - 1].sym.children : roots).push(node.sym);
    stack.push(node);
    nodes.push(node);
  }

  // innermost header of every line (nodes are in document order, parents before children)
  const owner = new Int32Array(n).fill(-1);
  nodes.forEach((node, i) => owner.fill(i, node.start, Math.min(n, node.end + 1)));
  const place = (line: number, sym: vscode.DocumentSymbol) => {
    const i = line >= 0 && line < n ? owner[line] : -1;
    (i >= 0 ? nodes[i].sym.children : roots).push(sym);
  };

  for (const st of deck.execStatements) {
    const r = lineRange(st.line, st.line);
    place(st.line, new vscode.DocumentSymbol(statementName(st.name, st.args), '', vscode.SymbolKind.Key, r, toRange(st.nameSpan)));
  }
  const subSyms = new Map<number, vscode.DocumentSymbol>();
  for (const sc of deck.subcases) {
    const r = lineRange(sc.line, Math.max(sc.line, sc.endLine));
    const title = deck.caseCommands.find((c) => c.subcase === sc.id && (c.name === 'SUBTITLE' || c.name === 'LABEL'))?.value ?? '';
    const sym = new vscode.DocumentSymbol(`SUBCASE ${sc.id}`, title, vscode.SymbolKind.Module, r, lineRange(sc.line, sc.line));
    subSyms.set(sc.line, sym);
    place(sc.line, sym);
  }
  for (const cmd of deck.caseCommands) {
    if (cmd.name === 'SUBCASE') {
      continue;
    }
    const sym = new vscode.DocumentSymbol(cmd.name, cmd.value, vscode.SymbolKind.Variable, lineRange(cmd.startLine, cmd.endLine), toRange(cmd.nameSpan));
    const sc = deck.subcases.find((s) => cmd.startLine > s.line && cmd.startLine <= s.endLine);
    if (sc) {
      subSyms.get(sc.line)!.children.push(sym);
    } else {
      place(cmd.startLine, sym);
    }
  }

  for (const c of deck.cards) {
    const i = owner[c.startLine];
    if (i >= 0 && c.name !== 'ENDDATA') {
      nodes[i].counts.set(c.name, (nodes[i].counts.get(c.name) ?? 0) + 1);
    }
  }
  for (const node of nodes) {
    node.sym.detail = countText(node.counts);
  }
  return roots;
}
