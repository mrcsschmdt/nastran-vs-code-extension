import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { classify, fitValue, formatReal, parseNumber, withDecimalPoint } from '../src/parser/values';
import { cardValues, fieldAt, parseDeck } from '../src/parser/deck';
import { writeCard } from '../src/parser/writer';
import { CARDS, fieldDef } from '../src/data/cards';
import { REF_GROUPS } from '../src/data/refs';

// ---------------------------------------------------------------------------
// values

test('classify values', () => {
  assert.equal(classify(''), 'blank');
  assert.equal(classify('  '), 'blank');
  assert.equal(classify('12'), 'int');
  assert.equal(classify('-3'), 'int');
  assert.equal(classify('1.'), 'real');
  assert.equal(classify('.5'), 'real');
  assert.equal(classify('-.5'), 'real');
  assert.equal(classify('1.5-3'), 'real');
  assert.equal(classify('1.5+3'), 'real');
  assert.equal(classify('1.5E-3'), 'real');
  assert.equal(classify('1.D3'), 'real');
  assert.equal(classify('2.E11'), 'real', 'E without sign is valid');
  assert.equal(classify('2.E+11'), 'real', 'E with sign is valid');
  assert.equal(classify('2.+11'), 'real', 'shorthand is valid');
  assert.equal(classify('2+11'), 'badReal', 'shorthand still needs the decimal point');
  assert.equal(classify('1E5'), 'badReal');
  assert.equal(classify('7-3'), 'badReal');
  assert.equal(classify('THRU'), 'string');
  assert.equal(classify('1.2.3'), 'other');
});

test('withDecimalPoint writes an explicit, valid real', () => {
  assert.equal(withDecimalPoint('0'), '0.');
  assert.equal(withDecimalPoint('-12'), '-12.');
  assert.equal(withDecimalPoint('2E11'), '2.+11');
  assert.equal(withDecimalPoint('2e-5'), '2.-5');
  assert.equal(withDecimalPoint('1D5'), '1.D+5');
  assert.equal(withDecimalPoint('7-3'), '7.-3');
  for (const v of ['0', '2E11', '2e-5', '1D5', '7-3']) {
    assert.equal(classify(withDecimalPoint(v)), 'real', v);
    assert.equal(parseNumber(withDecimalPoint(v)), parseNumber(v.replace(/^(\d+)([+-]\d+)$/, '$1e$2')), v);
  }
});

test('parse Nastran numbers', () => {
  assert.equal(parseNumber('1.5-3'), 1.5e-3);
  assert.equal(parseNumber('-.5+2'), -50);
  assert.equal(parseNumber('1.D3'), 1000);
  assert.equal(parseNumber('2.'), 2);
  assert.equal(parseNumber('.25'), 0.25);
  assert.equal(parseNumber('3.E-2'), 0.03);
});

test('formatReal fits the width with best precision', () => {
  assert.equal(formatReal(0.1, 8), '.1');
  assert.equal(formatReal(0, 8), '0.');
  assert.equal(formatReal(1, 8), '1.');
  assert.equal(formatReal(-2.5, 8), '-2.5');
  assert.equal(formatReal(1e-10, 8), '1.-10');
  assert.equal(formatReal(0.123456789, 8), '.1234568');
  assert.equal(formatReal(-0.123456789, 8), '-.123457');
  assert.equal(formatReal(123456789, 8), '1.2346+8');
  assert.equal(formatReal(2.1e11, 8), '2.1+11');
  assert.equal(formatReal(7.85e-9, 8), '7.85-9');
  for (const v of [Math.PI, -Math.E * 1e7, 1 / 3, 6.02214076e23, -1.6e-19, 12345.6789]) {
    for (const w of [8, 16]) {
      const s = formatReal(v, w);
      assert.ok(s.length <= w, `${s} longer than ${w}`);
      assert.ok(s.includes('.'), `${s} must contain a decimal point`);
      assert.equal(classify(s), 'real');
      const rel = Math.abs(parseNumber(s) - v) / Math.abs(v);
      assert.ok(rel < (w === 8 ? 5e-4 : 1e-12), `${v} -> ${s} rel err ${rel}`);
    }
  }
});

test('formatter writes shorthand but keeps valid E forms that fit', () => {
  assert.equal(formatReal(2e11, 8), '2.+11');
  assert.equal(formatReal(-3.5e-7, 8), '-3.5-7');
  assert.equal(fitValue('2.E+11', 8).text, '2.E+11');
  assert.equal(fitValue('1.23456E+11', 8).text, '1.235+11');
});

