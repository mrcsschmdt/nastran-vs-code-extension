/**
 * Writes a deck (INCLUDEs inlined) in small, large and free field so the
 * results can be cross-checked with pyNastran (see roundtrip_pynastran.py).
 *
 *   node out/test/roundtrip.js <input.bdf> <outDir>
 */
import * as fs from 'fs';
import * as path from 'path';
import { cardValues, parseDeck, splitLines } from '../src/parser/deck';
import { writeCard } from '../src/parser/writer';

function inline(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) {
    return [];
  }
  seen.add(file);
  const lines = splitLines(fs.readFileSync(file, 'latin1'));
  const deck = parseDeck(lines);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const inc = deck.includes.find((x) => x.startLine === i);
    if (inc) {
      out.push(...inline(path.resolve(path.dirname(file), inc.path), seen));
      i = inc.endLine;
      continue;
    }
    out.push(lines[i]);
  }
  return out;
}

const [input, outDir] = process.argv.slice(2);
const lines = inline(path.resolve(input));
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'original.bdf'), lines.join('\n') + '\n');
const deck = parseDeck(lines);
for (const fmt of ['small', 'large', 'free'] as const) {
  const out: string[] = [];
  let next = 0;
  for (const card of deck.cards) {
    out.push(...lines.slice(next, card.startLine).filter((l) => !l.trimStart().startsWith('$')));
    out.push(...writeCard(card.name, cardValues(card), fmt).lines);
    next = card.endLine + 1;
  }
  out.push(...lines.slice(next));
  fs.writeFileSync(path.join(outDir, `${fmt}.bdf`), out.join('\n') + '\n');
}
console.log(`wrote ${deck.cards.length} cards x 3 formats to ${outDir}`);
