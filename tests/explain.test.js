import test from 'node:test';
import assert from 'node:assert/strict';
import { explain, tenseOf } from '../js/explain.js';
import { words } from '../js/match.js';

// 例文はすべて自作（本のフレーズは使わない）
const kinds = (a, m) => explain(a, m).filter((x) => !x.ok).map((x) => x.kind);
const text = (a, m) => explain(a, m).map((x) => x.text).join('\n');

test('時制：現在 ↔ 過去・未来・現在完了', () => {
  assert.deepEqual(kinds('I visit my aunt last week.', 'I visited my aunt last week.'), ['tense']);
  assert.match(text('I visit my aunt last week.', 'I visited my aunt last week.'), /過去形/);
  assert.deepEqual(kinds('I email you tonight.', 'I will email you tonight.'), ['tense']);
  assert.match(text('I am working here since 2020.', 'I have worked here since 2020.'), /現在完了/);
  assert.equal(tenseOf(words('She bought a new bike.')), 'past');
  assert.equal(tenseOf(words('I am tired.')), 'present');
  assert.equal(tenseOf(words("We're going to move in May.")), 'future');
  assert.equal(tenseOf(words('I have finished my homework.')), 'perfect');
});

test('冠詞：抜け・よけい・a/an・a と the', () => {
  assert.deepEqual(kinds('Can I borrow umbrella?', 'Can I borrow an umbrella?'), ['article']);
  assert.match(text('Can I borrow umbrella?', 'Can I borrow an umbrella?'), /「umbrella」 の前に 「an」/);
  assert.match(text('She plays the tennis.', 'She plays tennis.'), /「the」 はいりません/);
  assert.match(text('I ate a orange.', 'I ate an orange.'), /母音/);
  assert.match(text('Please close a window.', 'Please close the window.'), /「a」 ではなく 「the」/);
});

test('語順：疑問文・間接疑問・単語の位置', () => {
  assert.deepEqual(kinds('Where the bus stop is?', 'Where is the bus stop?'), ['order']);
  assert.match(text('You can help me?', 'Can you help me?'), /「can」 を主語より前/);
  assert.match(text('Do you know where is the bank?', 'Do you know where the bank is?'), /間接疑問/);
  assert.deepEqual(kinds('I always am late.', 'I am always late.'), ['order']);
});

test('単数・複数と三単現の s', () => {
  assert.deepEqual(kinds('I need three ticket.', 'I need three tickets.'), ['number']);
  assert.deepEqual(kinds('My brother cook dinner.', 'My brother cooks dinner.').length, 1);
  assert.deepEqual(kinds('She drive to work.', 'She drives to work.'), ['third']);
  assert.match(text('He have a cat.', 'He has a cat.'), /三単現|s をつけて/);
});

test('主語・be動詞の抜け、be動詞の形', () => {
  assert.deepEqual(kinds('Am hungry.', 'I am hungry.'), ['subject']);
  assert.deepEqual(kinds('She very kind.', 'She is very kind.'), ['be']);
  assert.match(text('They is late.', 'They are late.'), /「are」/);
});

test('前置詞：ちがい・抜け・よけい', () => {
  assert.deepEqual(kinds('The meeting is in Friday.', 'The meeting is on Friday.'), ['prep']);
  assert.match(text('The meeting is in Friday.', 'The meeting is on Friday.'), /「in」 ではなく 「on」.*曜日/);
  assert.match(text('Please listen me.', 'Please listen to me.'), /「to」 が抜けています/);
  assert.match(text('We discussed about the plan.', 'We discussed the plan.'), /「about」 はいりません/);
});

test('動詞の形：助動詞・to のあとは原形、-ing', () => {
  assert.match(text('Did you watched the game?', 'Did you watch the game?'), /「did」 のあとの動詞は原形/);
  assert.match(text('I want to swimming.', 'I want to swim.'), /to のあとは動詞の原形/);
});

test('短縮形はどちらでも OK（問題にしない）', () => {
  const r = explain('I do not like spicy food', "I don't like spicy food.");
  assert.equal(r.length, 1); assert.equal(r[0].ok, true); assert.equal(r[0].kind, 'contraction');
  assert.deepEqual(explain('It is raining.', "It's raining."), explain('It is raining.', "It's raining.").filter((x) => x.ok));
  assert.deepEqual(explain('', 'Hello.'), []);
  assert.deepEqual(explain('Nice to meet you.', 'Nice to meet you!'), []);
});

test('ほかのちがい：抜けている語・よけいな語・語の選び方・スペル', () => {
  assert.match(text('I like coffee.', 'I really like coffee.'), /「really」 が抜けています/);
  assert.match(text('I really like coffee.', 'I like coffee.'), /「really」 はお手本にありません/);
  assert.match(text('I like tea.', 'I like coffee.'), /「tea」 ではなく 「coffee」/);
  assert.deepEqual(kinds('See you tomorow.', 'See you tomorrow.'), ['spell']);
});

test('大きくちがう答えは、細かい指摘をせずにまとめる', () => {
  const r = explain('the I go yesterday', 'Could you speak a little more slowly?');
  assert.deepEqual(r.map((x) => x.kind), ['tense', 'different'].filter((k) => r.some((x) => x.kind === k)));
  assert.ok(r.some((x) => x.kind === 'different'));
  assert.ok(!r.some((x) => x.kind === 'article'));
});