test('fitValue keeps short values verbatim', () => {
  assert.deepEqual(fitValue('1.5', 8), { text: '1.5', rounded: false, overflow: false });
  assert.equal(fitValue('0.123456789', 8).text, '.1234568');
  assert.equal(fitValue('0.123456789', 8).rounded, true);
  assert.equal(fitValue('123456789', 8).overflow, true);
});

// ---------------------------------------------------------------------------
// parsing

const DECK = [
  'SOL 101',
  'CEND',
  'TITLE = test',
  'DISP(PLOT,SORT1) = ALL',
  'SET 5 = 1, 2,',
  '        3 THRU 9',
  'SUBCASE 1',
  '  LOAD = 10',
  '  SPC = 1',
  'SUBCASE 2',
  '  LOAD = 20',
  'BEGIN BULK',
  '$ a comment',
  'GRID    1               0.      1.5     -2.5',
  'GRID*   2                               1.23456789012           2.0',
  '*       3.0',
  'GRID,3,,1.,2.,3.',
  'CQUAD4  10      1       1       2       3       4       0.      .1',
  '$ inner comment',
  '+               1       .5      .5      .5      .5',
  "INCLUDE 'sub/dir/",
  "  file.bdf'",
  'CBAR,20,2,1,2,0.,0.,1.',
  ',,123',
  'ENDDATA',
  'garbage after enddata',
];

test('sections, subcases and case control', () => {
  const d = parseDeck(DECK);
  assert.deepEqual(
    d.sections.map((s) => [s.kind, s.startLine, s.endLine]),
    [['exec', 0, 1], ['case', 2, 11], ['bulk', 12, 24], ['end', 25, 25]],
  );
  assert.deepEqual(d.execStatements.map((e) => [e.name, e.args]), [['SOL', '101'], ['CEND', '']]);
  const disp = d.caseCommands.find((c) => c.name === 'DISP')!;
  assert.deepEqual(disp.describers.map((x) => x.text), ['PLOT', 'SORT1']);
  assert.equal(disp.value, 'ALL');
  const set = d.caseCommands.find((c) => c.name === 'SET')!;
  assert.equal(set.endLine, 5, 'SET continues over a trailing comma');
  assert.equal(parseInt(set.value, 10), 5);
  assert.deepEqual(d.subcases.map((s) => [s.id, s.line, s.endLine]), [[1, 6, 8], [2, 9, 10]]);
  assert.equal(d.caseCommands.find((c) => c.name === 'LOAD' && c.value === '20')!.subcase, 2);
});

test('small, large and free field cards with continuations', () => {
  const d = parseDeck(DECK);
  const names = d.cards.map((c) => c.name);
  assert.deepEqual(names, ['GRID', 'GRID', 'GRID', 'CQUAD4', 'CBAR', 'ENDDATA']);

  const [g1, g2, g3, quad, bar] = d.cards;
  assert.equal(g1.format, 'small');
  assert.deepEqual(cardValues(g1), ['1', '', '0.', '1.5', '-2.5']);

  assert.equal(g2.format, 'large');
  assert.deepEqual(cardValues(g2), ['2', '', '1.23456789012', '2.0', '3.0']);
  assert.equal(g2.endLine, 15);

  assert.equal(g3.format, 'free');
  assert.deepEqual(cardValues(g3), ['3', '', '1.', '2.', '3.']);

  assert.deepEqual(cardValues(quad), ['10', '1', '1', '2', '3', '4', '0.', '.1', '', '1', '.5', '.5', '.5', '.5']);
  assert.deepEqual(quad.innerComments, [18]);

  assert.deepEqual(cardValues(bar), ['20', '2', '1', '2', '0.', '0.', '1.', '', '', '123']);
});

test('INCLUDE spanning two lines', () => {
  const d = parseDeck(DECK);
  assert.equal(d.includes.length, 1);
  assert.equal(d.includes[0].path, 'sub/dir/file.bdf');
  assert.equal(d.includes[0].spans.length, 2);
  assert.equal(d.cardIndexAt(20), -1, 'INCLUDE ends the previous card');
});

test('files without CEND/BEGIN BULK are bulk data', () => {
  const d = parseDeck(['GRID,1,,0.,0.,0.', 'CROD,1,1,1,2']);
  assert.equal(d.sections.length, 1);
  assert.equal(d.sections[0].kind, 'bulk');
  assert.equal(d.cards.length, 2);
});

