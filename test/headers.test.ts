/**
 * Folding by comment headers, as written by the Simcenter translator: boxed section titles,
 * card group titles, "Mesh Collector: / Mesh:" objects. Uses made-up decks.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { parseDeck, splitLines } from '../src/parser/deck';
import { computeFolds, findCommentHeaders } from '../src/parser/folding';

const sample = splitLines(fs.readFileSync(path.join(__dirname, '../../samples/simcenter.dat'), 'utf8'));
const lineOf = (lines: string[], text: string) => {
  const i = lines.findIndex((l) => l === text);
  assert.ok(i >= 0, `no line ${text}`);
  return i;
};

/** Folds starting on a header, as "level title: firstLine-lastLine" (lines as text). */
function headerTree(lines: string[]): string[] {
  const heads = new Map(findCommentHeaders(lines).map((h) => [h.line, h]));
  return computeFolds(parseDeck(lines), lines)
    .filter((f) => heads.has(f.start))
    .map((f) => `${heads.get(f.start)!.level} ${heads.get(f.start)!.title}: ${lines[f.end].trim() || '(blank)'}`);
}

test('Simcenter headers: levels and titles', () => {
  const heads = findCommentHeaders(sample).map((h) => `${h.level} ${h.title}${h.repeat ? ' (repeat)' : ''}`);
  assert.deepEqual(heads, [
    '1 Simcenter v2312.0.0.9140 Translator',
    '1 FILE MANAGEMENT',
    '1 EXECUTIVE CONTROL',
    '1 CASE CONTROL',
    '1 BULK DATA',
    '2 SOLUTION CARDS',
    '3 Modeling Object: Real Eigenvalue - Lanczos1',
    '2 PARAM CARDS',
    '2 GRID CARDS',
    '2 ELEMENT CARDS',
    '3 Mesh Collector: Thin Shell(1)',
    '4 Mesh: 2d_mesh(1)',
    '3 Mesh Collector: Thin Shell(1) (repeat)',
    '4 Mesh: 2d_mesh(2)',
    '3 Mesh Collector: Concentrated Mass Collector(1)',
    '4 Mesh: 0d_mesh(1)',
    '2 PROPERTY CARDS',
    '3 Property: PSHELL1::simcenter_fem1::[1]',
    '2 MATERIAL CARDS',
    '3 Material: Steel::simcenter_fem1::[1]',
  ]);
});

test('Simcenter headers: each fold runs to the title of the next header at its level', () => {
  const tree = headerTree(sample);
  // a fold ends on the line before the next title, so it takes in that header's box border / blank line
  assert.ok(tree.includes('1 EXECUTIVE CONTROL: $*'), tree.join('\n'));
  assert.ok(tree.includes('1 CASE CONTROL: $*'), tree.join('\n'));
  // BULK DATA and the last group run to the line before ENDDATA
  const lastCard = 'MAT1    1       210000.         .3      7.85-9';
  assert.ok(tree.includes(`1 BULK DATA: ${lastCard}`), tree.join('\n'));
  assert.ok(tree.includes(`2 MATERIAL CARDS: ${lastCard}`), tree.join('\n'));
  // the repeated collector does not start a fold: both meshes are inside the first one
  assert.ok(tree.includes('3 Mesh Collector: Thin Shell(1): CQUAD4  4       1       5       6       9       8'), tree.join('\n'));
  assert.ok(tree.includes('4 Mesh: 2d_mesh(1): $*  Mesh Collector: Thin Shell(1)'), tree.join('\n'));
  assert.ok(tree.includes('4 Mesh: 2d_mesh(2): CQUAD4  4       1       5       6       9       8'), tree.join('\n'));
});

