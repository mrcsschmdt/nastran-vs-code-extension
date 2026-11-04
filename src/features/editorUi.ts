import * as vscode from 'vscode';
import * as path from 'path';
import { Model, isOutputDocument } from '../model';
import { CARDS, defForCard, fieldDef } from '../data/cards';
import { lookupCaseCommand } from '../data/control';
import { contextAt, fieldPosition, toRange } from '../util';
import { f06Status } from './output';

/**
 * Shades every other field of fixed-format bulk data lines so field
 * boundaries are visible, and shows the field under the cursor in the status bar.
 */
export class EditorUi implements vscode.Disposable {
  // Translucent on purpose: VS Code paints decorations above the selection and
  // the current-line highlight, so an opaque color would hide the selection.
  private shade = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('nastran.fieldShadingBackground'),
    borderRadius: '3px',
  });
  /**
   * Variant for lines that already carry the line highlight or a selection.
   * Translucent layers add brightness, so on top of the (lighter) line highlight
   * this needs a little more opacity to show the same field contrast.
   */
  private shadeActive = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('nastran.fieldShadingActiveLineBackground'),
    borderRadius: '3px',
  });
  private status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private disposables: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private model: Model) {
    this.status.command = 'editor.action.showHover';
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshAll()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshAll()),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => this.schedule(e.textEditor)),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        this.updateStatus(e.textEditor);
        this.decorate(e.textEditor);
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        for (const ed of vscode.window.visibleTextEditors) {
          if (ed.document === e.document) {
            this.schedule(ed);
          }
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('nastran')) {
          this.refreshAll();
        }
      }),
    );
    this.refreshAll();
  }

  private enabled(): boolean {
    return vscode.workspace.getConfiguration('nastran').get<boolean>('fieldShading.enabled', true);
  }

  async toggleShading(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('nastran');
    await cfg.update('fieldShading.enabled', !this.enabled(), vscode.ConfigurationTarget.Global);
  }

  private refreshAll() {
    for (const ed of vscode.window.visibleTextEditors) {
      this.decorate(ed);
    }
    const active = vscode.window.activeTextEditor;
    if (active) {
      this.updateStatus(active);
    } else {
      this.status.hide();
    }
  }

  private schedule(ed: vscode.TextEditor) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.decorate(ed), 150);
  }

  private decorate(ed: vscode.TextEditor) {
    const doc = ed.document;
    if (doc.languageId !== 'nastran') {
      return;
    }
    const max = vscode.workspace.getConfiguration('nastran').get<number>('maxLinesForAnalysis', 400000);
    if (!this.enabled() || doc.lineCount > max) {
      ed.setDecorations(this.shade, []);
      ed.setDecorations(this.shadeActive, []);
      return;
    }
    const deck = this.model.deck(doc);
    const ranges: vscode.Range[] = [];
    const activeRanges: vscode.Range[] = [];
    const seen = new Set<number>();
    const isActive = (l: number) => ed.selections.some((s) => l >= s.start.line && l <= s.end.line);
    for (const vr of ed.visibleRanges) {
      const from = Math.max(0, vr.start.line - 100);
      const to = Math.min(doc.lineCount - 1, vr.end.line + 100);
      for (let l = from; l <= to; l++) {
        const ci = deck.cardIndexAt(l);
        if (ci < 0) {
          continue;
        }
        const card = deck.cards[ci];
        const cl = card.lines.find((x) => x.line === l);
        if (!cl || cl.format === 'free' || seen.has(l)) {
          continue;
        }
        seen.add(l);
        const target = isActive(l) ? activeRanges : ranges;
        cl.data.forEach((s, k) => {
          if (k % 2 === 0 && !s.virtual && s.span.end > s.span.start) {
            target.push(toRange(s.span));
          }
        });
        if (cl.cont && !cl.cont.virtual && cl.cont.span.end > cl.cont.span.start) {
          target.push(toRange(cl.cont.span));
        }
      }
    }
    ed.setDecorations(this.shade, ranges);
    ed.setDecorations(this.shadeActive, activeRanges);
  }

  private updateStatus(ed: vscode.TextEditor) {
    const max = vscode.workspace.getConfiguration('nastran').get<number>('maxLinesForAnalysis', 400000);
    if ((ed.document.languageId !== 'nastran' && !isOutputDocument(ed.document)) || ed.document.lineCount > max) {
      this.status.hide();
      return;
    }
    if (isOutputDocument(ed.document)) {
      const st = f06Status(this.model.f06(ed.document), ed.selection.active.line);
      this.status.text = st.text;
      this.status.tooltip = `${st.tooltip}\nClick to open the Problems panel.`;
      this.status.command = 'workbench.actions.view.problems';
      this.status.show();
      return;
    }
    this.status.command = 'editor.action.showHover';
    const deck = this.model.deck(ed.document);
    const pos = ed.selection.active;
    const ctx = contextAt(deck, pos);
    let text: string | undefined;
    let tip: string | undefined;
    if (ctx.include) {
      text = `$(file) INCLUDE ${path.basename(ctx.include.path)}`;
    } else if (ctx.hit) {
      const card = ctx.hit.card;
      const def = defForCard(card);
      if (ctx.hit.kind === 'data') {
        const fd = def ? fieldDef(def, ctx.hit.index) : undefined;
        const { line, field } = fieldPosition(ctx.hit.index);
        text = `$(symbol-field) ${card.name} › ${fd?.name || '(blank)'} · field ${field}${line ? ` (cont. ${line})` : ''}`;
        tip = fd?.desc;
      } else if (ctx.hit.kind === 'name') {
        text = `$(symbol-structure) ${card.name} · ${card.format} field`;
        tip = def?.desc;
      } else {
        text = `$(symbol-field) ${card.name} › ${ctx.hit.kind === 'cont' ? 'field 10 (continuation)' : 'field 1 (continuation)'}`;
      }
    } else if (ctx.caseCommand) {
      const def = lookupCaseCommand(ctx.caseCommand.name);
      const sc = ctx.caseCommand.subcase;
      text = `$(symbol-event) ${ctx.caseCommand.name}${sc !== undefined ? ` · SUBCASE ${sc}` : ''}`;
      tip = def?.desc;
    } else {
      const names = { exec: 'Executive Control', case: 'Case Control', bulk: 'Bulk Data', end: 'after ENDDATA' };
      text = `$(symbol-namespace) ${names[ctx.section]}`;
    }
    this.status.text = text;
    this.status.tooltip = tip;
    this.status.show();
  }

  dispose() {
    this.shade.dispose();
    this.shadeActive.dispose();
    this.status.dispose();
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}

