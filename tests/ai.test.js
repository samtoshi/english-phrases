import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContents, contextText, aiHtml, aiErrorKind, SYSTEM } from '../js/ai.js';
import { readFileSync } from 'node:fs';

test('最初の質問には、いまのフレーズを添える・つづきは会話として送る', () => {
  const ctx = { japanese: '駅はどこですか？', english: 'Where is the station?', answer: 'Where the station is?', notes: ['語順'] };
  const c1 = buildContents([], 'どこがちがう？', ctx);
  assert.equal(c1.length, 1); assert.equal(c1[0].role, 'user');
  assert.match(c1[0].parts[0].text, /Where is the station\?[\s\S]*Where the station is\?[\s\S]*語順[\s\S]*【質問】どこがちがう？/);
  const c2 = buildContents([{ role: 'me', text: 'Q1' }, { role: 'ai', text: 'A1' }], 'Q2', ctx);
  assert.deepEqual(c2.map((m) => m.role), ['user', 'model', 'user']);
  assert.equal(c2[2].parts[0].text, 'Q2');
  assert.equal(contextText(null), '');
  assert.equal(buildContents([], '現在完了って？', null)[0].parts[0].text, '現在完了って？');
  assert.match(SYSTEM, /日本語/); assert.match(SYSTEM, /例文/);
});

test('答えの表示はエスケープする（太字と改行だけ）', () => {
  assert.equal(aiHtml('<img src=x onerror=1> **a**\n- b'), '&lt;img src=x onerror=1&gt; <b>a</b><br>・b');
});

test('エラーの種類', () => {
  assert.equal(aiErrorKind({ message: '[429 ] RESOURCE_EXHAUSTED' }), 'quota');
  assert.equal(aiErrorKind({ message: 'models/x is not found' }), 'model');
  assert.equal(aiErrorKind({ code: 'AI/api-not-enabled' }), 'disabled');
  assert.equal(aiErrorKind({ message: 'App Check token is invalid' }), 'appcheck');
});

test('APIキーやシークレットをコードに書いていない（Firebase の公開用の設定だけ）', () => {
  for (const f of ['js/ai.js', 'js/app.js', 'js/explain.js']) {
    const s = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /AIza[0-9A-Za-z_-]{20,}/, f);
    assert.doesNotMatch(s, /generativelanguage\.googleapis\.com/, f);
  }
});
