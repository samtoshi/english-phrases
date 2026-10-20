import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, memoryAdapter } from '../js/store.js';
import { syncOnce, memoryCloud } from '../js/cloudsync.js';
import { mergeStates, mergeCards, mergeMeta, bucketOf, toBuckets, stableJSON } from '../js/merge.js';
import { parseImport } from '../js/data.js';

const dev = async () => new Store(memoryAdapter()).init();
const items = parseImport(JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ id: i + 1, lesson: 'Lesson ' + (1 + (i % 4)), japanese: 'に' + i, english: 'E' + i })))).items;

test('merge：新しい方を残す（覚えぐあい・フレーズ・削除の印）', () => {
  const m = mergeStates({ a: { ts: 2 }, b: { ts: 1 } }, { b: { ts: 3 }, c: { ts: 1 } });
  assert.deepEqual(m.pulled.sort(), ['b', 'c']); assert.deepEqual(m.push, ['a']);
  const c = mergeCards({ x: { id: 'x', ts: 1 }, y: { id: 'y', ts: 5 } }, { z: 4 }, { x: { del: 1, ts: 2 }, y: { id: 'y', ts: 3, english: 'old' }, z: { id: 'z', ts: 3 } });
  assert.deepEqual(Object.keys(c.cards), ['y']); assert.equal(c.cards.y.english, undefined);
  assert.deepEqual(c.deleted, { x: 2, z: 4 });
  assert.deepEqual(c.merged.z, { del: 1, ts: 4 });
  const b = toBuckets({ a: 1, b: 2, c: 3 }); assert.equal(Object.keys(b).length, 8); assert.equal(b[bucketOf('a')].a, 1);
  assert.equal(stableJSON({ b: 1, a: [1, { d: 2, c: 1 }] }), stableJSON({ a: [1, { c: 1, d: 2 }], b: 1 }));
});

test('mergeMeta：日付はあわせる・数は大きい方・リセットは新しい方', () => {
  const r = mergeMeta({ days: [1, 2], newDays: { 1: 3 }, reps: { a: 1 }, resetAt: 0, settings: { newPerDay: 10, useMic: false }, settingsTs: 1 },
    { days: [2, 3], newDays: { 1: 5, 3: 1 }, reps: { a: 2, b: 1 }, resetAt: 0, settings: { newPerDay: 20, useMic: true }, settingsTs: 5 });
  assert.deepEqual(r.days, [1, 2, 3]); assert.deepEqual(r.newDays, { 1: 5, 3: 1 }); assert.deepEqual(r.reps, { a: 2, b: 1 });
  assert.equal(r.settings.newPerDay, 20); assert.equal(r.settings.useMic, false); // マイクは端末ごと
  const z = mergeMeta({ days: [1, 2], newDays: { 1: 3 }, reps: { a: 1 }, resetAt: 0 }, { days: [9], reps: {}, resetAt: 100 });
  assert.deepEqual(z.days, [9]); assert.deepEqual(z.reps, {}); assert.equal(z.resetAt, 100);
  const k = mergeMeta({ days: [10], resetAt: 200 }, { days: [1, 9], resetAt: 100 });
  assert.deepEqual(k.days, [10]); // こちらのリセットの方が新しい → 前の日付はもどさない
});

test('2台の端末：A でインポート・勉強 → B にとどく。B で編集・削除・勉強 → A にとどく', async () => {
  const cloud = memoryCloud();
  const A = await dev(); const B = await dev();
  A.addItems(items); await A.grade('i1', 'good', 100); await A.repeatDone('i1'); A.setSetting('newPerDay', 5);
  let r = await syncOnce(A, cloud);
  assert.ok(r.pushedBuckets >= 1); assert.equal(r.pushedStates, 1);
  // 教材のフレーズは、クラウドの cards/b* にだけ入る
  assert.equal(Object.values(cloud.db.buckets).reduce((n, b) => n + Object.keys(b).length, 0), 48);
  r = await syncOnce(B, cloud);
  assert.equal(r.pulledCards, 40); assert.equal(B.cards.length, 48); assert.equal(B.state('i1').reps, 1);
  assert.equal(B.data.reps.i1, 1); assert.equal(B.settings.newPerDay, 5); assert.deepEqual(B.data.days, [100]);
  // もう一度同期しても何も送らない
  r = await syncOnce(B, cloud); assert.equal(r.pushedBuckets, 0); assert.equal(r.pushedStates, 0);

  await new Promise((res) => setTimeout(res, 5));
  const mine = B.saveCard({ japanese: '了解', english: 'Got it.' });
  B.saveCard({ id: 'i2', japanese: 'に1', english: 'E1 edited' });
  await B.deleteCard('i3'); await B.deleteSource('sample');
  await B.grade('i2', 'again', 101);
  r = await syncOnce(B, cloud, { full: false }); // フレーズを変えたので full でなくても送る
  assert.ok(r.pushedBuckets >= 1); assert.equal(B.data.cardsDirty, false);
  r = await syncOnce(A, cloud);
  assert.equal(A.card(mine).english, 'Got it.'); assert.equal(A.card('i2').english, 'E1 edited');
  assert.equal(A.card('i3'), null); assert.ok(A.cards.every((c) => c.src !== 'sample'));
  assert.equal(A.lastGrades.i2, 'again'); assert.deepEqual(A.data.days, [100, 101]);
});

test('オフラインで両方が勉強しても、フレーズごとに新しい方が残る', async () => {
  const cloud = memoryCloud();
  const A = await dev(); const B = await dev();
  A.addItems(items); await syncOnce(A, cloud); await syncOnce(B, cloud);
  await A.grade('i5', 'good', 100, 1000); await B.grade('i5', 'again', 100, 2000); await B.grade('i6', 'easy', 100, 1500);
  await syncOnce(A, cloud); await syncOnce(B, cloud); await syncOnce(A, cloud);
  for (const S of [A, B]) { assert.equal(S.lastGrades.i5, 'again'); assert.equal(S.lastGrades.i6, 'easy'); }
});

test('記録のリセットはほかの端末にも伝わる・バックアップから戻したものも送られる', async () => {
  const cloud = memoryCloud();
  const A = await dev(); const B = await dev();
  A.addItems(items); await A.grade('i1', 'good', 100); await syncOnce(A, cloud); await syncOnce(B, cloud);
  assert.ok(B.state('i1'));
  await B.resetProgress(); await syncOnce(B, cloud); await syncOnce(A, cloud);
  assert.equal(A.state('i1'), null); assert.deepEqual(A.data.days, []);
  const backup = JSON.parse(JSON.stringify(A.exportBackup()));
  const C = await dev(); C.data.cloud = { uid: 'u' };
  await C.restoreBackup(backup); assert.equal(C.data.cloud.uid, 'u'); assert.equal(C.data.cardsDirty, true);
});
