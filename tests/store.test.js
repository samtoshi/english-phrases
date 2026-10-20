import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, memoryAdapter } from '../js/store.js';
import { parseImport } from '../js/data.js';

test('はじめはサンプルだけ・インポートするとファイルの順で前に並ぶ・覚えぐあいは上書きで消えない', async () => {
  const ad = memoryAdapter(); const s = await new Store(ad).init();
  assert.ok(s.cards.length >= 5 && s.cards.every((c) => c.src === 'sample'));
  assert.equal(s.hasImported(), false);
  const { items } = parseImport(JSON.stringify([{ id: 2, lesson: 'Lesson 2', japanese: 'に', english: 'Two.' }, { id: 1, lesson: 'Lesson 1', japanese: 'いち', english: 'One.' }]));
  assert.deepEqual(s.addItems(items), { added: 2, updated: 0 });
  assert.deepEqual(s.cards.slice(0, 2).map((c) => c.id), ['i2', 'i1']); // ファイルの順
  await s.grade('i1', 'good', 100);
  assert.deepEqual(s.addItems(items), { added: 0, updated: 0 }); // 同じ内容なら何もしない
  assert.deepEqual(s.addItems([{ ...items[1], english: 'One!' }]), { added: 0, updated: 1 });
  assert.equal(s.card('i1').english, 'One!');
  assert.equal(s.state('i1').reps, 1);
  // 保存したものを読みなおしても同じ
  const s2 = await new Store(ad).init();
  assert.equal(s2.state('i1').reps, 1); assert.equal(s2.cards.length, s.cards.length);
});

test('新しいフレーズは1日の上限まで・連続日数のための日付・リピート回数', async () => {
  const s = await new Store(memoryAdapter()).init();
  s.setSetting('newPerDay', 2);
  const [a, b] = s.cards;
  await s.grade(a.id, 'good', 50); await s.grade(a.id, 'good', 50); // 2回目は新しいフレーズではない
  assert.equal(s.newLeft(50), 1);
  await s.grade(b.id, 'again', 50);
  assert.equal(s.newLeft(50), 0); assert.deepEqual(s.data.days, [50]);
  assert.equal(s.data.last[b.id], 'again');
  await s.repeatDone(a.id);
  assert.equal(s.stats(50).repeated, 1);
});

test('自分のフレーズの追加・編集・削除', async () => {
  const s = await new Store(memoryAdapter()).init();
  assert.throws(() => s.saveCard({ japanese: 'あ', english: '' }));
  const id = s.saveCard({ japanese: '了解です。', english: 'Got it.', note: '[返事]' });
  assert.equal(s.card(id).lesson, 'マイフレーズ'); assert.equal(s.card(id).src, 'mine');
  s.saveCard({ id, japanese: '了解です。', english: 'Understood.' });
  assert.equal(s.card(id).english, 'Understood.');
  await s.deleteCard(id); assert.equal(s.card(id), null);
  await s.deleteSource('sample'); assert.equal(s.cards.length, 0);
});

test('バックアップ → 別の端末で元にもどす', async () => {
  const s = await new Store(memoryAdapter()).init();
  s.saveCard({ japanese: 'またね', english: 'See you.' });
  await s.grade(s.cards[0].id, 'easy', 10);
  const file = JSON.stringify(s.exportBackup());
  const r = parseImport(file, 'backup.json'); assert.equal(r.kind, 'backup');
  const t = await new Store(memoryAdapter()).init();
  await t.restoreBackup(r.backup);
  assert.equal(t.cards.length, s.cards.length); assert.equal(t.state(s.cards[0].id).reps, 1);
  assert.throws(() => t.restoreBackup({}), /バックアップ/);
  await t.resetProgress(); assert.equal(Object.keys(t.states).length, 0); assert.ok(Object.values(t.data.states).every((x) => x.seen === 0 && x.ts)); assert.equal(t.state(s.cards[0].id), null); assert.equal(t.cards.length, s.cards.length);
});

test('レッスンごとの集計', async () => {
  const s = await new Store(memoryAdapter()).init();
  const L = s.lessons(); assert.equal(L.length, 1); assert.equal(L[0].name, 'サンプル'); assert.equal(L[0].total, s.cards.length);
});
