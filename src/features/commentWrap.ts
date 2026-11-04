/**
 * Hard-wraps `$` comment lines while typing so they stay within the page width
 * (column 80 by default), and provides a command to wrap existing comments.
 */
import * as vscode from 'vscode';
import { commentBreaks, commentPrefix, wrapCommentLine } from '../parser/comments';

function settings() {
  const cfg = vscode.workspace.getConfiguration('nastran.comments');
  return { enabled: cfg.get<boolean>('autoWrap', true), column: Math.max(20, cfg.get<number>('wrapColumn', 80)) };
}

function eolOf(doc: vscode.TextDocument): string {
  return doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
}

export class CommentWrapper implements vscode.Disposable {
  private disposable: vscode.Disposable;
  private running = false;
  /** Lines (in the active document) that still need a check. */
  private pending = new Set<number>();

  constructor() {
    this.disposable = vscode.workspace.onDidChangeTextDocument((e) => this.onChange(e));
  }

  private onChange(e: vscode.TextDocumentChangeEvent): void {
    const { enabled } = settings();
    // (our own wrap edits insert a line break and are ignored by the checks below)
    if (!enabled || e.document.languageId !== 'nastran') {
      return;
    }
    // only plain typing: one change, no undo/redo, no line breaks, short text
    if (e.reason !== undefined || e.contentChanges.length !== 1) {
      return;
    }
    const change = e.contentChanges[0];
    if (change.text.length === 0 || change.text.length > 2 || /[\r\n]/.test(change.text)) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== e.document || editor.selections.length !== 1) {
      return;
    }
    this.pending.add(change.range.start.line);
    void this.flush(editor);
  }

  /**
   * Wrap pending lines. Keystrokes that arrive while an edit is being applied
   * are queued (not dropped), and an edit that VS Code rejects because the
   * text changed meanwhile is retried on the current text.
   */
  private async flush(editor: vscode.TextEditor): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      for (let attempt = 0; attempt < 20 && this.pending.size; attempt++) {
        const lineNo = Math.min(...this.pending);
        this.pending.delete(lineNo);
        const doc = editor.document;
        if (doc.isClosed || lineNo >= doc.lineCount) {
          continue;
        }
        const { column } = settings();
        const breaks = commentBreaks(doc.lineAt(lineNo).text, column);
        if (breaks.length === 0) {
          continue;
        }
        const version = doc.version;
        const eol = eolOf(doc);
        // replace only the blanks at the breaks so the cursor keeps its place in the text
        const ok = await editor.edit(
          (eb) => {
            for (const b of breaks) {
              eb.replace(new vscode.Range(lineNo, b.start, lineNo, b.end), eol + b.prefix);
            }
          },
          { undoStopBefore: false, undoStopAfter: false },
        );
        if (!ok || doc.version === version) {
          // typing changed the text before our edit could apply: check this line again
          this.pending.add(lineNo);
          await new Promise((r) => setTimeout(r, 10));
        } else {
          // typing continues on the last of the new lines; keep watching it
          this.pending.add(lineNo + breaks.length);
        }
      }
    } finally {
      this.running = false;
    }
    // a keystroke may have queued a line after the loop's last check
    if (this.pending.size && vscode.window.activeTextEditor === editor) {
      setTimeout(() => void this.flush(editor), 0);
    } else {
      this.pending.clear();
    }
  }

  dispose() {
    this.disposable.dispose();
  }
}

/** Wrap all comment lines in the selection (or the whole file) that are longer than the wrap column. */
export async function wrapComments(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'nastran') {
    return;
  }
  const doc = editor.document;
  const { column } = settings();
  const whole = editor.selections.every((s) => s.isEmpty);
  const lines = new Set<number>();
  if (whole) {
    for (let l = 0; l < doc.lineCount; l++) {
      lines.add(l);
    }
  } else {
    for (const s of editor.selections) {
      for (let l = s.start.line; l <= s.end.line; l++) {
        lines.add(l);
      }
    }
  }
  const eol = eolOf(doc);
  let count = 0;
  await editor.edit((eb) => {
    for (const l of lines) {
      const text = doc.lineAt(l).text;
      if (commentPrefix(text) === undefined || text.length <= column) {
        continue;
      }
      const wrapped = wrapCommentLine(text, column);
      if (wrapped.length > 1) {
        eb.replace(doc.lineAt(l).range, wrapped.join(eol));
        count++;
      }
    }
  });
  vscode.window.setStatusBarMessage(`Nastran: wrapped ${count} comment line${count === 1 ? '' : 's'} at column ${column}.`, 4000);
}
