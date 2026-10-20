import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, judge, similarity, wordDiff, repeatOk } from '../js/match.js';

test('大文字・記号・短縮形の違いは同じとみなす', () => {
  assert.equal(normalize("Why don't you take both?"), 'why do not you take both');
  assert.equal(normalize('why dont you take both'), 'why do not you take both');
  assert.equal(normalize('Here is my ticket.'), normalize("Here’s my ticket"));
  assert.equal(normalize("I'm Tanaka Ken. (bows)"), 'i am tanaka ken');
  assert.equal(normalize("I've got 2 tickets"), 'i have got two tickets');
  assert.equal(normalize("Let's call it a day!"), 'let us call it a day');
  assert.equal(normalize("I can't"), normalize('I cannot'));
});

test('ほぼ同じ → close、ちがう → diff（目安の採点つき）', () => {
  assert.deepEqual(judge("why don't you take both", "Why don't you take both?").verdict, 'exact');
  assert.equal(judge('Well, here is my card', "Here's my card.").verdict, 'exact'); // 文頭の Well は無視
  const c = judge('Could you speak more slowly?', 'Could you speak a little more slowly?');
  assert.equal(c.verdict, 'close'); assert.equal(c.suggest, 'good');
  const d = judge('I am happy', "You're lucky it's Friday.");
  assert.equal(d.verdict, 'diff'); assert.equal(d.suggest, 'again');
  assert.equal(judge('   ', 'Hello.').verdict, 'empty');
  assert.ok(similarity('a b c d', 'a b c e') === 0.75);
});

test('単語の差分：足りない語・よけいな語', () => {
  const d = wordDiff('Why not you take them both', "Why don't you take both?");
  assert.deepEqual(d.filter((x) => x.t === 'miss').map((x) => x.w), ['do']);
  assert.deepEqual(d.filter((x) => x.t === 'extra').map((x) => x.w), ['them']);
  assert.deepEqual(d.filter((x) => x.t !== 'extra').map((x) => x.w).join(' '), 'why do not you take both');
});

test('3回リピート：認識の小さなまちがいは OK', () => {
  assert.ok(repeatOk('why don’t you take both', "Why don't you take both?"));
  assert.ok(repeatOk('why do you take both', "Why don't you take both?"));
  assert.ok(!repeatOk('what time is it', "Why don't you take both?"));
});