test('Simcenter headers take priority over section, card run and comment block folds', () => {
  const folds = computeFolds(parseDeck(sample), sample);
  const cend = lineOf(sample, 'CEND');
  const begin = lineOf(sample, 'BEGIN BULK');
  // the CEND -> BEGIN BULK case control fold would cross the CASE CONTROL / BULK DATA header folds
  assert.ok(!folds.some((f) => f.start === cend), 'no case control fold from CEND');
  assert.ok(!folds.some((f) => f.start === begin), 'no bulk data fold from BEGIN BULK');
  // box borders and blank comment lines are not folded as comment blocks
  assert.ok(!folds.some((f) => f.kind === 'comment'), JSON.stringify(folds.filter((f) => f.kind === 'comment')));
  // folds nest
  const stack: { start: number; end: number }[] = [];
  for (const f of folds) {
    while (stack.length && stack[stack.length - 1].end < f.start) {
      stack.pop();
    }
    assert.ok(!stack.length || f.end <= stack[stack.length - 1].end, `fold ${f.start}-${f.end} crosses ${JSON.stringify(stack[stack.length - 1])}`);
    stack.push(f);
  }
  // with the option off, the deck folds as before
  const plain = computeFolds(parseDeck(sample), sample, { commentHeaders: false });
  assert.ok(plain.some((f) => f.start === cend && f.kind === 'region'));
});

test('over the folding limit, single-card folds go first and every header keeps its fold', () => {
  // a mesh with many 2-line large-field cards, as Simcenter writes them
  const lines = ['BEGIN BULK', '$*', '$* ELEMENT CARDS', '$*', '$*  Mesh Collector: Thin Shell(1)', '$*  Mesh: 2d_mesh(1)'];
  for (let i = 1; i <= 50; i++) {
    lines.push(`CQUAD4*${String(i).padStart(17)}               1               1               2+`, '*                      3               4');
  }
  lines.push('$*  Mesh Collector: Solid(1)', '$*  Mesh: 3d_mesh(1)', 'CTETRA  1       1       1       2       3       4', 'CTETRA  2       1       1       2       3       4', 'ENDDATA');
  const deck = parseDeck(lines);
  const all = computeFolds(deck, lines);
  assert.ok(all.length > 50);
  const limited = computeFolds(deck, lines, { maxFolds: 10 });
  assert.equal(limited.length, 10);
  const starts = new Set(limited.map((f) => lines[f.start]));
  for (const h of ['$* ELEMENT CARDS', '$*  Mesh Collector: Thin Shell(1)', '$*  Mesh: 2d_mesh(1)', '$*  Mesh Collector: Solid(1)', '$*  Mesh: 3d_mesh(1)']) {
    assert.ok(starts.has(h), `no fold for ${h}: ${[...starts].join(' | ')}`);
  }
  assert.deepEqual(computeFolds(deck, lines, { maxFolds: 1e6 }), all, 'under the limit nothing is dropped');
});

test('card runs end at a header: each mesh has its own run', () => {
  const lines = [
    'BEGIN BULK',
    '$*  Mesh Collector: Solid(1)',
    '$*  Mesh: 3d_mesh(1)',
    'CTETRA  1       1       1       2       3       4',
    'CTETRA  2       1       1       2       3       4',
    'CPENTA  3       1       1       2       3       4       5       6',
    'CPENTA  4       1       1       2       3       4       5       6',
    '$*  Mesh Collector: Solid(1)',
    '$*  Mesh: 3d_mesh(2)',
    'CPENTA  5       1       1       2       3       4       5       6',
    'CPENTA  6       1       1       2       3       4       5       6',
    'ENDDATA',
  ];
  const folds = computeFolds(parseDeck(lines), lines).map((f) => `${f.start}-${f.end}`);
  assert.ok(folds.includes('1-10'), `collector over both meshes: ${folds}`);
  assert.ok(folds.includes('2-7') && folds.includes('8-10'), `one fold per mesh: ${folds}`);
  assert.ok(folds.includes('3-4') && folds.includes('5-6'), `CTETRA and CPENTA runs in mesh 1: ${folds}`);
  assert.ok(!folds.some((f) => f.startsWith('5-') && f !== '5-6'), `the CPENTA run stops at mesh 2: ${folds}`);
});

