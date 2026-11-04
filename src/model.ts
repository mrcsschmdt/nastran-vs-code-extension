/**
 * Document cache, INCLUDE resolution and a cross-file ID index used for
 * go-to-definition / find-references.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Card, ParsedDeck, parseDeck, splitLines } from './parser/deck';
import { ParsedF06, parseF06 } from './parser/f06';
import { CARDS } from './data/cards';
import { REF_GROUPS } from './data/refs';

export interface CardLocation {
  uri: vscode.Uri;
  card: Card;
}

interface FileEntry {
  key: string; // version (open doc) or mtime (disk)
  deck: ParsedDeck;
  lines?: string[];
  /** cardName -> id -> cards */
  ids?: Map<string, Map<string, Card[]>>;
}

export const NASTRAN_GLOB = '**/*.{bdf,dat,aset,nas,blk,bulk,inc,pch,BDF,DAT,ASET,NAS,BLK,BULK,INC,PCH}';

/** Language of Nastran output (.f06) files: outline, folding and solver messages, no input deck features. */
export const OUTPUT_LANGUAGE = 'nastran-output';

export function isOutputDocument(doc: { languageId: string }): boolean {
  return doc.languageId === OUTPUT_LANGUAGE;
}

let emptyDeck: ParsedDeck | undefined;

/** Normalize an integer ID string ("+12" / "012" -> "12"). */
export function normId(text: string): string {
  const t = text.trim();
  if (/^[+-]?\d+$/.test(t)) {
    return String(parseInt(t, 10));
  }
  return t.toUpperCase();
}

export class Model {
  private files = new Map<string, FileEntry>();
  private outputs = new Map<string, { version: number; f06: ParsedF06 }>();

  /** Parse an open document (cached by version). Output files (.f06) give an empty deck. */
  deck(doc: vscode.TextDocument): ParsedDeck {
    if (isOutputDocument(doc)) {
      return (emptyDeck ??= parseDeck(''));
    }
    const k = doc.uri.toString();
    const key = `v${doc.version}`;
    const e = this.files.get(k);
    if (e && e.key === key) {
      return e.deck;
    }
    const deck = parseDeck(doc.getText());
    this.files.set(k, { key, deck });
    return deck;
  }

