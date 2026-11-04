/**
 * Private / company-specific definitions loaded from JSON files.
 *
 * Files are read from ~/.nastran/definitions/*.json and from the paths in the
 * `nastran.definitionFiles` setting (files or folders). They can add or
 * override cards, PARAMs, case control commands, executive/DMAP statements,
 * reference groups and notes for INCLUDEd files. Nothing from these files is
 * part of the extension itself, so proprietary knowledge stays on the
 * user's machine. See schemas/nastran-definitions.schema.json for the format.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { BUILTIN_CARDS, CARDS } from './data/cards';
import {
  BUILTIN_CASE_COMMANDS,
  BUILTIN_EXEC_STATEMENTS,
  BUILTIN_PARAMS,
  CASE_COMMANDS,
  EXEC_STATEMENTS,
  INCLUDE_NOTES,
  PARAMS,
} from './data/control';
import { rebuildRefGroups } from './data/refs';
import { CardDef, CaseCommandDef, FieldDef, IdSpace, ParamDef, RepeatDef, VType } from './data/types';

const TYPES = new Set(['I', 'R', 'S', 'IR', 'IS', 'RS', 'IRS', 'A', '']);
const ID_SPACES = new Set(['grid', 'element', 'property', 'material', 'coord']);

type FieldInput = [string, string, string, string?] | { name: string; type?: string; desc?: string; ref?: string; required?: boolean };

interface RepeatInput {
  from: number;
  fields: FieldInput[];
  start?: number;
  step?: number;
}

interface CardInput {
  name: string;
  group?: string;
  desc?: string;
  fields?: FieldInput[];
  repeat?: RepeatInput;
  idSpace?: string;
  listIds?: boolean;
  notes?: string;
  variants?: { when: { index: number; values: string[] }; desc?: string; fields?: FieldInput[]; repeat?: RepeatInput }[];
}

export interface DefinitionsFile {
  name?: string;
  cards?: CardInput[];
  params?: ParamDef[];
  caseCommands?: CaseCommandDef[];
  statements?: Record<string, string>;
  includes?: { pattern: string; desc: string }[];
  refGroups?: Record<string, string[]>;
}

export interface LoadResult {
  files: string[];
  counts: { cards: number; params: number; caseCommands: number; statements: number; includes: number };
  errors: string[];
}

function field(input: FieldInput, where: string, errors: string[]): FieldDef {
  if (Array.isArray(input)) {
    const [name, type = '', desc = '', ref] = input;
    return field({ name, type, desc, ref }, where, errors);
  }
  let type = (input.type ?? '').toUpperCase();
  let required = input.required ?? false;
  if (type.endsWith('!')) {
    required = true;
    type = type.slice(0, -1);
  }
  if (!TYPES.has(type)) {
    errors.push(`${where}: field "${input.name}" has unknown type "${input.type}" (use I, R, S, IR, IS, RS, IRS or A)`);
    type = 'A';
  }
  return { name: input.name ?? '', type: type as VType, required, desc: input.desc ?? '', ref: input.ref };
}

function repeat(input: RepeatInput | undefined, where: string, errors: string[]): RepeatDef | undefined {
  if (!input) {
    return undefined;
  }
  return {
    from: input.from,
    fields: (input.fields ?? []).map((f) => field(f, `${where} repeat`, errors)),
    start: input.start ?? 1,
    step: input.step ?? 1,
  };
}

function card(input: CardInput, source: string, errors: string[]): CardDef | undefined {
  if (!input?.name) {
    errors.push(`${source}: a card has no "name"`);
    return undefined;
  }
  const name = input.name.toUpperCase();
  const where = `${source}: ${name}`;
  if (input.idSpace && !ID_SPACES.has(input.idSpace)) {
    errors.push(`${where}: unknown idSpace "${input.idSpace}"`);
  }
  return {
    name,
    group: input.group ?? 'Custom',
    desc: input.desc ?? '',
    fields: (input.fields ?? []).map((f) => field(f, where, errors)),
    repeat: repeat(input.repeat, where, errors),
    idSpace: ID_SPACES.has(input.idSpace ?? '') ? (input.idSpace as IdSpace) : undefined,
    listIds: input.listIds,
    notes: input.notes,
    variants: input.variants?.map((v) => ({
      when: { index: v.when.index, values: v.when.values.map((x) => String(x).toUpperCase()) },
      desc: v.desc,
      fields: (v.fields ?? []).map((f) => field(f, `${where} variant`, errors)),
      repeat: repeat(v.repeat, `${where} variant`, errors),
    })),
    source,
  };
}

/** Expand ~, ${userHome} and ${workspaceFolder} in a configured path. */
export function expandPath(p: string): string {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  return p
    .replace(/^~(?=$|[\\/])/, os.homedir())
    .replace(/\$\{userHome\}/g, os.homedir())
    .replace(/\$\{workspaceFolder\}/g, ws);
}

export function defaultDefinitionsDir(): string {
  return path.join(os.homedir(), '.nastran', 'definitions');
}

function jsonFilesIn(target: string): string[] {
  try {
    const st = fs.statSync(target);
    if (st.isFile()) {
      return [target];
    }
    if (st.isDirectory()) {
      return fs
        .readdirSync(target)
        .filter((f) => f.toLowerCase().endsWith('.json'))
        .sort()
        .map((f) => path.join(target, f));
    }
  } catch {
    // missing path: ignored
  }
  return [];
}

