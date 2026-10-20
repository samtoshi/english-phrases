// 答え合わせ：意味が通れば OK の「ゆるい」比較。
// 大文字小文字・記号・短縮形（I'm = I am など）・(ト書き) の違いは無視して、単語のならびで比べる。

const CONTRACTIONS = [
  // アポストロフィなしで打った・認識された短縮形
  [/\b(im|ive|youre|youve|theyre|weve|dont|doesnt|didnt|isnt|arent|wasnt|werent|cant|couldnt|wouldnt|shouldnt|havent|hasnt|thats|whats|theres|heres)\b/g,
    (w) => ({ im: "i'm", ive: "i've", youre: "you're", youve: "you've", theyre: "they're", weve: "we've", cant: "can't" }[w] || w.replace(/(nt|s)$/, (x) => (x === 'nt' ? "n't" : "'s")))],
  [/\bcan't\b/g, 'can not'], [/\bcannot\b/g, 'can not'], [/\bwon't\b/g, 'will not'], [/\bshan't\b/g, 'shall not'],
  [/\bain't\b/g, 'am not'], [/\blet's\b/g, 'let us'], [/\by'all\b/g, 'you all'],
  [/\b(it|that|what|there|here|who|where|how|he|she|this|everything|nothing|something)'s\b/g, '$1 is'],
  [/n't\b/g, ' not'], [/'re\b/g, ' are'], [/'m\b/g, ' am'], [/'ve\b/g, ' have'], [/'ll\b/g, ' will'], [/'d\b/g, ' would'],
  [/\bgonna\b/g, 'going to'], [/\bwanna\b/g, 'want to'], [/\bgotta\b/g, 'got to'],
  [/\bok\b/g, 'okay'], [/\be-mail\b/g, 'email'], [/\bmr\b/g, 'mister'], [/\bmrs\b/g, 'missus'], [/\bms\b/g, 'miss'],
];
const NUM = { 0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve' };
// 意味がほとんど変わらない「つなぎ」の語（答えの最初にあっても・なくても同じとみなす）
const FILLERS = new Set(['oh', 'well', 'um', 'uh', 'hmm', 'so', 'yeah']);

/** 比べるための形にする（小文字・短縮形をひらく・記号を消す・数字を英語に） */
export function normalize(s) {
  let t = String(s || '').toLowerCase()
    .replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"')
    .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, ' ');
  for (const [re, to] of CONTRACTIONS) t = t.replace(re, to);
  t = t.replace(/(\w)'s\b/g, '$1s') // 所有格や is の 's はそのまま 1 語に（John's → johns）
    .replace(/[^a-z0-9\s-]/g, ' ').replace(/-/g, ' ')
    .replace(/\b(\d+)\b/g, (m) => NUM[m] || m);
  return t.split(/\s+/).filter(Boolean).join(' ');
}
export const words = (s) => normalize(s).split(' ').filter(Boolean);

/** 単語単位のレーベンシュタイン距離 */
function editDistance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const stripFillers = (ws) => { const out = ws.slice(); while (out.length > 1 && FILLERS.has(out[0])) out.shift(); return out; };

/** 0〜1 のにている度合い（1＝同じ） */
export function similarity(answer, model) {
  const a = stripFillers(words(answer)), b = stripFillers(words(model));
  if (!a.length || !b.length) return a.length === b.length ? 1 : 0;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

/**
 * 答え合わせ
 * @returns {{ verdict: 'exact'|'close'|'diff'|'empty', score: number, suggest: 'good'|'hard'|'again'|null }}
 */
export function judge(answer, model) {
  if (!normalize(answer)) return { verdict: 'empty', score: 0, suggest: null };
  const score = similarity(answer, model);
  if (score >= 0.999) return { verdict: 'exact', score, suggest: 'good' };
  if (score >= 0.7) return { verdict: 'close', score, suggest: 'good' };
  if (score >= 0.5) return { verdict: 'diff', score, suggest: 'hard' };
  return { verdict: 'diff', score, suggest: 'again' };
}

/** 3回リピートで「言えた」とみなすか（認識の聞きまちがいも少し許す） */
export const repeatOk = (said, model) => similarity(said, model) >= 0.7;

/**
 * 単語の差分（お手本の単語ごとに ok / miss、答えのよけいな単語は extra）
 * @returns {Array<{w:string, t:'ok'|'miss'|'extra'}>}
 */
export function wordDiff(answer, model) {
  const a = words(answer), b = words(model);
  const m = a.length, n = b.length;
  const L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ w: b[j], t: 'ok' }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ w: a[i++], t: 'extra' });
    else out.push({ w: b[j++], t: 'miss' });
  }
  while (i < m) out.push({ w: a[i++], t: 'extra' });
  while (j < n) out.push({ w: b[j++], t: 'miss' });
  return out;
}
