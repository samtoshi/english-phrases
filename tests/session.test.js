import test from 'node:test';
import assert from 'node:assert/strict';
import { buildList, Session, isWeak, shuffle } from '../js/session.js';
import { schedule } from '../js/srs.js';

const cards = Array.from({ length: 30 }, (_, i) => ({ id: 'c' + i, lesson: i < 10 ? 'Lesson 1' : 'Lesson 2' }));

test('今日の復習：期限がきた復習 ＋ 新しいフレーズ（1日の上限まで）', () => {
  const states = { c0: schedule(null, 'good', 100), c1: schedule(null, 'good', 90) }; // c0 は 101 が期限、c1 は 91
  const ids = buildList('today', cards, { states, today: 100, newLeft: 3 });
  assert.deepEqual(ids.filter((x) => x === 'c0' || x === 'c1'), ['c1']);
  assert.equal(ids.length, 4);
});

test('ランダム：全部をシャッフル・レッスン：そのレッスンだけ（復習→新しい→その他）', () => {
  const r = buildList('random', cards, { rnd: () => 0.3 });
  assert.equal(r.length, 30); assert.deepEqual([...r].sort(), cards.map((c) => c.id).sort());
  const states = { c3: schedule(null, 'good', 100), c5: schedule(null, 'good', 50) };
  const l = buildList('lesson', cards, { states, today: 100, lesson: 'Lesson 1' });
  assert.equal(l.length, 10); assert.equal(l[0], 'c5'); assert.equal(l[l.length - 1], 'c3');
  assert.equal(shuffle([1, 2, 3]).length, 3);
});

test('苦手だけ：まちがえた・難しい・EF が低い', () => {
  let s = schedule(null, 'good', 1); s = schedule(s, 'again', 3);
  const states = { c0: s, c1: schedule(null, 'good', 1), c2: schedule(null, 'hard', 1) };
  assert.ok(isWeak(states.c0)); assert.ok(!isWeak(states.c1, 'good')); assert.ok(!isWeak(null));
  assert.deepEqual(buildList('weak', cards, { states, lastGrades: { c2: 'hard', c1: 'good' } }).sort(), ['c0', 'c2']);
});

test('5問ずつ：セットの終わりで「続ける？」、5セットでもう一度確認', () => {
  const ids = Array.from({ length: 60 }, (_, i) => 'x' + i);
  const s = new Session(ids);
  const res = [];
  for (let k = 0; k < 25; k++) { assert.equal(s.posInSet, (k % 5) + 1); s.grade('good'); res.push(s.advance()); }
  assert.deepEqual(res.map((r, i) => [i + 1, r]).filter(([, r]) => r !== 'next'), [[5, 'setEnd'], [10, 'setEnd'], [15, 'setEnd'], [20, 'setEnd'], [25, 'bigEnd']]);
  assert.equal(s.setNo, 6); assert.equal(s.correct, 25);
});

test('「もう一回」はセッションの最後にもう一度（2回まで）・最後は done', () => {
  const s = new Session(['a', 'b']);
  s.grade('again'); assert.equal(s.advance(), 'next'); // a → 最後へ
  s.grade('good'); assert.equal(s.advance(), 'next');  // b
  assert.equal(s.current, 'a'); s.grade('again'); s.advance();
  assert.equal(s.current, 'a'); s.grade('again'); assert.equal(s.queue.length, 4); // 3回目はもう足さない
  assert.equal(s.advance(), 'done');
});

test('ストップ用の結果：正解・ほぼ正解・まちがい・マスター・まちがえたフレーズ', async () => {
  const { Session, summarize } = await import('../js/session.js');
  const s = new Session(['a', 'b', 'c', 'd', 'e']);
  s.checked('exact', 'x'); s.grade('good'); s.master('a'); s.advance();
  s.checked('close', 'y'); s.grade('good'); s.advance();
  s.checked('diff', 'z'); s.grade('again'); s.advance();
  s.checked('empty', ''); s.grade('hard'); s.advance();
  s.checked('diff', 'w'); // 採点前にストップ → 数えない
  const r = summarize(s);
  assert.equal(r.answered, 4);
  assert.deepEqual([r.correct, r.almost, r.wrong, r.mastered], [1, 2, 1, 1]); // 入力なし＋「難しい」はほぼ正解
  assert.deepEqual(r.missed.map((m) => m.id), ['c']);
  assert.equal(r.missed[0].answer, 'z');
  // 同じフレーズのやり直し（もう一回で後ろにまわる）は、まちがいリストに1回だけ
  const t = new Session(['p']);
  t.checked('diff', 'q'); t.grade('again'); t.advance();
  t.checked('diff', 'q2'); t.grade('again');
  assert.equal(summarize(t).missed.length, 1); assert.equal(summarize(t).wrong, 2);
});
