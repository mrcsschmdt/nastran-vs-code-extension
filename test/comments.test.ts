import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { commentBreak, commentBreaks, commentPrefix, wrapCommentLine } from '../src/parser/comments';

/** Apply break ranges (original coordinates) from right to left. */
function applyBreaks(line: string, breaks: { start: number; end: number; prefix: string }[]): string[] {
  let s = line;
  for (const b of [...breaks].reverse()) {
    s = s.slice(0, b.start) + '\n' + b.prefix + s.slice(b.end);
  }
  return s.split('\n');
}

test('commentBreaks gives all breaks of a long line in one go', () => {
  const samples = [
    '$ ' + Array.from({ length: 80 }, (_, i) => `w${i}`).join(' '),
    '   $$ ' + Array.from({ length: 40 }, (_, i) => `word${i}`).join('  '),
    '$' + Array.from({ length: 50 }, (_, i) => `x${i}y`).join(' '),
    '$ short line',
  ];
  for (const line of samples) {
    for (const col of [40, 72, 80]) {
      assert.deepEqual(applyBreaks(line, commentBreaks(line, col)), wrapCommentLine(line, col), `${col}: ${line.slice(0, 30)}`);
    }
  }
  assert.ok(commentBreaks(samples[0], 80).length >= 3);
});

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

test('commentPrefix keeps indentation and $ signs', () => {
  assert.equal(commentPrefix('$ text'), '$ ');
  assert.equal(commentPrefix('  $$  text'), '  $$  ');
  assert.equal(commentPrefix('$text'), '$');
  assert.equal(commentPrefix('GRID    1 $ inline'), undefined);
});

test('no break for short lines, non-comments and unbreakable lines', () => {
  assert.equal(commentBreak('$ short', 80), undefined);
  assert.equal(commentBreak('GRID    1       ' + 'x '.repeat(50), 80), undefined);
  assert.equal(commentBreak('$' + '-'.repeat(100), 80), undefined);
  assert.equal(commentBreak('$ ' + 'x'.repeat(100), 80), undefined, 'one long word after the prefix');
  assert.equal(commentBreak('$ text' + ' '.repeat(90), 80), undefined, 'only trailing blanks');
});

test('break moves the last word to a new comment line', () => {
  const line = '$ ' + words(14); // > 80 chars
  assert.ok(line.length > 80);
  const b = commentBreak(line, 80)!;
  assert.ok(b);
  assert.ok(b.start <= 80);
  assert.equal(b.prefix, '$ ');
  const first = line.slice(0, b.start);
  const second = b.prefix + line.slice(b.end);
  assert.ok(first.length <= 80);
  assert.equal(first + ' ' + second.slice(2), line, 'no text is lost');
});

test('prefix without a blank gets one on continuation lines', () => {
  const line = '$' + words(14);
  const b = commentBreak(line, 80)!;
  assert.equal(b.prefix, '$ ');
  const b2 = commentBreak('   $$ ' + words(14), 80)!;
  assert.equal(b2.prefix, '   $$ ');
});

test('wrapCommentLine splits long comments into lines of at most the column', () => {
  const line = '$ ' + words(60);
  const out = wrapCommentLine(line, 80);
  assert.ok(out.length >= 5);
  for (const l of out) {
    assert.ok(l.length <= 80, `${l.length}: ${l}`);
    assert.ok(l.startsWith('$ '));
  }
  assert.equal(out.map((l) => l.slice(2)).join(' '), line.slice(2));
  assert.deepEqual(wrapCommentLine('$ short', 80), ['$ short']);
});
