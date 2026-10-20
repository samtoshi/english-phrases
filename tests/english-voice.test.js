import test from 'node:test';
import assert from 'node:assert/strict';
import { pickVoiceFrom, speakText, chunkText } from '../js/voice.js';

test('英語の声：en-US・ローカル・よく使う声を優先', () => {
  const vs = [
    { lang: 'ja-JP', name: 'Kyoko', localService: true },
    { lang: 'en-GB', name: 'Daniel', localService: true },
    { lang: 'en-US', name: 'Fred', localService: true },
    { lang: 'en-US', name: 'Samantha', localService: true },
    { lang: 'en_US', name: 'Google US English', localService: false },
  ];
  assert.equal(pickVoiceFrom(vs, 'en-US').name, 'Samantha');
  assert.equal(pickVoiceFrom(vs.slice(0, 2), 'en-US').name, 'Daniel'); // en-US がなければ他の英語
  assert.equal(pickVoiceFrom([vs[0]], 'en-US'), null);
  assert.equal(pickVoiceFrom(vs, 'ja-JP').name, 'Kyoko');
});

test('英語の読み上げ文：ト書き（かっこ）を読まない・長文は文ごと', () => {
  assert.equal(speakText("I'm Tanaka Ken. (bows)", 'en-US'), "I'm Tanaka Ken.");
  assert.equal(speakText('Here’s my card.', 'en-US'), "Here's my card.");
  const long = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i}.`).join(' ');
  const parts = chunkText(long);
  assert.ok(parts.length >= 2); assert.ok(parts.every((p) => p.length <= 160));
  assert.equal(parts.join('').replace(/\s+/g, ' ').trim(), long);
  assert.deepEqual(chunkText("Why don't you take both?"), ["Why don't you take both?"]);
});

test('音声認識は en-US で聞く', async () => {
  let made = null;
  globalThis.window = { webkitSpeechRecognition: class { constructor() { made = this; } start() {} stop() {} abort() {} } };
  const v = await import('../js/voice.js?sr-en');
  const l = v.listen({ continuous: false });
  assert.equal(made.lang, 'en-US'); assert.equal(made.continuous, false);
  l.abort(); assert.equal(await l.done, '');
});
