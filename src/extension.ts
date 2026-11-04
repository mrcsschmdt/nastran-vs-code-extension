import * as vscode from 'vscode';
import { Model, OUTPUT_LANGUAGE } from './model';
import { NastranHoverProvider } from './features/hover';
import { NastranCompletionProvider } from './features/completion';
import { DiagnosticsManager, NastranCodeActions } from './features/diagnostics';
import { NastranFormatter, convertSelection, formatDocument, insertFieldHeader } from './features/formatting';
import {
  NastranDefinitionProvider,
  NastranFoldingProvider,
  NastranLinkProvider,
  NastranReferenceProvider,
  NastranSymbolProvider,
} from './features/navigation';
import { EditorUi, showModelSummary } from './features/editorUi';
import { registerHoverHint, removeBlueHoverHighlight, useBlueHoverHighlight } from './features/hoverTheme';
import { CustomDefinitions } from './custom';
import { CommentWrapper, wrapComments } from './features/commentWrap';

export function activate(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = [{ language: 'nastran' }];
  // outline and folding also serve Nastran output (.f06) files
  const withOutput: vscode.DocumentSelector = [{ language: 'nastran' }, { language: OUTPUT_LANGUAGE }];
  const output = vscode.window.createOutputChannel('Nastran');
  // Private definitions must be loaded before any provider runs.
  const definitions = new CustomDefinitions(output);
  const model = new Model();
  const ui = new EditorUi(model);
  const formatter = new NastranFormatter(model);

  const diagnostics = new DiagnosticsManager(model);
  context.subscriptions.push(
    output,
    definitions,
    definitions.onDidChange(() => diagnostics.refreshAll()),
    ui,
    diagnostics,
    vscode.commands.registerCommand('nastran.openDefinitionsFolder', () => definitions.openFolder()),
    new CommentWrapper(),
    vscode.commands.registerCommand('nastran.wrapComments', () => wrapComments()),
    vscode.commands.registerCommand('nastran.reloadDefinitions', () => {
      const r = definitions.reload();
      void vscode.window.showInformationMessage(
        `Nastran: loaded ${r.files.length} definition file(s) (${r.counts.cards} cards, ${r.counts.params} PARAMs, ` +
          `${r.counts.caseCommands} case control commands, ${r.counts.statements} statements, ${r.counts.includes} INCLUDE notes).`,
      );
    }),
    vscode.languages.registerHoverProvider(selector, new NastranHoverProvider(model)),
    vscode.languages.registerCompletionItemProvider(selector, new NastranCompletionProvider(model), ',', ' ', '('),
    vscode.languages.registerDefinitionProvider(selector, new NastranDefinitionProvider(model)),
    vscode.languages.registerReferenceProvider(selector, new NastranReferenceProvider(model)),
    vscode.languages.registerDocumentLinkProvider(selector, new NastranLinkProvider(model)),
    vscode.languages.registerDocumentSymbolProvider(withOutput, new NastranSymbolProvider(model), { label: 'Nastran' }),
    vscode.languages.registerFoldingRangeProvider(withOutput, new NastranFoldingProvider(model)),
    vscode.languages.registerDocumentFormattingEditProvider(selector, formatter),
    vscode.languages.registerDocumentRangeFormattingEditProvider(selector, formatter),
    vscode.languages.registerCodeActionsProvider(selector, new NastranCodeActions(model), {
      providedCodeActionKinds: NastranCodeActions.kinds,
    }),
    vscode.commands.registerCommand('nastran.convertToSmallField', () => convertSelection(model, 'small')),
    vscode.commands.registerCommand('nastran.convertToLargeField', () => convertSelection(model, 'large')),
    vscode.commands.registerCommand('nastran.convertToFreeField', () => convertSelection(model, 'free')),
    vscode.commands.registerCommand('nastran.alignCards', () => convertSelection(model, 'preserve')),
    vscode.commands.registerCommand('nastran.formatDocument', () => formatDocument(model)),
    vscode.commands.registerCommand('nastran.insertFieldHeader', () => insertFieldHeader(model)),
    vscode.commands.registerCommand('nastran.toggleFieldShading', () => ui.toggleShading()),
    vscode.commands.registerCommand('nastran.showModelSummary', () => showModelSummary(model)),
    vscode.commands.registerCommand('nastran.useBlueHoverHighlight', () => useBlueHoverHighlight()),
    vscode.commands.registerCommand('nastran.removeBlueHoverHighlight', () => removeBlueHoverHighlight()),
    registerHoverHint(context),
  );
}

export function deactivate(): void {
  // nothing to clean up beyond context.subscriptions
}
