import * as vscode from 'vscode';
import * as path from 'path';
import { Model, CardLocation } from '../model';
import { CARDS, defForCard, fieldDef } from '../data/cards';
import { REF_GROUPS, refLabel } from '../data/refs';
import { PARAMS, SOLUTIONS, EXEC_STATEMENTS, includeNotesFor, lookupCaseCommand } from '../data/control';
import { ParamDef } from '../data/types';
import { classify } from '../parser/values';
import { columnsOf, contextAt, fieldPosition, layoutTable, toRange, typeName } from '../util';

const FORMAT_LABEL = {
  small: 'small field (8-character fields)',
  large: 'large field (16-character fields)',
  free: 'free field (comma separated)',
};

async function refPreview(model: Model, from: vscode.Uri, group: string, value: string): Promise<string> {
  if (!/^[+-]?\d+$/.test(value.trim()) || parseInt(value, 10) <= 0) {
    return '';
  }
  let found: CardLocation[] = [];
  try {
    found = await model.findCards(from, group, value);
  } catch {
    return '';
  }
  if (found.length === 0) {
    return `\n\n$(warning) No ${refLabel(group)} with ID ${value.trim()} found in this file, its INCLUDEs or the workspace.`;
  }
  const f = found[0];
  const lines = model.lineTexts(f.uri, f.card.startLine, Math.min(f.card.endLine, f.card.startLine + 3));
  const text = lines.length ? '\n```nastran\n' + lines.join('\n') + '\n```' : '';
  const where = f.uri.toString() === from.toString() ? `line ${f.card.startLine + 1}` : `${path.basename(f.uri.fsPath)}:${f.card.startLine + 1}`;
  const more = found.length > 1 ? ` (+${found.length - 1} more)` : '';
  return `\n\n→ **${f.card.name} ${value.trim()}** (${where})${more}${text}`;
}

function paramMarkdown(p: ParamDef): string {
  return (
    `**PARAM ${p.name}**: ${p.desc}` +
    (p.values ? `  \nValues: ${p.values}` : '') +
    (p.default ? `  \nDefault: ${p.default}` : '') +
    (p.source ? `  \n*from ${p.source}*` : '')
  );
}

export class NastranHoverProvider implements vscode.HoverProvider {
  constructor(private model: Model) {}