  /** Parse a file by URI: uses the open document if any, otherwise reads from disk. */
  deckForUri(uri: vscode.Uri): ParsedDeck | undefined {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open) {
      return this.deck(open);
    }
    try {
      const st = fs.statSync(uri.fsPath);
      const key = `m${st.mtimeMs}:${st.size}`;
      const k = uri.toString();
      const e = this.files.get(k);
      if (e && e.key === key) {
        return e.deck;
      }
      const lines = splitLines(fs.readFileSync(uri.fsPath, 'latin1'));
      const deck = parseDeck(lines);
      this.files.set(k, { key, deck, lines });
      return deck;
    } catch {
      return undefined;
    }
  }

  /** Text of lines [start, end] of a file (open document or disk). */
  lineTexts(uri: vscode.Uri, start: number, end: number): string[] {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    const out: string[] = [];
    if (open) {
      for (let l = start; l <= end && l < open.lineCount; l++) {
        out.push(open.lineAt(l).text);
      }
      return out;
    }
    this.deckForUri(uri);
    const lines = this.files.get(uri.toString())?.lines ?? [];
    return lines.slice(start, end + 1);
  }

  /** Scan an open output (.f06) document (cached by version). */
  f06(doc: vscode.TextDocument): ParsedF06 {
    const k = doc.uri.toString();
    const e = this.outputs.get(k);
    if (e && e.version === doc.version) {
      return e.f06;
    }
    const f06 = parseF06(doc.getText());
    this.outputs.set(k, { version: doc.version, f06 });
    return f06;
  }

  forget(uri: vscode.Uri): void {
    this.files.delete(uri.toString());
    this.outputs.delete(uri.toString());
  }

  // -------------------------------------------------------------------------
  // INCLUDE resolution

  /** Resolve an INCLUDE path relative to the including file, workspace folders and configured search paths. */
  resolveInclude(includePath: string, from: vscode.Uri): vscode.Uri | undefined {
    let p = includePath.trim().replace(/^['"]|['"]$/g, '');
    // expand environment variables $VAR / ${VAR} / %VAR%
    p = p.replace(/\$\{?(\w+)\}?|%(\w+)%/g, (m, a, b) => process.env[a ?? b] ?? m);
    if (!p) {
      return undefined;
    }
    const candidates: string[] = [];
    if (path.isAbsolute(p)) {
      candidates.push(p);
    } else {
      candidates.push(path.resolve(path.dirname(from.fsPath), p));
      for (const wf of vscode.workspace.workspaceFolders ?? []) {
        candidates.push(path.resolve(wf.uri.fsPath, p));
      }
      const extra = vscode.workspace.getConfiguration('nastran').get<string[]>('includePaths', []);
      for (const dir of extra) {
        candidates.push(path.resolve(dir, p));
      }
    }
    for (const c of candidates) {
      try {
        if (fs.statSync(c).isFile()) {
          return vscode.Uri.file(c);
        }
      } catch {
        // try the next one
      }
    }
    return undefined;
  }

  /** The file and all files it includes (recursively). */
  includeTree(root: vscode.Uri, maxFiles = 2000): vscode.Uri[] {
    const seen = new Set<string>();
    const out: vscode.Uri[] = [];
    const stack = [root];
    while (stack.length && out.length < maxFiles) {
      const u = stack.pop()!;
      const k = u.toString();
      if (seen.has(k)) {
        continue;
      }
      seen.add(k);
      out.push(u);
      const deck = this.deckForUri(u);
      if (!deck) {
        continue;
      }
      for (const inc of deck.includes) {
        const r = this.resolveInclude(inc.path, u);
        if (r) {
          stack.push(r);
        }
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // ID index

  private idIndex(uri: vscode.Uri): Map<string, Map<string, Card[]>> | undefined {
    const deck = this.deckForUri(uri);
    if (!deck) {
      return undefined;
    }
    const e = this.files.get(uri.toString());
    if (e?.ids && e.deck === deck) {
      return e.ids;
    }
    const ids = new Map<string, Map<string, Card[]>>();
    for (const card of deck.cards) {
      let m = ids.get(card.name);
      if (!m) {
        m = new Map();
        ids.set(card.name, m);
      }
      const def = CARDS.get(card.name);
      const keys: string[] = [];
      if (def?.listIds) {
        for (const f of card.fields) {
          if (/^\d+$/.test(f.text)) {
            keys.push(normId(f.text));
          }
        }
      } else if (card.fields.length) {
        keys.push(normId(card.fields[0].text));
      }
      for (const key of keys) {
        const arr = m.get(key);
        if (arr) {
          arr.push(card);
        } else {
          m.set(key, [card]);
        }
      }
    }
    if (e) {
      e.ids = ids;
    }
    return ids;
  }

  private lookupIn(uris: vscode.Uri[], cardNames: string[], id: string): CardLocation[] {
    const out: CardLocation[] = [];
    for (const u of uris) {
      const ids = this.idIndex(u);
      if (!ids) {
        continue;
      }
      for (const name of cardNames) {
        for (const card of ids.get(name)?.get(id) ?? []) {
          out.push({ uri: u, card });
        }
      }
    }
    return out;
  }

  /**
   * Find cards of a reference group with a given ID: first in the file and its
   * INCLUDE tree, then (optionally) anywhere in the workspace.
   */
  async findCards(from: vscode.Uri, group: string, idText: string): Promise<CardLocation[]> {
    const names = REF_GROUPS[group];
    if (!names) {
      return [];
    }
    const id = normId(idText);
    const tree = this.includeTree(from);
    let found = this.lookupIn(tree, names, id);
    if (found.length === 0 && vscode.workspace.getConfiguration('nastran').get<boolean>('index.searchWorkspace', true)) {
      const files = await this.workspaceFiles();
      const treeKeys = new Set(tree.map((u) => u.toString()));
      found = this.lookupIn(files.filter((u) => !treeKeys.has(u.toString())), names, id);
    }
    return found;
  }

  async workspaceFiles(): Promise<vscode.Uri[]> {
    return vscode.workspace.findFiles(NASTRAN_GLOB, '**/node_modules/**', 2000);
  }

  /** Files to search for references to something defined in `from`. */
  async referenceScope(from: vscode.Uri): Promise<vscode.Uri[]> {
    const tree = this.includeTree(from);
    if (!vscode.workspace.getConfiguration('nastran').get<boolean>('index.searchWorkspace', true)) {
      return tree;
    }
    const keys = new Set(tree.map((u) => u.toString()));
    const ws = (await this.workspaceFiles()).filter((u) => !keys.has(u.toString()));
    return [...tree, ...ws];
  }
}
