/**
 * Tests for the .f06 output scanner: letter-spaced headings, sections across pages,
 * solver messages, design cycles and folding. Uses made-up output in the .f06 layout.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { f06Folds, messagesAtLeast, parseF06, sectionAt, spacedTitle } from '../src/parser/f06';

const page = (n: number, subcase?: number) => [
  `1    TITLE                                                                 NOVEMBER  4, 2026  MSC Nastran  2/14/26   PAGE ${String(n).padStart(5)}`,
  ' ',
  subcase === undefined ? '0' : '0' + ' '.repeat(100) + `SUBCASE ${subcase}`,
];

test('letter-spaced headings', () => {
  assert.equal(spacedTitle('0        N A S T R A N    E X E C U T I V E    C O N T R O L    E C H O')?.title, 'NASTRAN EXECUTIVE CONTROL ECHO');
  assert.equal(spacedTitle('          CYCLES =  1.000000E+02         R E A L   E I G E N V E C T O R   N O .          3')?.title, 'REAL EIGENVECTOR NO. 3');
  assert.equal(spacedTitle('             E I G E N V A L U E  A N A L Y S I S   S U M M A R Y   (READ MODULE) ')?.title, 'EIGENVALUE ANALYSIS SUMMARY (READ MODULE)');
  assert.equal(spacedTitle('       S T R E S S E S   I N   Q U A D R I L A T E R A L   E L E M E N T S   ( Q U A D 4 )        OPTION = BILIN')?.title, 'STRESSES IN QUADRILATERAL ELEMENTS (QUAD4)');
  assert.equal(spacedTitle('                    *    D E S I G N    O P T I M I Z A T I O N    *')?.title, 'DESIGN OPTIMIZATION');
  assert.equal(spacedTitle(' * * * *  D B D I C T   P R I N T  * * * *      SUBDMAP = PRTSUM')?.title, 'DBDICT PRINT');
  // not headings
  assert.equal(spacedTitle('                                                  M O'), undefined);
  assert.equal(spacedTitle('                  5      SET 1 = 1 THRU 10'), undefined);
  assert.equal(spacedTitle('                              * *      M S C   N a s t r a n      * *'), undefined);
  assert.equal(spacedTitle('                184      $ S U B C A S E S'), undefined);
  assert.equal(spacedTitle('1                                        * * * END OF JOB * * *'), undefined);
});

test('a heading repeated on following pages is one section; subcase changes split it', () => {
  const lines = [
    '1',
    ...page(1),
    '0        C A S E    C O N T R O L    E C H O',
    '                  1      SUBCASE 1',
    ...page(2, 1),
    '                                             D I S P L A C E M E N T   V E C T O R',
    '      POINT ID.   TYPE          T1',
    '             1      G      1.0',
    ...page(3, 1),
    '                                             D I S P L A C E M E N T   V E C T O R',
    '             2      G      2.0',
    ...page(4, 2),
    '                                             D I S P L A C E M E N T   V E C T O R',
    '             1      G      3.0',
    ' ',
    '1                                        * * * END OF JOB * * *',
  ];
  const f = parseF06(lines);
  assert.deepEqual(
    f.sections.map((s) => [s.title, s.subcase, s.occurrences, s.firstPage, s.lastPage]),
    [
      ['CASE CONTROL ECHO', undefined, 1, 1, 1],
      ['DISPLACEMENT VECTOR', 1, 2, 2, 3],
      ['DISPLACEMENT VECTOR', 2, 1, 4, 4],
    ],
  );
  // a section ends before the page header of the next section's first page
  assert.equal(f.sections[0].endLine, lines.indexOf('                  1      SUBCASE 1'));
  assert.equal(f.sections[1].endLine, lines.indexOf('             2      G      2.0'));
  // ... and the last one before END OF JOB, without the trailing blank line
  assert.equal(f.sections[2].endLine, lines.indexOf('             1      G      3.0'));
  assert.equal(f.endOfJob, lines.length - 1);
  assert.equal(f.pages, 5);
  const mid = lines.indexOf('             1      G      1.0');
  assert.equal(sectionAt(f, mid)?.subcase, 1);
  assert.equal(sectionAt(f, 0), undefined);
});

test('FREQUENCY values printed above the heading are collected per section', () => {
  const lines = ['1'];
  for (const [i, fr] of ['1.000000E+01', '2.000000E+01', '3.000000E+01'].entries()) {
    lines.push(...page(10 + i, 1), `      FREQUENCY =  ${fr}`, '                    C O M P L E X   D I S P L A C E M E N T   V E C T O R', '             1      G      1.0');
  }
  const f = parseF06(lines);
  assert.equal(f.sections.length, 1);
  assert.deepEqual(f.sections[0].steps, { label: 'FREQUENCY', first: '1.000000E+01', last: '3.000000E+01', count: 3 });
});

test('messages: severity, number, module, text and the lines above them', () => {
  const lines = [
    '1',
    ...page(1),
    '0*** INVALID CHARACTER FOLLOWING INTEGER IN COLUMN   7',
    ' *** USER FATAL MESSAGE 300 (CRCARD)',
    '     THE MESSAGES ABOVE ARE FROM CRCARD.',
    '     $* CASE CONTROL',
    ' *** USER WARNING MESSAGE 2251 (IFS1P)',
    '     ONE OR MORE MAT1 ENTRIES HAVE UNREASONABLE OR INCONSISTENT VALUES OF E,G OR NU.',
    '     ID OF FIRST ONE = 2',
    '',
    ' ^^^ USER   WARNING MESSAGE 9055 (SEKRRS)',
    ' *** SYSTEM INFORMATION MESSAGE 4159 (DFMSA)',
    '     THE DECOMPOSITION OF KLL YIELDS A MAXIMUM MATRIX-TO-FACTOR-DIAGONAL RATIO OF 1.0E+01',
    ' *** USER FATAL MESSAGE 9056 (SUBDMAP MODEFSRS)',
    '     NO METHOD COMMAND WAS SPECIFIED IN THE CASE CONTROL SECTION.',
  ];
  const f = parseF06(lines);
  assert.deepEqual(
    f.messages.map((m) => [m.severity, m.number, m.module, m.header]),
    [
      ['fatal', 300, 'CRCARD', 'USER FATAL MESSAGE 300 (CRCARD)'],
      ['warning', 2251, 'IFS1P', 'USER WARNING MESSAGE 2251 (IFS1P)'],
      ['warning', 9055, 'SEKRRS', 'USER WARNING MESSAGE 9055 (SEKRRS)'],
      ['information', 4159, 'DFMSA', 'SYSTEM INFORMATION MESSAGE 4159 (DFMSA)'],
      ['fatal', 9056, 'SUBDMAP MODEFSRS', 'USER FATAL MESSAGE 9056 (SUBDMAP MODEFSRS)'],
    ],
  );
  const [fatal, warn] = f.messages;
  // the echoed "$*" input line is not part of the message
  assert.equal(fatal.text, 'THE MESSAGES ABOVE ARE FROM CRCARD.');
  assert.deepEqual(fatal.preceding, ['INVALID CHARACTER FOLLOWING INTEGER IN COLUMN   7']);
  assert.equal(warn.text, 'ONE OR MORE MAT1 ENTRIES HAVE UNREASONABLE OR INCONSISTENT VALUES OF E,G OR NU. ID OF FIRST ONE = 2');
  assert.equal(warn.endLine, warn.line + 2);
  assert.equal(messagesAtLeast(f, 'fatal').length, 2);
  assert.equal(messagesAtLeast(f, 'warning').length, 4);
  assert.equal(messagesAtLeast(f, 'information').length, 5);
});

test('SOL 200 design cycles group the analyses; the cycle history is outside them', () => {
  const lines = [
    '1',
    ...page(1),
    '                                        M O D E L   S U M M A R Y',
    '                                         CQUAD4                      4',
    ...page(2),
    '     STIFFNESS, MASS, DAMPING, AND LOAD GENERATION INITIATED.  DESIGN CYCLE NUMBER= 1',
    ...page(3, 1),
    '                                              R E A L   E I G E N V A L U E S',
    '        1         1        3.947842E+05',
    ...page(4),
    '     STIFFNESS, MASS, DAMPING, AND LOAD GENERATION INITIATED.  DESIGN CYCLE NUMBER= 2',
    ...page(5, 1),
    '                                              R E A L   E I G E N V A L U E S',
    '        1         1        3.990000E+05',
    ...page(6),
    '                                   S U M M A R Y   O F   D E S I G N    C Y C L E    H I S T O R Y',
    '             INITIAL                                      0.000000E+00',
  ];
  const f = parseF06(lines);
  assert.deepEqual(f.cycles.map((c) => c.cycle), [1, 2]);
  assert.deepEqual(
    f.sections.map((s) => [s.title, s.cycle]),
    [
      ['MODEL SUMMARY', undefined],
      ['REAL EIGENVALUES', 1],
      ['REAL EIGENVALUES', 2],
      ['SUMMARY OF DESIGN CYCLE HISTORY', undefined],
    ],
  );
  const [c1, c2] = f.cycles;
  assert.equal(c1.endLine, c2.line - 1 - 3, 'cycle 1 ends before the page header in front of cycle 2');
  assert.ok(c2.endLine < f.sections[3].line);
  // cycles are fold regions; every section fold is inside (or outside) a cycle fold, never across
  const folds = f06Folds(f);
  assert.equal(folds.filter((x) => x.kind === 'region').length, 2);
  for (const s of f.sections) {
    for (const c of f.cycles) {
      const inside = s.line >= c.line && s.endLine <= c.endLine;
      const outside = s.endLine < c.line || s.line > c.endLine;
      assert.ok(inside || outside, `${s.title} crosses cycle ${c.cycle}`);
    }
  }
});

test('the sample output file', () => {
  const text = fs.readFileSync(path.join(__dirname, '../../samples/modes.f06'), 'utf8');
  const f = parseF06(text);
  assert.deepEqual(
    f.sections.map((s) => s.title),
    [
      'NASTRAN EXECUTIVE CONTROL ECHO',
      'CASE CONTROL ECHO',
      'MODEL SUMMARY',
      'OUTPUT FROM GRID POINT WEIGHT GENERATOR',
      'REAL EIGENVALUES',
      'REAL EIGENVECTOR NO. 1',
      'REAL EIGENVECTOR NO. 2',
      'ANALYSIS SUMMARY TABLE',
    ],
  );
  assert.equal(f.sections[5].occurrences, 2);
  // the text before the first page folds: first text line to the line before the first page header
  const lines = text.split(/\r?\n/);
  assert.deepEqual(f.preamble, { line: 2, endLine: 3 });
  assert.match(lines[2], /Sample Nastran output file/);
  assert.ok(f06Folds(f).some((x) => x.start === 2 && x.end === 3));
  assert.deepEqual(f.messages.map((m) => m.severity), ['warning', 'information']);
  assert.ok(f.endOfJob > 0);
  // folds never partially overlap
  const stack: { start: number; end: number }[] = [];
  for (const fo of f06Folds(f)) {
    while (stack.length && stack[stack.length - 1].end < fo.start) {
      stack.pop();
    }
    assert.ok(!stack.length || fo.end <= stack[stack.length - 1].end, `fold ${fo.start}-${fo.end} crosses ${JSON.stringify(stack[stack.length - 1])}`);
    stack.push(fo);
  }
});