  async provideHover(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Hover | undefined> {
    const deck = this.model.deck(doc);
    const ctx = contextAt(deck, pos);
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;

    if (ctx.include) {
      const inc = ctx.include;
      const r = this.model.resolveInclude(inc.path, doc.uri);
      md.appendMarkdown(`**INCLUDE** \`${inc.path}\`\n\n`);
      md.appendMarkdown(r ? `Resolved to \`${r.fsPath}\`` : '$(error) File not found (searched relative to this file, the workspace folders and `nastran.includePaths`).');
      for (const note of includeNotesFor(inc.path)) {
        md.appendMarkdown(`\n\n---\n\n${note.desc}`);
      }
      return new vscode.Hover(md);
    }

    if (ctx.hit) {
      const hit = ctx.hit;
      const card = hit.card;
      const def = defForCard(card);
      if (hit.kind === 'name') {
        if (!def) {
          md.appendMarkdown(`**${card.name}** — not in the extension's card database. Written in ${FORMAT_LABEL[card.format]}.`);
          return new vscode.Hover(md, toRange(card.nameSpan));
        }
        md.appendMarkdown(`**${def.name}** — ${def.desc}  \n*${def.group} · written in ${FORMAT_LABEL[card.format]}${def.source ? ` · from ${def.source}` : ''}*\n\n`);
        md.appendMarkdown(layoutTable(def));
        if (def.notes) {
          md.appendMarkdown(`\n\n${def.notes}`);
        }
        return new vscode.Hover(md, toRange(card.nameSpan));
      }
      if (hit.kind === 'cont' || hit.kind === 'contHead') {
        const n = card.lines.indexOf(hit.line);
        md.appendMarkdown(
          hit.kind === 'cont'
            ? `**Field 10** of ${card.name}: continuation marker (Nastran matches it with field 1 of the next line; blank is fine when the next line follows directly).`
            : `**Field 1** — continuation line ${n} of **${card.name}** (\`+\` or blank for small field, \`*\` for large field).`,
        );
        return new vscode.Hover(md);
      }
      // data field
      const i = hit.index;
      const fd = def ? fieldDef(def, i) : undefined;
      const { line, field } = fieldPosition(i);
      const local = i - hit.line.firstIndex;
      const cols = columnsOf(hit.line.format, local);
      const physical = hit.line.format === 'large' ? ` · large-field slot ${local + 2} of this line` : '';
      const value = hit.slot.text;
      const title = fd?.name ? `\`${fd.name}\`` : def ? '*(unused field)*' : '*(unknown card)*';
      md.appendMarkdown(`**${card.name}** · ${title}\n\n`);
      md.appendMarkdown(`Field ${field}${line > 0 ? ` of continuation ${line}` : ''}${cols ? ` · ${cols}` : ''}${physical}`);
      if (fd) {
        md.appendMarkdown(` · ${typeName(fd.type)}${fd.required ? ' · **required**' : ''}\n\n${fd.desc}`);
      }
      if (value) {
        const kind = classify(value);
        md.appendMarkdown(`\n\nValue: \`${value}\` (${kind === 'badReal' ? 'invalid real: missing decimal point' : kind})`);
      }
      if (card.name === 'PARAM' && i === 0 && value) {
        const p = PARAMS.get(value.toUpperCase());
        if (p) {
          md.appendMarkdown(`\n\n${paramMarkdown(p)}`);
        }
      }
      if (fd?.ref && value && REF_GROUPS[fd.ref]) {
        md.appendMarkdown(await refPreview(this.model, doc.uri, fd.ref, value));
      }
      if (def) {
        // Only the sanitizer-safe spans from layoutTable are HTML; field values are in code spans.
        md.supportHtml = true;
        md.appendMarkdown('\n\n---\n\n' + layoutTable(def, i, undefined, true));
      }
      return new vscode.Hover(md, hit.slot.virtual ? undefined : toRange(hit.slot.span));
    }

    if (ctx.caseCommand) {
      const cmd = ctx.caseCommand;
      const def = lookupCaseCommand(cmd.name);
      const describer = cmd.describers.find((d) => d.span.line === pos.line && pos.character >= d.span.start && pos.character <= d.span.end);
      if (describer && def?.describers) {
        const dd = def.describers.find((d) => describer.text.toUpperCase().startsWith(d.name));
        if (dd) {
          md.appendMarkdown(`**${dd.name}** (describer of ${def.name}): ${dd.desc}`);
          return new vscode.Hover(md, toRange(describer.span));
        }
      }
      if (cmd.name === 'PARAM') {
        const name = cmd.value.replace(/^,/, '').split(',')[0]?.trim().toUpperCase();
        const p = name ? PARAMS.get(name) : undefined;
        if (p) {
          md.appendMarkdown(paramMarkdown(p));
          return new vscode.Hover(md);
        }
      }
      if (!def) {
        return undefined;
      }
      md.appendMarkdown(`**${def.name}** (case control) — ${def.desc}${def.source ? ` *(${def.source})*` : ''}`);
      if (def.syntax) {
        md.appendMarkdown(`\n\n\`${def.syntax}\``);
      }
      if (def.output) {
        md.appendMarkdown('\n\nValue: `ALL`, `NONE` or the ID of a case control `SET`.');
      }
      if (def.ref && cmd.valueSpan && pos.line === cmd.valueSpan.line && pos.character >= cmd.valueSpan.start) {
        md.appendMarkdown(await refPreview(this.model, doc.uri, def.ref, cmd.value));
      }
      return new vscode.Hover(md);
    }

    if (ctx.section === 'exec') {
      // DMAP / executive words anywhere on the line (module names, IF, TYPE, PARAM names ...)
      const dollar = doc.lineAt(pos.line).text.indexOf('$');
      const inComment = dollar >= 0 && pos.character > dollar;
      const wr = inComment ? undefined : doc.getWordRangeAtPosition(pos, /[A-Za-z][A-Za-z0-9_]*/);
      const word = wr ? doc.getText(wr).toUpperCase() : '';
      const isFirstWord = ctx.exec && wr && wr.start.character === ctx.exec.nameSpan.start;
      if (word && !isFirstWord && word !== 'SOL') {
        if (EXEC_STATEMENTS[word]) {
          md.appendMarkdown(`**${word}** — ${EXEC_STATEMENTS[word]}`);
          return new vscode.Hover(md, wr);
        }
        const p = PARAMS.get(word);
        if (p) {
          md.appendMarkdown(paramMarkdown(p));
          return new vscode.Hover(md, wr);
        }
      }
    }

    if (ctx.exec) {
      const st = ctx.exec;
      const desc = EXEC_STATEMENTS[st.name];
      if (st.name === 'SOL') {
        const key = st.args.split(/[\s,]/)[0]?.toUpperCase();
        const sol = SOLUTIONS[key] ?? Object.entries(SOLUTIONS).map(([n, s]) => ({ n, ...s })).find((s) => s.name === key);
        md.appendMarkdown(`**SOL** — ${desc}`);
        if (sol) {
          const num = 'n' in sol ? (sol as { n: string }).n : key;
          md.appendMarkdown(`\n\n**SOL ${num}** = ${sol.name}: ${sol.desc}`);
        }
        return new vscode.Hover(md);
      }
      if (desc) {
        md.appendMarkdown(`**${st.name}** (executive control) — ${desc}`);
        return new vscode.Hover(md, toRange(st.nameSpan));
      }
    }
    return undefined;
  }
}
