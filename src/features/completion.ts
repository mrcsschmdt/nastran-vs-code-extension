import * as vscode from 'vscode';
import { Model } from '../model';
import { CARDS, fieldDef } from '../data/cards';
import { CardDef } from '../data/types';
import { CASE_COMMANDS, EXEC_STATEMENTS, PARAMS, SOLUTIONS, lookupCaseCommand } from '../data/control';
import { layoutTable } from '../util';

function snippetFields(def: CardDef): string[] {
  const n = def.repeat ? Math.max(def.fields.length, def.repeat.from) + def.repeat.fields.length : def.fields.length;
  const names: string[] = [];
  for (let i = 0; i < n; i++) {
    names.push(fieldDef(def, i)?.name ?? '');
  }
  while (names.length && names[names.length - 1] === '') {
    names.pop();
  }
  return names;
}

function escapeSnippet(s: string): string {
  return s.replace(/[$}\\]/g, '\\$&');
}

/** Free-field snippet: GRID,${1:ID},${2:CP},... with '+,' continuation lines. */
export function freeFieldSnippet(def: CardDef): string {
  const names = snippetFields(def);
  let tab = 1;
  const lines: string[] = [];
  for (let l = 0; l * 8 < Math.max(1, names.length); l++) {
    const parts = names.slice(l * 8, l * 8 + 8).map((n) => (n ? `\${${tab++}:${escapeSnippet(n)}}` : ''));
    lines.push([l === 0 ? def.name : '+', ...parts].join(','));
  }
  return lines.join('\n') + '$0';
}

/** Small-field template: field-name comment line(s) followed by the card name, cursor in field 2. */
export function fixedFieldSnippet(def: CardDef): string {
  const names = snippetFields(def);
  const lines: string[] = [];
  const cell = (s: string) => (s.length >= 8 ? s.slice(0, 7) + ' ' : s.padEnd(8));
  for (let l = 0; l * 8 < Math.max(1, names.length); l++) {
    const head = l === 0 ? def.name : '+';
    lines.push(escapeSnippet(('$' + head.slice(0, 7).padEnd(7) + names.slice(l * 8, l * 8 + 8).map(cell).join('')).trimEnd()));
  }
  lines.push(def.name.padEnd(8) + '$0');
  return lines.join('\n');
}