test('tabs expand to 8-column fields', () => {
  const d = parseDeck(['GRID\t1\t\t1.\t2.\t3.']);
  assert.deepEqual(cardValues(d.cards[0]), ['1', '', '1.', '2.', '3.']);
});

test('text beyond column 80 is flagged', () => {
  const line = 'GRID    1               0.      0.      0.' + ' '.repeat(38) + 'XX';
  const d = parseDeck([line]);
  assert.ok(d.cards[0].lines[0].overflow);
});

test('orphan continuation lines are recorded', () => {
  const d = parseDeck(['BEGIN BULK', '+       1       2']);
  assert.deepEqual(d.orphanContinuations, [1]);
});

test('fieldAt finds the field under the cursor', () => {
  const d = parseDeck(DECK);
  const quad = d.cards[3];
  const hit = fieldAt(quad, 17, 26); // column 27 -> field 4 (G1)
  assert.equal(hit?.kind, 'data');
  assert.equal(hit && hit.kind === 'data' ? hit.index : -1, 2);
  const hit2 = fieldAt(quad, 19, 17); // continuation line field 3 (TFLAG)
  assert.equal(hit2 && hit2.kind === 'data' ? hit2.index : -1, 9);
  const g2 = d.cards[1];
  const hit3 = fieldAt(g2, 14, 45); // large field slot 3 (X1)
  assert.equal(hit3 && hit3.kind === 'data' ? hit3.index : -1, 2);
  assert.equal(fieldAt(quad, 17, 2)?.kind, 'name');
});

// ---------------------------------------------------------------------------
// writing

test('writes small, large and free field', () => {
  const vals = ['10', '1', '1', '2', '3', '4', '0.', '.1', '', '1', '.5', '.5', '.5', '.5'];
  const small = writeCard('cquad4', vals, 'small');
  assert.deepEqual(small.lines, [
    'CQUAD4  10      1       1       2       3       4       0.      .1      +',
    '+               1       .5      .5      .5      .5',
  ]);
  const large = writeCard('CQUAD4', vals, 'large');
  assert.deepEqual(large.lines, [
    'CQUAD4* 10              1               1               2',
    '*       3               4               0.              .1',
    '*                       1               .5              .5',
    '*       .5              .5',
  ]);
  const free = writeCard('CQUAD4', vals, 'free');
  assert.deepEqual(free.lines, ['CQUAD4,10,1,1,2,3,4,0.,.1', '+,,1,.5,.5,.5,.5']);
  const right = writeCard('GRID', ['1', '', '1.', '2.', '3.'], 'small', { alignment: 'right', continuationMarker: '+', uppercase: true });
  assert.deepEqual(right.lines, ['GRID           1              1.      2.      3.']);
  // mixed (FEMAP style): numbers right, text left
  const mixed = (name: string, v: string[]) => writeCard(name, v, 'small', { alignment: 'mixed', continuationMarker: '+', uppercase: true }).lines;
  assert.deepEqual(mixed('PARAM', ['AUTOSPC', 'YES']), ['PARAM   AUTOSPC YES']);
  assert.deepEqual(mixed('PARAM', ['GRDPNT', '0']), ['PARAM   GRDPNT         0']);
  assert.deepEqual(mixed('PBUSH', ['4', 'K', '10.', '100.']), ['PBUSH          4K            10.    100.']);
  assert.deepEqual(mixed('ASET1', ['123', '1', 'THRU', '10']), ['ASET1        123       1THRU          10']);
});

test('round trip through every format preserves values', () => {
  const vals = ['2', '', '1.23456789012', '-2.5', '3.0', '', '123456', '', '7', '8.5'];
  for (const fmt of ['small', 'large', 'free'] as const) {
    const w = writeCard('GRID', vals, fmt);
    const d = parseDeck(w.lines);
    assert.equal(d.cards.length, 1, fmt);
    const back = cardValues(d.cards[0]);
    assert.equal(back.length, vals.length, `${fmt}: ${JSON.stringify(back)}`);
    back.forEach((v, i) => {
      if (classify(vals[i]) === 'real') {
        const tol = fmt === 'small' ? 1e-4 : 1e-12;
        assert.ok(Math.abs(parseNumber(v) - parseNumber(vals[i])) <= tol * Math.abs(parseNumber(vals[i])), `${fmt} ${v} vs ${vals[i]}`);
      } else {
        assert.equal(v, vals[i], `${fmt} field ${i}`);
      }
    });
  }
  assert.equal(writeCard('GRID', vals, 'small').rounded, 1);
  assert.equal(writeCard('GRID', vals, 'free').lines[0].startsWith('GRID*,'), true, 'free field switches to large to keep precision');
});

