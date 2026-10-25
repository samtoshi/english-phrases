import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotOf, replayLog, mergeHist, buildSeries, chartSvg } from '../js/history.js';
import { Store, memoryAdapter } from '../js/store.js';
import { mergeMeta } from '../js/merge.js';
import { syncOnce, memoryCloud } from '../js/cloudsync.js';
import { dayIndex } from '../js/srs.js';

const DAY = 86400000;
const atDay = (d, h = 12) => new Date(d * DAY + new Date(d * DAY).getTimezoneOffset() * 60000 + h * 3600000).getTime();

test('snapshotOf：覚えた（間隔21日以上）・練習中・3回リピート済を数える', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const states = { a: { seen: 3, interval: 30 }, b: { seen: 1, interval: 1 } };
  assert.deepEqual(snapshotOf(cards, states, { b: 1, c: 2, x: 1 }), { m: 1, l: 1, r: 2 });
});

test('replayLog：採点の記録から日ごとの数を計算しなおす（4回続けて言えると「覚えた」）', () => {
  const D = 20000;
  assert.equal(dayIndex(new Date(atDay(D))), D);
  const log = [
    { t: atDay(D), id: 'a', g: 'good' }, { t: atDay(D, 13), id: 'b', g: 'again' },
    { t: atDay(D + 1), id: 'a', g: 'good' }, { t: atDay(D + 7), id: 'a', g: 'good' }, { t: atDay(D + 22), id: 'a', g: 'good' },
    { t: atDay(D + 22, 13), id: 'gone', g: 'good' },
  ];
  const r = replayLog(log, ['a', 'b']);
  assert.deepEqual(r[D], { m: 0, l: 2 });
  assert.deepEqual(r[D + 7], { m: 0, l: 2 });
  assert.deepEqual(r[D + 22], { m: 1, l: 1 }); // 間隔 15→37日 で「覚えた」。消したフレーズは数えない
});

test('buildSeries：今日は今の数・記録の日は記録・その前は log から・間の日は前の日と同じ・期間をしぼれる', () => {
  const T = 20100;
  const hist = { [T - 2]: { m: 1, l: 5, r: 2, ts: 1 } };
  const replay = { [T - 5]: { m: 0, l: 3 }, [T - 2]: { m: 9, l: 9 } };
  const s = buildSeries({ hist, replay, current: { m: 2, l: 6, r: 4 }, today: T });
  assert.equal(s.length, 6);
  assert.deepEqual(s.map((p) => [p.m, p.l, p.r, p.est]), [[0, 3, null, true], [0, 3, null, true], [0, 3, null, true], [1, 5, 2, false], [1, 5, 2, false], [2, 6, 4, false]]);
  assert.equal(buildSeries({ hist, replay, current: { m: 2, l: 6, r: 4 }, today: T, days: 2 }).length, 2);
  // 記録がまったくなくても今日の1点は出る
  const one = buildSeries({ current: { m: 0, l: 14, r: 3 }, today: T });
  assert.equal(one.length, 1);
  const svg = chartSvg(one);
  assert.match(svg, /^<svg class="chart"/); assert.ok(!/NaN|undefined/.test(svg));
  assert.ok(!/NaN|undefined/.test(chartSvg(s)));
});

test('採点・リピートで今日の数が残り、進み具合のリセットで消える', async () => {
  const s = await new Store(memoryAdapter()).init();
  const T = 300; const id = s.cards[0].id;
  await s.grade(id, 'good', T, 1000);
  assert.deepEqual(s.data.hist[T], { m: 0, l: 1, r: 0, ts: 1000 });
  await s.repeatDone(id, T, 2000);
  assert.equal(s.data.hist[T].r, 1);
  assert.equal(s.snapshot(T, 3000), false); // 変わっていなければ書かない
  await s.resetProgress();
  assert.deepEqual(s.data.hist, {});
});

test('日ごとの記録は端末どうしでまざる（日ごとに新しい方）・クラウドに同期される', async () => {
  assert.deepEqual(mergeHist({ 1: { m: 0, ts: 5 }, 2: { m: 1, ts: 9 } }, { 2: { m: 2, ts: 3 }, 3: { m: 3, ts: 1 } }).hist,
    { 1: { m: 0, ts: 5 }, 2: { m: 1, ts: 9 }, 3: { m: 3, ts: 1 } });
  const mm = mergeMeta({ hist: { 1: { m: 1, ts: 1 } }, resetAt: 0 }, { hist: { 1: { m: 2, ts: 2 } }, resetAt: 0 });
  assert.equal(mm.hist[1].m, 2); assert.equal(mm.changed, true);
  // 新しいリセットがあれば、前の記録は捨てる
  assert.deepEqual(mergeMeta({ hist: { 1: { m: 1, ts: 1 } }, resetAt: 0 }, { resetAt: 10 }).hist, {});

  const cloud = memoryCloud();
  const a = await new Store(memoryAdapter()).init();
  await a.grade(a.cards[0].id, 'good', 400, 1000);
  await syncOnce(a, cloud);
  assert.equal(cloud.db.state.hist[400].l, 1);
  const b = await new Store(memoryAdapter()).init();
  await syncOnce(b, cloud);
  assert.deepEqual(b.data.hist[400], a.data.hist[400]);
});
