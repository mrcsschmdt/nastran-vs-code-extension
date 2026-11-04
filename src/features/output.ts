/**
 * Features for Nastran output (.f06) files: solver messages as diagnostics, an outline of
 * the letter-spaced section headings, folding, and the section under the cursor.
 */
import * as vscode from 'vscode';
import { F06Message, F06Section, F06Severity, ParsedF06, f06Folds, messagesAtLeast, sectionAt } from '../parser/f06';

const SOURCE = 'nastran';

function minSeverity(doc: vscode.TextDocument): F06Severity {
  return vscode.workspace.getConfiguration('nastran.f06', doc).get<F06Severity>('messages', 'warning');
}

function messageText(m: F06Message): string {
  let s = m.header;
  if (m.text) {
    s += `: ${m.text}`;
  }
  if (m.preceding.length) {
    s += `\n(above: ${m.preceding.join(' / ')})`;
  }
  return s;
}

const SEVERITY: Record<F06Severity, vscode.DiagnosticSeverity> = {
  fatal: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
};

export function computeF06Diagnostics(doc: vscode.TextDocument, f: ParsedF06): vscode.Diagnostic[] {
  return messagesAtLeast(f, minSeverity(doc)).map((m) => {
    const text = doc.lineAt(m.line).text;
    const start = Math.max(0, text.search(/\*\*\*|\^\^\^/));
    const d = new vscode.Diagnostic(new vscode.Range(m.line, start, m.line, text.trimEnd().length), messageText(m), SEVERITY[m.severity]);
    d.source = SOURCE;
    if (m.number !== undefined) {
      d.code = m.number;
    }
    return d;
  });
}

// ---------------------------------------------------------------------------
// Outline

function sectionDetail(s: F06Section): string {
  const parts: string[] = [];
  if (s.subcase !== undefined) {
    parts.push(`SUBCASE ${s.subcase}`);
  }
  if (s.steps) {
    const st = s.steps;
    parts.push(st.count > 1 && st.last !== st.first ? `${st.label} ${st.first} … ${st.last} (${st.count})` : `${st.label} ${st.first}`);
  }
  if (s.firstPage !== undefined) {
    parts.push(s.lastPage !== undefined && s.lastPage !== s.firstPage ? `p. ${s.firstPage}–${s.lastPage}` : `p. ${s.firstPage}`);
  }
  return parts.join(' · ');
}

interface Item {
  sym: vscode.DocumentSymbol;
  start: number;
  end: number;
}

/**
 * Sections, messages (at the configured severity) and, with two or more SOL 200 design
 * cycles, one group per cycle. Items are nested by line range: messages inside the
 * section they are printed in, sections inside their design cycle.
 */
export function f06Symbols(doc: vscode.TextDocument, f: ParsedF06): vscode.DocumentSymbol[] {
  const lineRange = (a: number, b: number) => new vscode.Range(a, 0, b, doc.lineAt(b).text.length);
  const items: Item[] = [];
  const add = (name: string, detail: string, kind: vscode.SymbolKind, start: number, end: number) =>
    items.push({ sym: new vscode.DocumentSymbol(name, detail, kind, lineRange(start, end), lineRange(start, start)), start, end });

  if (f.cycles.length > 1) {
    for (const c of f.cycles) {
      add(`DESIGN CYCLE ${c.cycle}`, '', vscode.SymbolKind.Namespace, c.line, c.endLine);
    }
  }
  for (const s of f.sections) {
    add(s.title, sectionDetail(s), vscode.SymbolKind.Module, s.line, s.endLine);
  }
  for (const m of messagesAtLeast(f, minSeverity(doc))) {
    add(m.header, m.text.length > 80 ? m.text.slice(0, 79) + '…' : m.text, vscode.SymbolKind.Event, m.line, m.endLine);
  }
  if (f.endOfJob >= 0) {
    add('END OF JOB', '', vscode.SymbolKind.Key, f.endOfJob, f.endOfJob);
  }

  items.sort((a, b) => a.start - b.start || b.end - a.end);
  const roots: vscode.DocumentSymbol[] = [];
  const stack: Item[] = [];
  for (const it of items) {
    while (stack.length && !(it.start >= stack[stack.length - 1].start && it.end <= stack[stack.length - 1].end)) {
      stack.pop();
    }
    (stack.length ? stack[stack.length - 1].sym.children : roots).push(it.sym);
    stack.push(it);
  }
  return roots;
}

export function f06FoldingRanges(f: ParsedF06): vscode.FoldingRange[] {
  return f06Folds(f).map((x) => new vscode.FoldingRange(x.start, x.end, x.kind === 'region' ? vscode.FoldingRangeKind.Region : undefined));
}

/** Status bar text for the cursor line: the section (and subcase) it is in, and the message counts. */
export function f06Status(f: ParsedF06, line: number): { text: string; tooltip: string } {
  const counts = { fatal: 0, warning: 0, information: 0 };
  for (const m of f.messages) {
    counts[m.severity]++;
  }
  const tooltip =
    `${counts.fatal} fatal, ${counts.warning} warning, ${counts.information} information message(s)` +
    (f.endOfJob >= 0 ? '' : ' · no END OF JOB line (run incomplete?)');
  const s = sectionAt(f, line);
  const where = s ? `${s.title}${s.subcase !== undefined ? ` · SUBCASE ${s.subcase}` : ''}` : 'Nastran output';
  const icon = counts.fatal ? '$(error)' : '$(output)';
  return { text: `${icon} ${where}`, tooltip };
}