test('not headers: prose with a colon, commented-out headers, separator lines, commented cards', () => {
  const lines = [
    '$*  Reuse the SET3 that the translator already created for the panel.',
    '$*  NOTE: SET3 for ERP must list structural elements only.',
    '$$*  Mesh Collector: Solid(1)',
    '$-------1-------2-------3-------4-------5',
    '$',
    '$ PARAM   POST    -1',
    '$',
    '$---------------------------------------',
    'GRID    1               0.      0.      0.',
    '$---------------------------------------',
  ];
  assert.deepEqual(findCommentHeaders(lines), []);
  // ... but a known Simcenter key after a hand-written comment still is one
  const known = ['$MASSES', '$*  Mesh Collector: Concentrated Mass Collector(1)', '$*  Mesh: 0d_mesh(1)', 'CONM2   1       1               .5'];
  assert.deepEqual(findCommentHeaders(known).map((h) => h.level), [3, 4]);
});

test('the design variable section ATA Attune appends is a card group level header', () => {
  const lines = splitLines(fs.readFileSync(path.join(__dirname, '../../samples/attune_sol200.dat'), 'utf8'));
  const title = '$ Design Variables Added by Attune (06-Nov-2026 11:48:45)';
  const heads = findCommentHeaders(lines);
  const att = heads.find((h) => lines[h.line] === title);
  assert.ok(att, heads.map((h) => h.title).join(' | '));
  assert.equal(att.level, 2);
  assert.equal(att.title, 'Design Variables Added by Attune (06-Nov-2026 11:48:45)');
  const tree = headerTree(lines);
  // MATERIAL CARDS ends before it; it runs to the line before ENDDATA
  assert.ok(tree.includes('3 Material: Steel::attune_fem1::[1]: MAT1    901     2.9+7           .29     7.33-4'), tree.join('\n'));
  assert.ok(tree.includes('2 Design Variables Added by Attune (06-Nov-2026 11:48:45): *                    902 2.9000000000e+7'), tree.join('\n'));
  // the Attune cards are known and parse in large field
  const deck = parseDeck(lines);
  const names = deck.cards.filter((c) => c.startLine > att.line && c.name !== 'ENDDATA').map((c) => `${c.name}:${c.format}`);
  assert.deepEqual(names, ['DESVAR:large', 'DESVAR:large', 'DVPREL1:large', 'DVMREL1:large']);
});

test('an underline that closes a comment paragraph: the header starts on the paragraph', () => {
  const lines = [
    'MAT1    1       2.9+7           .29',
    '$ --- appended by a script ---',
    '$ SOL 200 design variables (free field)',
    '$ Source deck: model.dat',
    '$------------------------------------------------------------------------',
    'DESVAR,1,THICK,1.0,0.5,2.0',
    'ENDDATA',
  ];
  assert.deepEqual(findCommentHeaders(lines).map((h) => [h.line, h.level, h.title]), [[1, 2, 'appended by a script']]);
  // a line of field names above a separator is not a header
  const fields = ['$       ID      CP      X1      X2      X3', '$----------------------------------------', 'GRID    1               0.      0.      0.'];
  assert.deepEqual(findCommentHeaders(fields), []);
});

test('boxed headers in other decks; a section delimiter without a box ends their fold', () => {
  const lines = [
    'SOL 101',
    'CEND',
    '$------------------------------',
    '$ Load cases',
    '$------------------------------',
    'SUBCASE 1',
    '  LOAD = 1',
    'BEGIN BULK',
    'GRID    1               0.      0.      0.',
    'ENDDATA',
  ];
  const heads = findCommentHeaders(lines);
  assert.deepEqual(heads.map((h) => [h.level, h.title]), [[1, 'Load cases']]);
  const folds = computeFolds(parseDeck(lines), lines);
  assert.ok(folds.some((f) => f.start === 3 && f.end === 6), `the header fold stops before BEGIN BULK: ${JSON.stringify(folds)}`);
  assert.ok(folds.some((f) => f.start === 7 && f.end === 9), 'the BEGIN BULK fold is kept');
});
