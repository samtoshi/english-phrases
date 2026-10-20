import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, itemsFromCSV, parseImport, splitNote, SAMPLE_PHRASES, lessonKey } from '../js/data.js';

test('CSV：引用符・カンマ・改行・BOM', () => {
  const rows = parseCSV('\uFEFFjapanese,english\r\n"こんにちは、元気？","Hi, how are you?"\n"改行\nあり","He said ""yes""."\n');
  assert.deepEqual(rows, [['japanese', 'english'], ['こんにちは、元気？', 'Hi, how are you?'], ['改行\nあり', 'He said "yes".']]);
});

test('CSV：見出しは 日本語/英語 でも、なくてもよい（逆の列も判定）', () => {
  assert.deepEqual(itemsFromCSV('日本語,英語,メモ\n両方持っていけば？,Why not take both?,[旅行の準備で]').map((x) => [x.japanese, x.english, x.note]), [['両方持っていけば？', 'Why not take both?', '[旅行の準備で]']]);
  assert.deepEqual(itemsFromCSV('おはよう,Good morning.\nありがとう,Thanks.').map((x) => x.english), ['Good morning.', 'Thanks.']);
  assert.deepEqual(itemsFromCSV('Good morning.,おはよう').map((x) => x.japanese), ['おはよう']);
  assert.deepEqual(itemsFromCSV('ja\ten\nはい\tYes.').map((x) => x.english), ['Yes.']);
});

test('JSON：items.json の形（id, lesson, theme, step, japanese, english, note）を読む', () => {
  const src = JSON.stringify([
    { id: 1, lesson: 'Lesson 1', theme: 'テーマ', step: 'Step 1', japanese: 'あ', english: 'A.', note: '' },
    { id: 2, lesson: 'Lesson 1', theme: 'テーマ', step: 'Step 1', japanese: '', english: 'B.' }, // 日本語なし → スキップ
    { id: 1, japanese: '重複', english: 'Dup.' },                                             // 同じ id → スキップ
    { japanese: 'い', english: 'I.' },
  ]);
  const r = parseImport(src, 'items.json');
  assert.equal(r.kind, 'items'); assert.equal(r.items.length, 2); assert.equal(r.skipped, 2);
  assert.equal(r.items[0].id, 'i1'); assert.equal(r.items[0].lesson, 'Lesson 1'); assert.equal(r.items[0].src, 'import');
  assert.match(r.items[1].id, /^i[0-9a-z]+$/); assert.equal(r.items[1].lesson, 'インポート');
  // 同じ文なら同じ id（何度読みこんでも重ならない）
  assert.equal(parseImport(src).items[1].id, r.items[1].id);
  assert.equal(parseImport(JSON.stringify({ items: [{ ja: 'う', en: 'U.' }] })).items.length, 1);
});

test('バックアップのファイルは backup として返す・おかしなファイルはエラー', () => {
  assert.equal(parseImport(JSON.stringify({ app: 'english-phrases', type: 'backup', v: 1, data: {} })).kind, 'backup');
  assert.throws(() => parseImport(''), /空/);
  assert.throws(() => parseImport('{bad json'), /JSON/);
  assert.throws(() => parseImport('a\nb'), /見つかりません/);
});

test('メモ：[ ] は場面のヒント、それ以外は解説', () => {
  assert.deepEqual(splitNote('[荷物を選んでいる人に]'), { hint: '荷物を選んでいる人に', memo: '' });
  assert.deepEqual(splitNote('[会議で] 丁寧な言い方'), { hint: '会議で', memo: '丁寧な言い方' });
  assert.deepEqual(splitNote('発音に注意'), { hint: '', memo: '発音に注意' });
});

test('サンプルはアプリのオリジナル（5〜10問）・レッスンの並び', () => {
  assert.ok(SAMPLE_PHRASES.length >= 5 && SAMPLE_PHRASES.length <= 10);
  assert.ok(SAMPLE_PHRASES.every((p) => p.src === 'sample' && p.japanese && p.english));
  assert.deepEqual(['Lesson 10', 'Lesson 2', 'Bonus 1'].sort((a, b) => lessonKey(a) - lessonKey(b)), ['Bonus 1', 'Lesson 2', 'Lesson 10']);
});
