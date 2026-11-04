/**
 * Tests for card variants, results punch / DMAP / case control include
 * detection, and loading of private definition files. Uses only generic,
 * made-up definitions.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cardValues, guessSection, parseDeck } from '../src/parser/deck';
import { CARDS, defForCard, fieldDef } from '../src/data/cards';
import { CASE_COMMANDS, EXEC_STATEMENTS, PARAMS, includeNotesFor } from '../src/data/control';
import { REF_GROUPS } from '../src/data/refs';

// custom.ts imports vscode; load it with a stub (only types/paths are used by applyDefinitions)
function loadCustom(): typeof import('../src/custom') {
  const Module = require('module');
  const orig = Module._load;
  Module._load = (req: string, ...rest: unknown[]) => (req === 'vscode' ? {} : orig(req, ...rest));
  try {
    return require('../src/custom');
  } finally {
    Module._load = orig;
  }
}

test('DMIG header and column entries use different layouts', () => {
  const d = parseDeck([
    'DMIG    KAA            0       6       2       0                       2',
    'DMIG*   KAA                           3               1',
    '*                      3               1 2.612759556D+03',
  ]);
  assert.equal(d.cards.length, 2);
  const header = defForCard(d.cards[0])!;
  const column = defForCard(d.cards[1])!;
  assert.equal(fieldDef(header, 2)!.name, 'IFO');
  assert.equal(fieldDef(header, 7)!.name, 'NCOL');
  assert.equal(fieldDef(column, 1)!.name, 'GJ');
  assert.deepEqual(cardValues(d.cards[1]), ['KAA', '3', '1', '', '3', '1', '2.612759556D+03']);
  assert.equal(fieldDef(column, 4)!.name, 'G1');
  assert.equal(fieldDef(column, 6)!.name, 'A1');
  assert.equal(fieldDef(column, 8)!.name, 'G2');
});

test('results punch records are not parsed as cards', () => {
  const d = parseDeck([
    '$TITLE   =                                                                     1',
    '$EIGENVECTOR                                                                   4',
    '$SUBCASE ID =           1                                                      6',
    '         3       G     -2.908452E+00     -1.409742E-01      2.111194E-01       8',
    '-CONT-                  2.350126E-05      3.581390E-02      2.713896E-02       9',
    '      7623       G      6.812721E-01     -9.860898E-05      3.394378E-04      10',
    '-CONT-                  1.0               2.0               3.0               11',
    'DMIG    PHI            0       9       2       0                       1',
  ]);
  assert.equal(d.punchRecords, 4);
  assert.equal(d.orphanContinuations.length, 0);
  assert.deepEqual(d.cards.map((c) => c.name), ['DMIG']);
});

test('INCLUDE files are classified by their first statement', () => {
  assert.equal(guessSection(['$ alter', 'COMPILE SEMODES', 'ALTER \'x\'']), 'exec');
  assert.equal(guessSection(['$ c', 'TYPE PARM,,I,Y,NAME=0 $']), 'exec');
  assert.equal(guessSection(['SET 100 = 3,', '4,', '7']), 'case');
  assert.equal(guessSection(['DISP(PLOT,SORT1) = ALL']), 'case');
  assert.equal(guessSection(['GRID,1,,0.,0.,0.']), 'bulk');
  assert.equal(guessSection(['ASET    25      2']), 'bulk');
  const set = parseDeck(['SET 100 = 3,', '4,', '7']);
  assert.equal(set.cards.length, 0);
  assert.equal(set.caseCommands.length, 1);
  const dmap = parseDeck(['$ header', 'COMPILE SEMODES', 'TYPE PARM,,I,Y,MYPARM=0 $', 'MPYAD A,B,/C $']);
  assert.equal(dmap.cards.length, 0);
  assert.equal(dmap.execStatements.length, 3);
});

test('private definition files add and reset knowledge', () => {
  const { applyDefinitions } = loadCustom();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nastran-defs-'));
  const file = path.join(dir, 'acme.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      name: 'ACME test',
      cards: [
        { name: 'XCARD', group: 'ACME', desc: 'Test card', idSpace: 'element', fields: [['EID', 'I!', 'id'], ['G1', 'I', 'grid', 'grid'], { name: 'X', type: 'R' }] },
        { name: 'BAD', fields: [['A', 'Q', 'bad type']] },
      ],
      params: [{ name: 'myparm', desc: 'A private parameter', default: '1' }],
      caseCommands: [{ name: 'XOUT', desc: 'Private output request', output: true }],
      statements: { MYSUB: 'A private subDMAP' },
      includes: [{ pattern: 'my_alter.*', desc: 'A private alter' }],
      refGroups: { acme: ['XCARD'] },
    }),
  );
  const res = applyDefinitions([dir, path.join(dir, 'missing.json')]);
  assert.equal(res.files.length, 1);
  assert.equal(res.counts.cards, 2);
  assert.equal(res.errors.length, 1, 'unknown type is reported');
  assert.equal(CARDS.get('XCARD')!.source, 'ACME test');
  assert.equal(fieldDef(CARDS.get('XCARD')!, 0)!.required, true);
  assert.ok(REF_GROUPS.elem.includes('XCARD'), 'idSpace element joins the elem group');
  assert.deepEqual(REF_GROUPS.acme, ['XCARD']);
  assert.equal(PARAMS.get('MYPARM')!.source, 'ACME test');
  assert.ok(CASE_COMMANDS.has('XOUT'));
  assert.match(EXEC_STATEMENTS.MYSUB, /private subDMAP/);
  assert.equal(includeNotesFor('c:\\alters\\my_alter.nx12').length, 1);
  assert.ok(CARDS.has('GRID'), 'built-in cards are kept');

  // reloading without the file restores the built-in state
  applyDefinitions([]);
  assert.equal(CARDS.has('XCARD'), false);
  assert.equal(PARAMS.has('MYPARM'), false);
  assert.equal(EXEC_STATEMENTS.MYSUB, undefined);
  assert.equal(includeNotesFor('my_alter.nx12').length, 0);
  assert.equal(REF_GROUPS.acme, undefined);
  assert.equal(REF_GROUPS.elem.includes('XCARD'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});
