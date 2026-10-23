import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSheetRef, sheetRefString, itemsFromSheet, fetchSheetValues, pullSheet, SheetError, SHEETS_SCOPE } from '../js/sheets.js';
import { parseImport } from '../js/data.js';
import { Store, memoryAdapter } from '../js/store.js';
import { syncOnce, memoryCloud } from '../js/cloudsync.js';

const ID = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-xyz';

test('シートの URL / ID を読む（タブの gid も）', () => {
  assert.deepEqual(parseSheetRef(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing#gid=42`), { id: ID, gid: '42' });
  assert.deepEqual(parseSheetRef(`https://docs.google.com/spreadsheets/d/${ID}/edit`), { id: ID, gid: null });
  assert.deepEqual(parseSheetRef(ID), { id: ID, gid: null });
  assert.deepEqual(parseSheetRef(ID + '#gid=7'), { id: ID, gid: '7' });
  assert.equal(parseSheetRef('hello'), null);
  assert.equal(parseSheetRef(''), null);
  assert.equal(sheetRefString({ id: ID, gid: '7' }), ID + '#gid=7');
  assert.match(SHEETS_SCOPE, /spreadsheets\.readonly$/);
});

test('シートの見出しは英語・日本語・説明つきでもよい。id がない行は日本語＋英語から決まった id', () => {
  const a = itemsFromSheet([['id', 'japanese', 'english', 'note', 'lesson', 'theme'], ['7', '駅はどちらですか？', 'Which way is the station?', '', 'Day 1', '道案内'], ['', 'お先にどうぞ。', 'After you.']]);
  assert.equal(a.items.length, 2);
  assert.equal(a.items[0].id, 'i7'); assert.equal(a.items[0].lesson, 'Day 1'); assert.equal(a.items[0].from, 'sheet');
  assert.equal(a.items[1].lesson, 'シート');
  const b = itemsFromSheet([['日本語（問題）', 'English phrase', 'メモ'], ['お先にどうぞ。', 'After you.', 'x']]);
  assert.equal(b.items[0].id, a.items[1].id); // 同じ文なら同じ id
  assert.equal(b.items[0].note, 'x');
  const c = itemsFromSheet([['英語', '日本語'], ['After you.', 'お先にどうぞ。']]);
  assert.equal(c.items[0].japanese, 'お先にどうぞ。');
  // ファイルから読みこんだものと同じ id（すでに練習した教材とつながる）
  assert.equal(parseImport('id,japanese,english\n7,駅はどちらですか？,Which way is the station?').items[0].id, 'i7');
  // 空の行・英語がない行はとばす
  const d = itemsFromSheet([['ja', 'en'], [], ['いいえ'], ['はい', 'Yes.']]);
  assert.equal(d.items.length, 1); assert.equal(d.skipped, 1);
});

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, opt) => {
    calls.push({ url, auth: opt?.headers?.Authorization });
    for (const [re, res] of routes) if (re.test(url)) return { ok: res.status === 200, status: res.status, statusText: '', json: async () => res.body };
    return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
  };
  f.calls = calls; return f;
}

test('Sheets API：値を読む（gid のタブ名を引く）・エラーの種類', async () => {
  const f = fakeFetch([
    [/\?fields=sheets/, { status: 200, body: { sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }, { properties: { sheetId: 5, title: "Ken's" } }] } }],
    [/values\//, { status: 200, body: { values: [['ja', 'en'], ['はい', 'Yes.']] } }],
  ]);
  const v = await fetchSheetValues('TOK', { id: ID, gid: '5' }, f);
  assert.deepEqual(v, [['ja', 'en'], ['はい', 'Yes.']]);
  assert.equal(f.calls[0].auth, 'Bearer TOK');
  assert.ok(f.calls[1].url.includes(encodeURIComponent("'Ken''s'!A:Z")));
  const err = async (status, body) => {
    try { await fetchSheetValues('T', { id: ID }, fakeFetch([[/values/, { status, body }]])); } catch (e) { assert.ok(e instanceof SheetError); return e.code; }
    return 'none';
  };
  assert.equal(await err(401, {}), 'auth');
  assert.equal(await err(403, { error: { message: 'Google Sheets API has not been used in project 1 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED' }] } }), 'disabled');
  assert.equal(await err(403, { error: { message: 'Request had insufficient authentication scopes.', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }), 'scope');
  assert.equal(await err(403, { error: { message: 'The caller does not have permission' } }), 'forbidden');
  assert.equal(await err(404, {}), 'notfound');
});

test('シートを読みこむ：新しい行・変わった行だけ。覚えぐあいは残る。消した行は、設定がオンのときだけ削除', async () => {
  const s = await new Store(memoryAdapter()).init();
  const sheet = (rows) => fakeFetch([[/values\//, { status: 200, body: { values: [['id', 'japanese', 'english'], ...rows] } }]]);
  const ref = { id: ID, gid: null };
  let r = await pullSheet(s, 'T', ref, { fetchImpl: sheet([['1', 'いち', 'One.'], ['2', 'に', 'Two.'], ['3', 'さん', 'Three.']]) });
  assert.deepEqual([r.added, r.updated, r.removed, r.rows], [3, 0, 0, 3]);
  await s.grade('i1', 'good', 100);
  r = await pullSheet(s, 'T', ref, { fetchImpl: sheet([['1', 'いち', 'One!'], ['2', 'に', 'Two.']]) }); // 1を変えて3を消した
  assert.deepEqual([r.added, r.updated, r.removed], [0, 1, 0]);
  assert.equal(s.card('i1').english, 'One!'); assert.equal(s.state('i1').reps, 1);
  assert.ok(s.card('i3')); // オフなら残る
  s.setSetting('sheetRemove', true);
  r = await pullSheet(s, 'T', ref, { fetchImpl: sheet([['1', 'いち', 'One!'], ['2', 'に', 'Two.']]) });
  assert.equal(r.removed, 1); assert.equal(s.card('i3'), null); assert.ok(s.data.deleted.i3);
  // 自分で足したフレーズ・ファイルから読んだだけのものは消さない
  const mine = s.saveCard({ japanese: 'じぶん', english: 'Mine.' });
  // 別のシート（1行も重ならない）を読んでも、全部は消さない
  r = await pullSheet(s, 'T', ref, { fetchImpl: sheet([['9', 'きゅう', 'Nine.']]) });
  assert.equal(r.removed, 0); assert.equal(r.removeSkipped, true); assert.ok(s.card('i1')); assert.ok(s.card(mine));
  assert.equal(s.data.sheetPull.rows, 1);
});

test('シートの設定（URL・削除するか）はクラウドで別の端末にとどく', async () => {
  const cloud = memoryCloud();
  const a = await new Store(memoryAdapter()).init(); a.data.cloud = { uid: 'u' };
  const b = await new Store(memoryAdapter()).init(); b.data.cloud = { uid: 'u' };
  await syncOnce(b, cloud);
  a.setSetting('sheetId', ID); a.setSetting('sheetRemove', true);
  await syncOnce(a, cloud); await syncOnce(b, cloud);
  assert.equal(b.settings.sheetId, ID); assert.equal(b.settings.sheetRemove, true);
});