/** Markdown summary of card counts and the INCLUDE tree. */
export async function showModelSummary(model: Model): Promise<void> {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.languageId !== 'nastran') {
    return;
  }
  const tree = model.includeTree(ed.document.uri);
  const counts = new Map<string, number>();
  const lines: string[] = [`# Nastran model summary: ${path.basename(ed.document.uri.fsPath)}`, ''];
  lines.push('## Files', '');
  for (const u of tree) {
    const deck = model.deckForUri(u);
    lines.push(`- ${vscode.workspace.asRelativePath(u)} (${deck?.cards.length ?? 0} cards)`);
    for (const c of deck?.cards ?? []) {
      counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    }
    for (const inc of deck?.includes ?? []) {
      if (!model.resolveInclude(inc.path, u)) {
        lines.push(`  - **missing**: ${inc.path}`);
      }
    }
  }
  const byGroup = new Map<string, [string, number][]>();
  for (const [name, n] of counts) {
    const g = CARDS.get(name)?.group ?? 'Other';
    const arr = byGroup.get(g) ?? [];
    arr.push([name, n]);
    byGroup.set(g, arr);
  }
  lines.push('', '## Cards', '');
  for (const [g, arr] of [...byGroup.entries()].sort()) {
    lines.push(`### ${g}`, '', '| Card | Count |', '|---|---:|');
    for (const [name, n] of arr.sort()) {
      lines.push(`| ${name} | ${n} |`);
    }
    lines.push('');
  }
  const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: lines.join('\n') });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}