export class NastranCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private model: Model) {}

  provideCompletionItems(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    _token: vscode.CancellationToken,
    ctx: vscode.CompletionContext,
  ): vscode.CompletionItem[] | undefined {
    const deck = this.model.deck(doc);
    const section = deck.sectionOf(pos.line);
    const before = doc.lineAt(pos.line).text.slice(0, pos.character);
    if (before.trimStart().startsWith('$')) {
      return undefined;
    }
    // A typed space only triggers completion after PARAM (bulk) or SOL (executive control).
    if (ctx.triggerCharacter === ' ' && !/^\s*(PARAM|SOL)\s+$/i.test(before)) {
      return undefined;
    }
    if (section === 'bulk') {
      return this.bulk(doc, pos, before);
    }
    if (section === 'case') {
      return this.caseControl(pos, before);
    }
    if (section === 'exec') {
      return this.exec(pos, before);
    }
    return undefined;
  }

  private bulk(doc: vscode.TextDocument, pos: vscode.Position, before: string): vscode.CompletionItem[] | undefined {
    // PARAM name
    const pm = /^PARAM\*?(?:,\s*|\s+)([A-Za-z0-9]*)$/i.exec(before);
    if (pm && (before.includes(',') || pos.character >= 8)) {
      const range = new vscode.Range(pos.line, pos.character - pm[1].length, pos.line, pos.character);
      return [...PARAMS.values()].map((p) => {
        const it = new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Constant);
        it.range = range;
        it.detail = p.values ? `PARAM · ${p.values}` : 'PARAM';
        it.documentation = new vscode.MarkdownString(`${p.desc}${p.default ? `\n\nDefault: ${p.default}` : ''}`);
        return it;
      });
    }
    // card name in field 1
    const m = /^([A-Za-z][A-Za-z0-9]*)?$/.exec(before);
    if (!m || pos.character > 8) {
      return undefined;
    }
    const style = vscode.workspace.getConfiguration('nastran.completion').get<string>('style', 'free');
    const range = new vscode.Range(pos.line, 0, pos.line, pos.character);
    const items: vscode.CompletionItem[] = [];
    for (const def of CARDS.values()) {
      const it = new vscode.CompletionItem({ label: def.name, description: def.group }, vscode.CompletionItemKind.Struct);
      it.range = range;
      it.detail = def.desc;
      it.documentation = new vscode.MarkdownString(layoutTable(def));
      it.insertText = new vscode.SnippetString(def.fields.length === 0 && !def.repeat ? def.name : style === 'fixed' ? fixedFieldSnippet(def) : freeFieldSnippet(def));
      items.push(it);
    }
    items.push(this.keyword('INCLUDE', "INCLUDE '${1:file.bdf}'", 'Include another file', range));
    return items;
  }

  private keyword(label: string, snippet: string, detail: string, range: vscode.Range): vscode.CompletionItem {
    const it = new vscode.CompletionItem(label, vscode.CompletionItemKind.Keyword);
    it.insertText = new vscode.SnippetString(snippet);
    it.detail = detail;
    it.range = range;
    return it;
  }

  private caseControl(pos: vscode.Position, before: string): vscode.CompletionItem[] | undefined {
    const paren = /^\s*([A-Za-z]+)\s*\(([^)]*)$/.exec(before);
    if (paren) {
      const def = lookupCaseCommand(paren[1]);
      if (!def?.describers) {
        return undefined;
      }
      const cur = /([A-Za-z0-9]*)$/.exec(paren[2])![1];
      const range = new vscode.Range(pos.line, pos.character - cur.length, pos.line, pos.character);
      return def.describers.map((d) => {
        const it = new vscode.CompletionItem(d.name, vscode.CompletionItemKind.EnumMember);
        it.detail = d.desc;
        it.range = range;
        return it;
      });
    }
    const m = /^(\s*)([A-Za-z]*)$/.exec(before);
    if (!m) {
      return undefined;
    }
    const range = new vscode.Range(pos.line, m[1].length, pos.line, pos.character);
    const items = [...CASE_COMMANDS.values()].map((c) => {
      const it = new vscode.CompletionItem(c.name, c.output ? vscode.CompletionItemKind.Event : vscode.CompletionItemKind.Keyword);
      it.detail = c.syntax;
      it.documentation = new vscode.MarkdownString(c.desc);
      it.range = range;
      if (c.output) {
        it.insertText = new vscode.SnippetString(`${c.name}(\${1:PLOT}) = \${2:ALL}`);
      } else if (c.name === 'SUBCASE') {
        it.insertText = new vscode.SnippetString('SUBCASE ${1:1}\n    SUBTITLE = ${2:title}\n    ');
      } else if (c.ref) {
        it.insertText = new vscode.SnippetString(`${c.name} = \${1:1}`);
      } else if (c.name === 'BEGIN') {
        it.insertText = 'BEGIN BULK';
      }
      return it;
    });
    return items;
  }

  private exec(pos: vscode.Position, before: string): vscode.CompletionItem[] | undefined {
    const sol = /^\s*SOL\s+(\w*)$/i.exec(before);
    if (sol) {
      const range = new vscode.Range(pos.line, pos.character - sol[1].length, pos.line, pos.character);
      return Object.entries(SOLUTIONS).map(([num, s], i) => {
        const it = new vscode.CompletionItem({ label: num, description: s.name }, vscode.CompletionItemKind.EnumMember);
        it.detail = s.desc;
        it.range = range;
        it.sortText = String(i).padStart(3, '0');
        return it;
      });
    }
    const m = /^(\s*)([A-Za-z]*)$/.exec(before);
    if (!m) {
      return undefined;
    }
    const range = new vscode.Range(pos.line, m[1].length, pos.line, pos.character);
    return Object.entries(EXEC_STATEMENTS).map(([name, desc]) => {
      const it = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
      it.documentation = desc;
      it.range = range;
      return it;
    });
  }
}