test('an empty continuation line is never fully blank', () => {
  const vals = ['1', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'X'];
  const w = writeCard('DUMMY', vals, 'small', { alignment: 'left', continuationMarker: '', uppercase: true });
  assert.equal(w.lines.length, 3);
  assert.equal(w.lines[1], '+');
});

test('long integers promote small field to large field', () => {
  const w = writeCard('GRID', ['123456789', '', '1.', '2.', '3.'], 'small');
  assert.equal(w.format, 'large');
});

// ---------------------------------------------------------------------------
// knowledge base

test('card database is consistent', () => {
  for (const def of CARDS.values()) {
    for (const f of def.fields) {
      if (f.ref) {
        assert.ok(REF_GROUPS[f.ref], `${def.name}.${f.name} -> unknown ref group ${f.ref}`);
      }
    }
    for (const f of def.repeat?.fields ?? []) {
      if (f.ref) {
        assert.ok(REF_GROUPS[f.ref], `${def.name}.${f.name} -> unknown ref group ${f.ref}`);
      }
    }
  }
  assert.equal(fieldDef(CARDS.get('PCOMP')!, 12)!.name, 'MID2');
  assert.equal(fieldDef(CARDS.get('PCOMP')!, 15)!.name, 'SOUT2');
  assert.equal(fieldDef(CARDS.get('MPC')!, 9)!.name, 'G3');
  assert.equal(fieldDef(CARDS.get('MPC')!, 12)!.name, 'G4');
  assert.equal(fieldDef(CARDS.get('LOAD')!, 4)!.name, 'S2');
  assert.equal(fieldDef(CARDS.get('CTRIA3')!, 9)!.name, 'TFLAG');
});

test('ASET and the other paired DOF-set cards are known', () => {
  for (const name of ['ASET', 'BSET', 'CSET', 'QSET', 'OMIT']) {
    const def = CARDS.get(name);
    assert.ok(def, `${name} missing`);
    assert.deepEqual(def.fields.map((f) => f.name), ['ID1', 'C1', 'ID2', 'C2', 'ID3', 'C3', 'ID4', 'C4']);
    assert.equal(def.fields[0].ref, 'grid');
    assert.equal(def.repeat, undefined, `${name} is a single-line entry`);
  }
  // ASET 16 2 23 3516 1 4 (MSC QRG example)
  const card = parseDeck(['BEGIN BULK', 'ASET    16      2       23      3516    1       4']).cards.find((c) => c.name === 'ASET')!;
  assert.ok(card);
  assert.equal(fieldDef(CARDS.get('ASET')!, 3)!.name, 'C2');
  assert.deepEqual(cardValues(card).slice(0, 6), ['16', '2', '23', '3516', '1', '4']);
});

// ---------------------------------------------------------------------------
// hover layout table HTML must survive VS Code's markdown sanitizer

