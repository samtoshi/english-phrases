import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
function files(dir = ROOT) {
  return readdirSync(dir).flatMap((f) => {
    if (f === '.git' || f === 'node_modules') return [];
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

test('サービスワーカー：同じサイトの anki-app のキャッシュは消さない（ep- だけ）', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /k\.startsWith\(P\)/);
  assert.doesNotMatch(sw, /caches\.open\('shell-/);
});

test('リポジトリに教材のフレーズが入っていない（手元に教材のファイルがあるときだけ確認）', (t) => {
  const p = process.env.EP_PRIVATE_DATA || '/workspace/english-phrases-data/naruhodo-items.json';
  if (!existsSync(p)) return t.skip('教材のファイルがない');
  const book = JSON.parse(readFileSync(p, 'utf8'));
  const text = files().filter((f) => !/\.png$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  const hits = book.filter((x) => text.includes(x.english) || (x.japanese.length > 3 && text.includes(x.japanese)));
  assert.deepEqual(hits.map((x) => x.id), []);
});