/** Reset to the built-in knowledge, then apply every definitions file. */
export function applyDefinitions(paths: string[]): LoadResult {
  CARDS.clear();
  BUILTIN_CARDS.forEach((v, k) => CARDS.set(k, v));
  PARAMS.clear();
  BUILTIN_PARAMS.forEach((v, k) => PARAMS.set(k, v));
  CASE_COMMANDS.clear();
  BUILTIN_CASE_COMMANDS.forEach((v, k) => CASE_COMMANDS.set(k, v));
  for (const k of Object.keys(EXEC_STATEMENTS)) {
    delete EXEC_STATEMENTS[k];
  }
  Object.assign(EXEC_STATEMENTS, BUILTIN_EXEC_STATEMENTS);
  INCLUDE_NOTES.length = 0;

  const result: LoadResult = { files: [], counts: { cards: 0, params: 0, caseCommands: 0, statements: 0, includes: 0 }, errors: [] };
  const refGroups: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const p of paths) {
    for (const file of jsonFilesIn(p)) {
      const key = path.resolve(file).toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      let data: DefinitionsFile;
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
      } catch (e) {
        result.errors.push(`${file}: ${(e as Error).message}`);
        continue;
      }
      const source = data.name || path.basename(file);
      result.files.push(file);
      for (const c of data.cards ?? []) {
        const def = card(c, source, result.errors);
        if (def) {
          CARDS.set(def.name, def);
          result.counts.cards++;
        }
      }
      for (const prm of data.params ?? []) {
        if (prm?.name) {
          PARAMS.set(prm.name.toUpperCase(), { ...prm, name: prm.name.toUpperCase(), source });
          result.counts.params++;
        }
      }
      for (const cmd of data.caseCommands ?? []) {
        if (cmd?.name) {
          CASE_COMMANDS.set(cmd.name.toUpperCase(), { ...cmd, name: cmd.name.toUpperCase(), source });
          result.counts.caseCommands++;
        }
      }
      for (const [name, desc] of Object.entries(data.statements ?? {})) {
        EXEC_STATEMENTS[name.toUpperCase()] = `${desc} *(${source})*`;
        result.counts.statements++;
      }
      for (const inc of data.includes ?? []) {
        if (inc?.pattern && inc.desc) {
          INCLUDE_NOTES.push({ pattern: inc.pattern, desc: `${inc.desc} *(${source})*` });
          result.counts.includes++;
        }
      }
      for (const [g, names] of Object.entries(data.refGroups ?? {})) {
        refGroups[g] = [...(refGroups[g] ?? []), ...names];
      }
    }
  }
  rebuildRefGroups(refGroups);
  return result;
}

/** Loads definition files, reloads them on change and reports problems. */
export class CustomDefinitions implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<LoadResult>();
  readonly onDidChange = this.changed.event;
  private watchers: vscode.Disposable[] = [];
  private disposables: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;
  last: LoadResult = { files: [], counts: { cards: 0, params: 0, caseCommands: 0, statements: 0, includes: 0 }, errors: [] };

  constructor(private output: vscode.OutputChannel) {
    this.disposables.push(
      this.changed,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('nastran.definitionFiles')) {
          this.reload();
        }
      }),
    );
    this.reload();
  }

  paths(): string[] {
    const extra = vscode.workspace.getConfiguration('nastran').get<string[]>('definitionFiles', []);
    return [defaultDefinitionsDir(), ...extra.map(expandPath)];
  }

  reload(): LoadResult {
    const res = applyDefinitions(this.paths());
    this.last = res;
    this.output.appendLine(
      `[definitions] ${res.files.length} file(s): ${res.counts.cards} cards, ${res.counts.params} PARAMs, ` +
        `${res.counts.caseCommands} case control commands, ${res.counts.statements} statements, ${res.counts.includes} INCLUDE notes`,
    );
    for (const f of res.files) {
      this.output.appendLine(`  ${f}`);
    }
    for (const e of res.errors) {
      this.output.appendLine(`  problem: ${e}`);
    }
    if (res.errors.length) {
      void vscode.window
        .showWarningMessage(`Nastran: ${res.errors.length} problem(s) in definition files.`, 'Show Details')
        .then((a) => (a ? this.output.show(true) : undefined));
    }
    this.watch();
    this.changed.fire(res);
    return res;
  }

  private watch() {
    this.watchers.forEach((w) => w.dispose());
    this.watchers = [];
    for (const p of this.paths()) {
      let base = p;
      let pattern = '*.json';
      try {
        if (fs.statSync(p).isFile()) {
          base = path.dirname(p);
          pattern = path.basename(p);
        }
      } catch {
        // watch the folder even if it does not exist yet
      }
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(base), pattern));
      const schedule = () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.reload(), 300);
      };
      w.onDidChange(schedule);
      w.onDidCreate(schedule);
      w.onDidDelete(schedule);
      this.watchers.push(w);
    }
  }

  /** Create the default folder (with a README) and reveal it. */
  async openFolder(): Promise<void> {
    const dir = defaultDefinitionsDir();
    fs.mkdirSync(dir, { recursive: true });
    const readme = path.join(dir, 'README.txt');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(
        readme,
        [
          'Private Nastran definitions for the Nastran BDF VS Code extension.',
          '',
          'Every *.json file in this folder is loaded automatically. Files here are never',
          'published with the extension. Use them for company or vendor specific cards,',
          'PARAMs used by DMAP alters, case control commands and notes for INCLUDE files.',
          '',
          'Files in this folder get completion and validation in VS Code (JSON schema).',
          'Start a new file with:  { "name": "My definitions", "params": [] }',
          '',
        ].join('\n'),
      );
    }
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(readme));
  }

  dispose() {
    clearTimeout(this.timer);
    this.watchers.forEach((w) => w.dispose());
    this.disposables.forEach((d) => d.dispose());
  }
}