test('highlight spans pass the VS Code hover sanitizer (1.85 and 1.144)', async () => {
  // regexes copied from VS Code's markdownRenderer (span style attribute)
  const v185 = /^(color\:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z]+)+\));)?(background-color\:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z]+)+\));)?$/;
  const v1144 = /^(color\:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(background-color\:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(display\:inline-block;)?(border-radius:[0-9]+px;)?$/;
  // util.ts imports vscode only for types/helpers; load the table builder through a stub
  const Module = require('module');
  const orig = Module._load;
  Module._load = (req: string, ...rest: unknown[]) => (req === 'vscode' ? {} : orig(req, ...rest));
  try {
    const { layoutTable } = require('../src/util');
    const def = CARDS.get('RBE2')!;
    const md: string = layoutTable(def, 4, undefined, true);
    const styles = [...md.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
    assert.equal(styles.length, 2, md);
    for (const s of styles) {
      assert.match(s, v185, `1.85 would strip: ${s}`);
      assert.match(s, v1144, `1.144 would strip: ${s}`);
    }
    assert.match(md, /\*\*GM2\*\*/);
    assert.match(md, /\| 1 \| 2 \| 3 \| 4 \| 5 \| <span[^>]*>6<\/span> \| 7 \|/, 'column number 6 is colored');
    assert.doesNotMatch(layoutTable(def, 4), /<span/, 'no HTML unless requested');
  } finally {
    Module._load = orig;
  }
});

// ---------------------------------------------------------------------------
// folding

test('folding: sections, file management, case blocks, card runs and regions', async () => {
  const { computeFolds } = await import('../src/parser/folding');
  const src = [
    /* 0 */ '$ header',
    /* 1 */ 'NASTRAN BUFFSIZE=65537',
    /* 2 */ "ASSIGN OUTPUT2='model.op2',",
    /* 3 */ '  UNIT=12',
    /* 4 */ 'ID MYJOB',
    /* 5 */ 'SOL 101',
    /* 6 */ "ALTER 'SUPER1'",
    /* 7 */ 'MATPRN KGG//',
    /* 8 */ 'ENDALTER',
    /* 9 */ 'CEND',
    /* 10 */ 'TITLE = demo',
    /* 11 */ 'SUBCASE 1',
    /* 12 */ '  SET 5 = 1,2,3,',
    /* 13 */ '     4,5,6',
    /* 14 */ '  DISP = 5',
    /* 15 */ 'OUTPUT(XYPLOT)',
    /* 16 */ 'XYPLOT DISP / 1(T1)',
    /* 17 */ 'BEGIN BULK',
    /* 18 */ 'PARAM,POST,-1',
    /* 19 */ 'PARAM,AUTOSPC,YES',
    /* 20 */ '$',
    /* 21 */ '$ Nodes',
    /* 22 */ 'GRID    1               0.      0.      0.',
    /* 23 */ 'GRID    2               1.      0.      0.',
    /* 24 */ 'CORD2R  1               0.      0.      0.      0.      0.      1.',
    /* 25 */ '+       1.      0.      0.',
    /* 26 */ 'CQUAD4  1       1       1       2       3       4',
    /* 27 */ 'CQUAD4  2       1       1       2       3       4',
    /* 28 */ 'CTRIA3  3       1       1       2       3',
    /* 29 */ 'CTRIA3  4       1       1       2       3',
    /* 30 */ '$ #region Materials',
    /* 31 */ 'MAT1    1       2.1+11          .3      7850.',
    /* 32 */ 'MAT1    2       7.0+10          .33     2700.',
    /* 33 */ '$ #endregion',
    /* 34 */ 'ENDDATA',
  ];
  const folds = computeFolds(parseDeck(src), src).map((f) => `${f.start}-${f.end}${f.kind ? ' ' + f.kind : ''}`);
  assert.deepEqual(folds, [
    '1-3 region', // file management (ASSIGN continues on line 3)
    '4-8 region', // executive control up to CEND
    '6-8', // ALTER package
    '9-16 region', // case control, starting on CEND
    '11-16', // subcase
    '12-13', // multi-line SET
    '15-16', // OUTPUT(XYPLOT)
    '17-34 region', // bulk data, starting on BEGIN BULK
    '18-19', // parameters
    '21-25', // geometry run titled by the "$ Nodes" comment
    '22-23', // GRID run
    '24-25', // multi-line CORD2R
    '26-27', // CQUAD4 run (wins over the "Elements" category fold that would start on the same line)
    '28-29', // CTRIA3 run
    '30-33 region', // user region
    '31-32', // MAT1 run
  ]);
});

test('folding: include files, BEGIN SUPER parts and the cardGroups option', async () => {
  const { computeFolds } = await import('../src/parser/folding');
  const inc = ['$ Shell elements', 'CQUAD4  1       1       1       2       3       4', 'CQUAD4  2       1       1       2       3       4'];
  assert.deepEqual(computeFolds(parseDeck(inc), inc), [{ start: 0, end: 2, kind: undefined }], 'no whole-file fold, header at line 0 is the title');
  assert.deepEqual(computeFolds(parseDeck(inc), inc, { cardGroups: false }), []);

  const sup = ['SOL 101', 'CEND', 'BEGIN BULK', 'GRID    1', 'BEGIN SUPER=1', 'GRID    2', 'GRID    3', 'ENDDATA'];
  const folds = computeFolds(parseDeck(sup), sup).map((f) => `${f.start}-${f.end}`);
  assert.ok(folds.includes('2-7'), folds.join());
  assert.ok(folds.includes('4-6'), `BEGIN SUPER part: ${folds.join()}`);
  assert.ok(folds.includes('5-6'), `GRID run inside the part: ${folds.join()}`);
  assert.ok(!folds.includes('3-6'), 'card runs do not cross BEGIN SUPER');
});
