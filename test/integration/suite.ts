/**
 * Smoke tests that run inside a real VS Code instance (npm run test:vscode).
 */
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const samples = path.resolve(__dirname, '../../../samples');

async function open(rel: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument(path.join(samples, rel));
  await vscode.window.showTextDocument(doc);
  return doc;
}

function hoverText(hovers: vscode.Hover[]): string {
  return hovers
    .flatMap((h) => h.contents)
    .map((c) => (typeof c === 'string' ? c : 'value' in c ? c.value : ''))
    .join('\n');
}

async function waitFor<T>(fn: () => T | undefined, ms = 5000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) {
      return v;
    }
    if (Date.now() - t0 > ms) {
      throw new Error('timeout');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

const tests: [string, () => Promise<void>][] = [
  ['language is detected', async () => {
    const doc = await open('model.bdf');
    assert.strictEqual(doc.languageId, 'nastran');
  }],
  ['hover on a CQUAD4 grid field', async () => {
    const doc = await open('include/mesh.bdf');
    const line = doc.getText().split(/\r?\n/).findIndex((l) => l.startsWith('CQUAD4  1 '));
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, new vscode.Position(line, 26));
    const text = hoverText(hovers);
    assert.match(text, /G1/);
    assert.match(text, /GRID 1/, text);
    assert.ok(
      text.includes('<span style="color:var(--vscode-badge-foreground);background-color:var(--vscode-badge-background);">&nbsp;**G1**&nbsp;</span>'),
      'G1 drawn as a badge',
    );
  }],
  ['go to definition of a PID across INCLUDE files', async () => {
    const doc = await open('include/mesh.bdf');
    const line = doc.getText().split(/\r?\n/).findIndex((l) => l.startsWith('CQUAD4  1 '));
    const locs = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', doc.uri, new vscode.Position(line, 17));
    assert.ok(locs.length >= 1, 'definition found');
    assert.match(locs[0].uri.fsPath, /properties\.bdf$/);
  }],
  ['case control LOAD jumps to FORCE cards', async () => {
    const doc = await open('model.bdf');
    const line = doc.getText().split(/\r?\n/).findIndex((l) => l.trim() === 'LOAD = 10');
    const col = doc.lineAt(line).text.indexOf('10');
    const locs = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', doc.uri, new vscode.Position(line, col));
    assert.strictEqual(locs.length, 2);
  }],
  ['find references of a GRID', async () => {
    const doc = await open('include/mesh.bdf');
    const line = doc.getText().split(/\r?\n/).findIndex((l) => l.startsWith('GRID    5 '));
    const refs = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', doc.uri, new vscode.Position(line, 9));
    // 4 CQUAD4s use grid 5, plus the declaration
    assert.ok(refs.length >= 5, `found ${refs.length}`);
  }],
  ['INCLUDE document links resolve', async () => {
    const doc = await open('model.bdf');
    const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', doc.uri);
    assert.strictEqual(links.length, 2);
  }],
  ['outline has sections and card groups', async () => {
    const doc = await open('model.bdf');
    const syms = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', doc.uri);
    assert.deepStrictEqual(syms.map((s) => s.name), ['Executive Control', 'Case Control', 'Bulk Data']);
    const caseSec = syms[1];
    assert.ok(caseSec.children.some((c) => c.name === 'SUBCASE 2'));
  }],
  ['diagnostics for common mistakes', async () => {
    const doc = await open('mistakes.bdf');
    const diags = await waitFor(() => {
      const d = vscode.languages.getDiagnostics(doc.uri);
      return d.length >= 7 ? d : undefined;
    });
    const codes = diags.map((d) => String(d.code));
    for (const c of ['needs-decimal-point', 'embedded-blank', 'no-point-exponent', 'beyond-column-80', 'duplicate-id', 'orphan-continuation', 'include-not-found']) {
      assert.ok(codes.includes(c), `missing ${c}: ${codes.join(', ')}`);
    }
  }],
  ['clean samples have no diagnostics', async () => {
    for (const f of ['model.bdf', 'include/mesh.bdf', 'include/properties.bdf', 'alter.dmap', 'results.pch', 'matrix.pch', 'simcenter.dat']) {
      const doc = await open(f);
      await new Promise((r) => setTimeout(r, 800));
      const d = vscode.languages.getDiagnostics(doc.uri);
      assert.strictEqual(d.length, 0, `${f}: ${d.map((x) => `${x.range.start.line + 1}: ${x.message}`).join(' | ')}`);
    }
    const mistakes = await open('mistakes.bdf');
    for (const d of vscode.languages.getDiagnostics(mistakes.uri)) {
      console.log(`       mistakes.bdf:${d.range.start.line + 1} [${vscode.DiagnosticSeverity[d.severity]}] ${d.message}`);
    }
  }],
  ['DMAP words and DMIG header vs column fields in hovers', async () => {
    const dmap = await open('alter.dmap');
    const line = dmap.getText().split(/\r?\n/).findIndex((l) => l.includes('MATPRN'));
    let hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', dmap.uri, new vscode.Position(line, 5));
    assert.match(hoverText(hovers), /prints a matrix/i);
    const pch = await open('matrix.pch');
    hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', pch.uri, new vscode.Position(0, 33));
    assert.match(hoverText(hovers), /IFO/, 'header entry field 4 is IFO');
    hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', pch.uri, new vscode.Position(2, 10));
    assert.match(hoverText(hovers), /G1/, 'column entry first value field is G1');
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('nastran.reloadDefinitions') && commands.includes('nastran.openDefinitionsFolder'));
  }],
  ['quick fix adds a decimal point', async () => {
    const doc = await open('mistakes.bdf');
    const line = doc.getText().split(/\r?\n/).findIndex((l) => l.startsWith('GRID    1'));
    const range = new vscode.Range(line, 24, line, 25);
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', doc.uri, range);
    const fix = actions.find((a) => a.title.startsWith('Add decimal point'));
    assert.ok(fix?.edit, actions.map((a) => a.title).join(', '));
    await vscode.workspace.applyEdit(fix!.edit!);
    assert.strictEqual(doc.lineAt(line).text, 'GRID    1               0.      0       0');
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }],
  ['quick fix writes 2E11 as 2.+11', async () => {
    const doc = await open('mistakes.bdf');
    const line = doc.getText().split(/\r?\n/).findIndex((l) => l.startsWith('MAT1'));
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', doc.uri, new vscode.Range(line, 16, line, 17));
    const fix = actions.find((a) => a.title.startsWith('Add decimal point'));
    assert.ok(fix?.edit, actions.map((a) => a.title).join(', '));
    await vscode.workspace.applyEdit(fix!.edit!);
    assert.strictEqual(doc.lineAt(line).text, 'MAT1    1       2.+11           .3');
    const msg = vscode.languages.getDiagnostics(doc.uri).find((d) => d.message.includes('2.+11'));
    console.log(`       message was: ${msg?.message ?? '(already fixed)'}`);
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }],
  ['convert card to large field and back', async () => {
    const doc = await open('include/mesh.bdf');
    const ed = vscode.window.activeTextEditor!;
    const line = doc.getText().split(/\r?\n/).findIndex((l) => l.startsWith('CQUAD4,3'));
    ed.selection = new vscode.Selection(line, 0, line, 0);
    await vscode.commands.executeCommand('nastran.convertToLargeField');
    // default alignment is right-justified values (nastran.format.alignment = "right")
    assert.strictEqual(doc.lineAt(line).text, 'CQUAD4*                3               2               4               5');
    assert.strictEqual(doc.lineAt(line + 1).text, '*                      8               7');
    ed.selection = new vscode.Selection(line, 0, line, 0);
    await vscode.commands.executeCommand('nastran.convertToSmallField');
    assert.strictEqual(doc.lineAt(line).text, 'CQUAD4         3       2       4       5       8       7');
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }],
  ['blue hover highlight command writes and removes a theme-scoped color', async () => {
    const cfg = () => vscode.workspace.getConfiguration('workbench');
    const theme = cfg().get<string>('colorTheme')!;
    await cfg().update('colorCustomizations', { '[Some Other Theme]': { 'editor.background': '#000000' } }, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('nastran.useBlueHoverHighlight');
    let v = cfg().inspect<Record<string, Record<string, string>>>('colorCustomizations')!.globalValue!;
    assert.strictEqual(v[`[${theme}]`]?.['editor.hoverHighlightBackground'], '#3994BC33', JSON.stringify(v));
    assert.strictEqual(v['[Some Other Theme]']['editor.background'], '#000000', 'other customizations are kept');
    await vscode.commands.executeCommand('nastran.removeBlueHoverHighlight');
    v = cfg().inspect<Record<string, Record<string, string>>>('colorCustomizations')!.globalValue!;
    assert.strictEqual(v[`[${theme}]`], undefined, JSON.stringify(v));
    assert.deepStrictEqual(Object.keys(v), ['[Some Other Theme]']);
    await cfg().update('colorCustomizations', undefined, vscode.ConfigurationTarget.Global);
    console.log(`       (theme in test instance: ${theme})`);
  }],
  ['typing in a comment past column 80 wraps to a new comment line', async () => {
    const doc = await open('include/mesh.bdf');
    const ed = vscode.window.activeTextEditor!;
    const start = '$ This comment is long enough that typing a few more words will push it past col';
    await ed.edit((b) => b.insert(new vscode.Position(0, 0), start + '\n'));
    ed.selection = new vscode.Selection(0, start.length, 0, start.length);
    for (const ch of 'umn eighty here') {
      await vscode.commands.executeCommand('type', { text: ch });
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 200));
    const l0 = doc.lineAt(0).text;
    const l1 = doc.lineAt(1).text;
    assert.ok(l0.length <= 80, `first line ${l0.length} chars: ${l0}`);
    assert.ok(l1.startsWith('$ '), `continuation: ${l1}`);
    assert.strictEqual((l0 + ' ' + l1.slice(2)).replace(/\s+/g, ' '), (start + 'umn eighty here').replace(/\s+/g, ' '));
    assert.strictEqual(ed.selection.active.line, 1, 'cursor followed the text to the new line');
    assert.strictEqual(ed.selection.active.character, l1.length, 'cursor at the end of the typed text');
    await vscode.commands.executeCommand('undo');
    assert.ok(doc.lineAt(1).text.startsWith('GRID') || doc.lineAt(0).text.length <= start.length + 15);
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }],
  ['typing a long comment wraps it onto as many lines as needed', async () => {
    const doc = await open('include/mesh.bdf');
    const ed = vscode.window.activeTextEditor!;
    await ed.edit((b) => b.insert(new vscode.Position(0, 0), '$ \n'));
    ed.selection = new vscode.Selection(0, 2, 0, 2);
    const typed =
      'The plate is clamped along the root edge and loaded at the tip with a unit force in the negative z direction, ' +
      'the stiffener is modelled with CBAR elements offset from the shell reference plane, and the concentrated mass ' +
      'represents the instrumentation package that is bolted to the outboard corner of the plate.';
    for (const ch of typed) {
      await vscode.commands.executeCommand('type', { text: ch });
    }
    await new Promise((r) => setTimeout(r, 300));
    const lines: string[] = [];
    for (let l = 0; l < doc.lineCount && doc.lineAt(l).text.startsWith('$ ') && !doc.lineAt(l).text.startsWith('$ Plate mesh'); l++) {
      lines.push(doc.lineAt(l).text);
    }
    console.log(lines.map((l) => `       ${String(l.length).padStart(3)} | ${l}`).join('\n'));
    assert.ok(lines.length >= 4, `expected several wrapped lines, got ${lines.length}`);
    for (const l of lines) {
      assert.ok(l.length <= 80, `${l.length} chars: ${l}`);
    }
    assert.strictEqual(lines.map((l) => l.slice(2)).join(' ').replace(/\s+/g, ' '), typed);
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }],
  ['fast typing (keystrokes during a wrap) still wraps every line', async () => {
    const doc = await open('include/mesh.bdf');
    const ed = vscode.window.activeTextEditor!;
    await ed.edit((b) => b.insert(new vscode.Position(0, 0), '$ \n'));
    ed.selection = new vscode.Selection(0, 2, 0, 2);
    const typed = Array.from({ length: 70 }, (_, i) => `token${i}`).join(' ');
    // fire keystrokes without waiting for each one, like a fast typist or a held key
    const pending: Thenable<unknown>[] = [];
    for (const ch of typed) {
      pending.push(vscode.commands.executeCommand('type', { text: ch }));
    }
    await Promise.all(pending);
    await new Promise((r) => setTimeout(r, 500));
    const lines: string[] = [];
    for (let l = 0; l < doc.lineCount && !doc.lineAt(l).text.startsWith('$ Plate mesh'); l++) {
      lines.push(doc.lineAt(l).text);
    }
    console.log(`       ${lines.length} lines, longest ${Math.max(...lines.map((l) => l.length))}`);
    for (const l of lines) {
      assert.ok(l.length <= 80, `${l.length} chars: ${l}`);
    }
    assert.strictEqual(lines.map((l) => l.slice(2)).join(' ').replace(/\s+/g, ' '), typed);
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }],
  ['typing in the middle of a long comment wraps the tail as often as needed', async () => {
    const doc = await open('include/mesh.bdf');
    const ed = vscode.window.activeTextEditor!;
    const base = '$ ' + Array.from({ length: 12 }, (_, i) => `part${i}`).join(' '); // < 80
    await ed.edit((b) => b.insert(new vscode.Position(0, 0), base + '\n'));
    ed.selection = new vscode.Selection(0, 8, 0, 8);
    const typed = ' inserted words that are long enough to need more than one extra line of comment text';
    for (const ch of typed) {
      await vscode.commands.executeCommand('type', { text: ch });
    }
    await new Promise((r) => setTimeout(r, 300));
    const lines: string[] = [];
    for (let l = 0; l < doc.lineCount && !doc.lineAt(l).text.startsWith('$ Plate mesh'); l++) {
      lines.push(doc.lineAt(l).text);
    }
    for (const l of lines) {
      assert.ok(l.length <= 80, `${l.length} chars: ${l}`);
    }
    const expected = (base.slice(0, 8) + typed + base.slice(8)).slice(2);
    assert.strictEqual(lines.map((l) => l.slice(2)).join(' ').replace(/\s+/g, ' '), expected.replace(/\s+/g, ' '));
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }],
  ['Format Document wraps long comment lines', async () => {
    const long = '$ ' + Array.from({ length: 30 }, (_, i) => `note${i}`).join(' ');
    const content = [
      'SOL 101',
      'CEND',
      long,
      'BEGIN BULK',
      long,
      'CQUAD4         1       1       1       2       5       4',
      long,
      '+                      1      1.      1.      1.      1.',
      'GRID           1              0.      0.      0. ' + long,
      'ENDDATA',
    ].join('\n');
    const doc = await vscode.workspace.openTextDocument({ language: 'nastran', content });
    await vscode.window.showTextDocument(doc);
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', doc.uri, { tabSize: 8, insertSpaces: true });
    const we = new vscode.WorkspaceEdit();
    we.set(doc.uri, edits);
    await vscode.workspace.applyEdit(we);
    const lines = doc.getText().split(/\r?\n/);
    for (const l of lines) {
      assert.ok(l.length <= 80, `${l.length} chars: ${l}`);
    }
    const commentLines = lines.filter((l) => l.startsWith('$ '));
    assert.ok(commentLines.length >= 8, `${commentLines.length} comment lines`);
    // the card keeps its values; formatting writes the continuation marker in field 10 (FEMAP style)
    // and moves the comment that was between its lines above it
    const quad = lines.indexOf('CQUAD4         1       1       1       2       5       4                +');
    assert.ok(quad > 0, `card is still intact: ${lines.find((l) => l.startsWith('CQUAD4'))}`);
    assert.strictEqual(lines[quad + 1], '+                      1      1.      1.      1.      1.');
    assert.ok(lines[quad - 1].startsWith('$ note'), 'inner comment moved above the card');
    const grid = lines.findIndex((l) => l.startsWith('GRID'));
    assert.strictEqual(lines[grid], 'GRID           1              0.      0.      0.');
    assert.ok(lines[grid - 1].startsWith('$ note'), 'comment after the GRID card moved above it');
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }],
  ['completion offers cards in bulk data', async () => {
    const doc = await open('include/mesh.bdf');
    const ed = vscode.window.activeTextEditor!;
    await ed.edit((b) => b.insert(new vscode.Position(0, 0), 'CQU\n'));
    const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(0, 3));
    const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
    assert.ok(labels.includes('CQUAD4'));
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }],
  ['Simcenter comment headers fold', async () => {
    const doc = await open('simcenter.dat');
    const lines = doc.getText().split(/\r?\n/);
    const folds = await vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', doc.uri);
    const starts = new Set(folds.map((f) => lines[f.start].trim()));
    for (const t of ['$* EXECUTIVE CONTROL', '$* BULK DATA', '$* ELEMENT CARDS', '$*  Mesh Collector: Thin Shell(1)', '$*  Mesh: 2d_mesh(2)', '$*  Material: Steel::simcenter_fem1::[1]']) {
      assert.ok(starts.has(t), `no fold at ${t}`);
    }
    const bulk = folds.find((f) => lines[f.start].trim() === '$* BULK DATA')!;
    assert.strictEqual(lines[bulk.end + 1].trim(), 'ENDDATA');
    assert.strictEqual(bulk.kind, vscode.FoldingRangeKind.Region);
  }],
  ['.f06 output: language, outline, folding and messages', async () => {
    const doc = await open('modes.f06');
    assert.strictEqual(doc.languageId, 'nastran-output');
    const syms = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', doc.uri);
    const names = syms.map((s) => s.name);
    for (const n of ['CASE CONTROL ECHO', 'REAL EIGENVALUES', 'REAL EIGENVECTOR NO. 1', 'REAL EIGENVECTOR NO. 2', 'END OF JOB']) {
      assert.ok(names.includes(n), `missing ${n}: ${names.join(', ')}`);
    }
    // the warning is printed inside the case control echo section
    const echo = syms.find((s) => s.name === 'CASE CONTROL ECHO')!;
    assert.deepStrictEqual(echo.children.map((c) => c.name), ['USER WARNING MESSAGE 2251 (IFS1P)']);
    assert.match(syms.find((s) => s.name === 'REAL EIGENVECTOR NO. 1')!.detail, /SUBCASE 1 · p\. 6–7/);
    const folds = await vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', doc.uri);
    const lines = doc.getText().split(/\r?\n/);
    const eig = lines.findIndex((l) => l.includes('R E A L   E I G E N V E C T O R   N O .          1'));
    assert.ok(folds.some((f) => f.start === eig && f.end > eig + 8), 'eigenvector 1 folds over both pages');
    // WARNING in the Problems panel (default nastran.f06.messages = warning), no input deck diagnostics
    const diags = await waitFor(() => {
      const d = vscode.languages.getDiagnostics(doc.uri);
      return d.length ? d : undefined;
    });
    assert.deepStrictEqual(diags.map((d) => [d.severity, d.code]), [[vscode.DiagnosticSeverity.Warning, 2251]]);
    // input deck features are off
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, new vscode.Position(12, 6));
    assert.strictEqual(hovers.length, 0);
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', doc.uri, { tabSize: 8, insertSpaces: true });
    assert.ok(!edits || edits.length === 0);
  }],
];

export async function run(): Promise<void> {
  const ext = vscode.extensions.all.find((e) => e.packageJSON.name === 'nastran-bdf');
  await ext?.activate();
  const failures: string[] = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ok   ${name}`);
    } catch (e) {
      console.log(`  FAIL ${name}: ${(e as Error).message}`);
      failures.push(name);
    }
  }
  if (failures.length) {
    throw new Error(`${failures.length} test(s) failed`);
  }
}
