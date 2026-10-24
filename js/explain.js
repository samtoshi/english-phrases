// 答えとお手本をくらべて、どこがちがうかを文法の言葉で説明する（ルールベース・端末の中だけで動く）。
// 例：時制・冠詞・前置詞・語順・単数/複数・三単現の s・主語・be動詞・助動詞・スペル・短縮形（どちらでも OK）
import { words, wordDiff } from './match.js';

const ART = new Set(['a', 'an', 'the']);
const PREP = new Set(['in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by', 'about', 'into', 'onto', 'over', 'under', 'around', 'through', 'during', 'until', 'till', 'since', 'before', 'after', 'between', 'among', 'without', 'within', 'across', 'along', 'behind', 'near', 'up', 'off', 'out', 'toward', 'towards', 'per', 'via', 'like']);
const BE = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being']);
const AUX = new Set(['do', 'does', 'did', 'will', 'would', 'can', 'could', 'shall', 'should', 'may', 'might', 'must', 'have', 'has', 'had', ...BE]);
const SUBJ = new Set(['i', 'you', 'we', 'he', 'she', 'it', 'they', 'this', 'that', 'there']);
const THIRD = new Set(['he', 'she', 'it', 'this', 'that', 'everyone', 'everybody', 'someone', 'somebody', 'nobody', 'who']);
const WH = new Set(['what', 'where', 'when', 'why', 'how', 'who', 'which', 'whose']);
const BASE_AFTER = new Set(['do', 'does', 'did', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must']);
const TENSE_WORDS = new Set(['will', 'have', 'has', 'had', 'did', ...BE]);
const FILLERS = new Set(['oh', 'well', 'um', 'uh', 'hmm', 'so', 'yeah']);

// 不規則動詞：原形・過去形・過去分詞
const IRR = `be was been|become became become|begin began begun|break broke broken|bring brought brought|build built built|buy bought bought|catch caught caught|choose chose chosen|come came come|cost cost cost|cut cut cut|do did done|draw drew drawn|drink drank drunk|drive drove driven|eat ate eaten|fall fell fallen|feel felt felt|fight fought fought|find found found|fly flew flown|forget forgot forgotten|get got gotten|give gave given|go went gone|grow grew grown|have had had|hear heard heard|hold held held|keep kept kept|know knew known|leave left left|lend lent lent|let let let|lose lost lost|make made made|mean meant meant|meet met met|pay paid paid|put put put|read read read|ride rode ridden|ring rang rung|rise rose risen|run ran run|say said said|see saw seen|sell sold sold|send sent sent|set set set|shut shut shut|sing sang sung|sit sat sat|sleep slept slept|speak spoke spoken|spend spent spent|stand stood stood|steal stole stolen|swim swam swum|take took taken|teach taught taught|tell told told|think thought thought|throw threw thrown|understand understood understood|wake woke woken|wear wore worn|win won won|write wrote written`
  .split('|').map((x) => x.split(' '));
const PAST = new Map(), PP = new Map(), BASE_OF = new Map();
BASE_OF.set('has', 'have'); BASE_OF.set('does', 'do');
for (const [b, p, pp] of IRR) { if (p !== b) PAST.set(p, b); if (pp !== b) PP.set(pp, b); BASE_OF.set(p, b); BASE_OF.set(pp, b); }
const isPastWord = (w) => w === 'was' || w === 'were' || w === 'did' || (PAST.has(w) && !['read', 'let', 'put', 'set', 'cut', 'cost', 'shut'].includes(w)) || (/^[a-z]{3,}ed$/.test(w) && !/(need|seed|feed|speed|bleed|breed|weed|proceed|succeed|exceed|bed|red|shed)$/.test(w));
const isPP = (w) => PP.has(w) || /^[a-z]{3,}ed$/.test(w);

/** 動詞の原形（だいたい）：went→go, played→play, studies→study, goes→go */
function baseForm(w) {
  if (BASE_OF.has(w)) return BASE_OF.get(w);
  if (/([^aeiou])\1ing$/.test(w) && w.length > 5) return w.slice(0, -4);
  if (/ing$/.test(w) && w.length > 4) return w.slice(0, -3);
  if (/ied$/.test(w)) return w.slice(0, -3) + 'y';
  if (/([^aeiou])\1ed$/.test(w)) return w.slice(0, -3);
  if (/ed$/.test(w)) return w.slice(0, -2);
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(ch|sh|ss|x|o)es$/.test(w)) return w.slice(0, -2);
  if (/[^s]s$/.test(w)) return w.slice(0, -1);
  return w;
}
const sameVerb = (a, b) => a !== b && (baseForm(a) === baseForm(b) || baseForm(a) === b || a === baseForm(b) || baseForm(a) + 'e' === b || a + 'e' === baseForm(b) || baseForm(a) === baseForm(b) + 'e' || baseForm(a) + 'e' === baseForm(b));

/** 文の時制（だいたい） */
export function tenseOf(ws) {
  const has = (w) => ws.includes(w);
  for (let i = 0; i < ws.length; i++) {
    if (ws[i] === 'will' || (ws[i] === 'going' && ws[i + 1] === 'to' && ws[i + 2] && !SUBJ.has(ws[i + 2]) && !ART.has(ws[i + 2]))) return 'future';
  }
  for (let i = 0; i < ws.length; i++) {
    if (['have', 'has', 'had'].includes(ws[i]) && ws.slice(i + 1, i + 3).some((w) => isPP(w) && w !== 'had' || w === 'been')) {
      if (ws[i - 1] && ['do', 'does', 'did'].includes(ws[i - 1])) continue;
      return ws[i] === 'had' ? 'pastperfect' : 'perfect';
    }
  }
  for (let i = 0; i < ws.length - 1; i++) if (BE.has(ws[i]) && /ing$/.test(ws[i + 1]) && ws[i + 1].length > 4) return ['was', 'were'].includes(ws[i]) ? 'pastprogressive' : 'progressive';
  if (has('did') || has('was') || has('were')) return 'past';
  // 主語の直後などの -ed / 不規則な過去形（have/be のあとの過去分詞はのぞく）
  for (let i = 0; i < ws.length; i++) {
    if (!isPastWord(ws[i])) continue;
    const prev = ws[i - 1] || '';
    if (BE.has(prev) || ['have', 'has', 'had', 'get', 'got', 'very', 'so', 'too', 'a', 'an', 'the'].includes(prev)) continue;
    return 'past';
  }
  return 'present';
}
const TENSE_JA = { present: '現在形', past: '過去形', future: '未来（will / be going to）', perfect: '現在完了（have + 過去分詞）', pastperfect: '過去完了（had + 過去分詞）', progressive: '進行形（be + -ing）', pastprogressive: '過去進行形（was/were + -ing）' };
const TENSE_TIP = {
  past: '終わったこと・過去の出来事は過去形にします。',
  present: '習慣・いつものこと・今の状態は現在形です。',
  future: 'これからのことは will（その場で決めた）か be going to（予定）で表します。',
  perfect: '過去から今につながること（経験・完了・継続）は現在完了で言います。',
  progressive: '今している最中のことは進行形です。',
  pastperfect: '過去のある時点より前のことは過去完了です。',
  pastprogressive: '過去のある時点でしている最中だったことは過去進行形です。',
};

function charDist(a, b) {
  const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
const isPluralOf = (pl, sg) => pl !== sg && pl !== 'thanks' && (pl === sg + 's' || pl === sg + 'es' || (sg.endsWith('y') && pl === sg.slice(0, -1) + 'ies') || ({ child: 'children', person: 'people', man: 'men', woman: 'women', foot: 'feet', tooth: 'teeth', mouse: 'mice' }[sg] === pl));
const hasContraction = (s) => /\b\w+'(m|re|s|ve|ll|d|t)\b|n't\b|\b(im|dont|doesnt|didnt|cant|isnt|arent|wasnt|werent|wont|ive|youre|theyre|thats|whats|lets)\b/i.test(String(s).replace(/[‘’]/g, "'"));
const q = (w) => `「${w}」`;
const stripFill = (ws) => { const o = ws.slice(); while (o.length > 1 && FILLERS.has(o[0])) o.shift(); return o; };

/** 差分 → まとまり（hunk）：{ miss: [語], extra: [語], at: お手本での位置, before: 直前のお手本の語, after: 直後のお手本の語 } */
function hunks(answer, model) {
  const d = wordDiff(answer, model);
  const out = []; let cur = null; let mi = 0; let lastOk = '';
  for (let k = 0; k < d.length; k++) {
    const x = d[k];
    if (x.t === 'ok') { if (cur) { cur.after = x.w; out.push(cur); cur = null; } lastOk = x.w; mi++; continue; }
    if (!cur) cur = { miss: [], extra: [], at: mi, before: lastOk, after: '' };
    if (x.t === 'miss') { cur.miss.push(x.w); mi++; } else cur.extra.push(x.w);
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 説明を作る
 * @returns {Array<{ kind: string, ok?: boolean, title: string, text: string }>}  ok＝問題ではない（短縮形など）
 */
export function explain(answer, model) {
  const a = stripFill(words(answer)), b = stripFill(words(model));
  const out = [];
  const add = (kind, title, text, ok = false) => { text = text.replace(/(^|[^a-zA-Z'])i(?=[^a-zA-Z']|$)/g, '$1I'); if (!out.some((x) => x.kind === kind && x.text === text)) out.push({ kind, title, text, ok }); };
  if (!a.length) return out;
  const contrNote = () => { if (hasContraction(answer) !== hasContraction(model)) add('contraction', '短縮形', '短縮形（I\'m / I am、don\'t / do not など）は、どちらで言っても正解です。', true); };
  if (a.join(' ') === b.join(' ')) { contrNote(); return out; }

  // 1) 語順：同じ単語で、並びだけちがう
  const sorted = (x) => x.slice().sort().join(' ');
  if (sorted(a) === sorted(b)) {
    if (AUX.has(b[0]) && a[0] !== b[0] && a.includes(b[0])) add('order', '語順（疑問文）', `疑問文は ${q(b[0])} を主語より前に出します（${b.slice(0, 3).join(' ')} …）。`);
    else if (WH.has(b[0]) && AUX.has(b[1]) && a[0] === b[0] && a[1] !== b[1]) add('order', '語順（疑問文）', `疑問詞のあとは ${q(b[1])} → 主語 の順です（${b.slice(0, 3).join(' ')} …）。「${b[0]} + 主語 + 動詞」の順になるのは、文の中に入れたとき（間接疑問）だけです。`);
    else if (indirect(a, b)) { const j = indirect(a, b) - 1; add('order', '語順（間接疑問）', `文の中に入れた疑問（間接疑問）は、疑問詞のあとを「主語 + 動詞」の順にします（… ${b.slice(j, j + 4).join(' ')} …）。`); }
    else add('order', '語順', `単語は合っていますが、並ぶ順番がちがいます。お手本の順：${b.join(' ')}`);
    contrNote();
    return out;
  }

  // 2) 時制（文全体）
  const ta = tenseOf(a), tb = tenseOf(b);
  const tenseIssue = ta !== tb;
  if (tenseIssue) add('tense', '時制', `お手本は${TENSE_JA[tb]}、あなたの答えは${TENSE_JA[ta]}です。${TENSE_TIP[tb] || ''}`);

  const H = hunks(answer, model);
  // 大きくちがうとき（合っている語がお手本の4割未満）は、細かい指摘をせずにまとめて伝える
  const okN = b.length - H.reduce((n, h) => n + h.miss.length, 0);
  if (okN / b.length < 0.4) {
    add('different', '文の作り', `お手本とは文の作り・使う単語が大きくちがいます。お手本の形をそのまま覚えましょう：${b.join(' ')}`);
    contrNote();
    return out;
  }
  // 3) 動いた単語（別の場所にある）→ 語順
  const allMiss = H.flatMap((h) => h.miss), allExtra = H.flatMap((h) => h.extra);
  const moved = [...new Set(allMiss.filter((w) => allExtra.includes(w) && !H.some((h) => h.miss.includes(w) && h.extra.includes(w))))];
  if (moved.length) {
    if (AUX.has(b[0]) && moved.includes(b[0]) && a[0] !== b[0]) add('order', '語順（疑問文）', `疑問文は ${q(b[0])} を主語より前に出します（${b.slice(0, 3).join(' ')} …）。`);
    else if (WH.has(b[0]) && moved.includes(b[1]) && a[0] === b[0]) add('order', '語順（疑問文）', `疑問詞のあとは ${q(b[1])} → 主語 の順です（${b.slice(0, 3).join(' ')} …）。`);
    else add('order', '語順', `${moved.map(q).join('')}の位置がちがいます。お手本：${b.join(' ')}`);
  }

  for (const h of H) {
    let miss = h.miss.filter((w) => !moved.includes(w)), extra = h.extra.filter((w) => !moved.includes(w));
    const take = (arr, w) => { const i = arr.indexOf(w); if (i >= 0) arr.splice(i, 1); return i >= 0; };
    // 主語の抜け（文のはじめの I / you / it など）
    if (h.at === 0 && miss.length && SUBJ.has(miss[0]) && !extra.some((w) => SUBJ.has(w))) {
      add('subject', '主語', `英語では主語を省略しません。文のはじめに ${q(miss[0])} が必要です。`); miss.shift();
    }
    // 冠詞
    const mA = miss.filter((w) => ART.has(w)), eA = extra.filter((w) => ART.has(w));
    if (mA.length && eA.length) {
      const m = mA[0], e = eA[0];
      if ((m === 'a' && e === 'an') || (m === 'an' && e === 'a')) add('article', '冠詞', `次の語が母音の音で始まるときは an、そうでなければ a です（${m} ${h.after || ''}）。`);
      else add('article', '冠詞', `${q(e)} ではなく ${q(m)} です。${m === 'the' ? 'the は話し手と聞き手のあいだで「どれのことか」決まっているもの。' : 'a / an は、はじめて話に出てくる・どれでもいい1つのもの。'}`);
      take(miss, m); take(extra, e);
    } else if (mA.length) { for (const m of mA) { add('article', '冠詞', `${q(h.after || h.miss[h.miss.indexOf(m) + 1] || '…')} の前に ${q(m)} が必要です（数えられる名詞の単数には a / an / the などをつけます）。`); take(miss, m); } }
    else if (eA.length) { for (const e of eA) { add('article', '冠詞', `${q(e)} はいりません（${h.after ? q(h.after) + ' には冠詞をつけません' : '冠詞なしで言います'}）。`); take(extra, e); } }
    // 前置詞
    const mP = miss.filter((w) => PREP.has(w)), eP = extra.filter((w) => PREP.has(w));
    if (mP.length && eP.length) { add('prep', '前置詞', `${q(eP[0])} ではなく ${q(mP[0])} を使います（${[h.before, mP[0], h.after].filter(Boolean).join(' ')}）。${prepTip(mP[0], eP[0])}`); take(miss, mP[0]); take(extra, eP[0]); }
    for (const m of miss.filter((w) => PREP.has(w))) { add('prep', '前置詞', `${q(m)} が抜けています（${[h.before, m, h.after].filter(Boolean).join(' ')}）。`); take(miss, m); }
    for (const e of extra.filter((w) => PREP.has(w))) { add('prep', '前置詞', `${q(e)} はいりません${h.before ? `（${h.before} ${h.after || ''} の形で使います）` : ''}。`); take(extra, e); }
    // 1語ずつの入れかわり
    for (const m of miss.slice()) {
      if (m === 'thanks') continue;
      const e = extra.find((x) => x !== 'thanks' && (isPluralOf(x, m) || isPluralOf(m, x) || sameVerb(x, m) || (BE.has(x) && BE.has(m)) || (m.length >= 4 && charDist(x, m) <= Math.max(1, Math.floor(m.length / 4)))));
      if (!e) continue;
      take(miss, m); take(extra, e);
      if (BE.has(m) && BE.has(e)) {
        const pastSwap = ['was', 'were'].includes(m) !== ['was', 'were'].includes(e);
        if (pastSwap) { if (!tenseIssue) add('tense', '時制', `${q(e)} ではなく ${q(m)}（${['was', 'were'].includes(m) ? '過去' : '現在'}）です。`); }
        else add('be', 'be動詞', `主語に合う be動詞は ${q(m)} です（I am / he・she・it is / you・we・they are）。`);
      } else if (sameVerb(m, e) && m === baseForm(m) && b.slice(0, h.at).some((w) => BASE_AFTER.has(w))) {
        const aux = b.slice(0, h.at).filter((w) => BASE_AFTER.has(w)).pop();
        add('verb', '動詞の形', `${q(aux)} のあとの動詞は原形なので、${q(e)} ではなく ${q(m)} です。`);
      } else if ((THIRD.has(h.before) || /s$/.test(m) !== /s$/.test(e)) && sameVerb(m, e) && (THIRD.has(h.before) || SUBJ.has(h.before) || ['i', 'you', 'we', 'they'].includes(h.before))) {
        add('third', '三単現の s', THIRD.has(h.before) || /s$/.test(m) ? `主語が ${q(h.before || '3人称単数')} で現在のことなので、動詞に s をつけて ${q(m)} にします。` : `主語が ${q(h.before)} なので、動詞に s はつけず ${q(m)} です。`);
      } else if (isPluralOf(m, e) || isPluralOf(e, m)) {
        add('number', '単数・複数', isPluralOf(m, e) ? `${q(m)}（複数形）です。2つ以上・一般的なものを言うときは複数形にします。` : `${q(m)}（単数）です。1つのものを言うときは単数形にします。`);
      } else if (sameVerb(m, e)) {
        const tip = formTip(m, h.before);
        if (!tenseIssue || tip) add('verb', '動詞の形', `${q(e)} ではなく ${q(m)} の形です。${tip}`);
      } else add('spell', 'スペル', `${q(e)} → ${q(m)}（つづりのちがい、または聞き取りのまちがいかもしれません）`);
    }
    // be動詞・助動詞の抜け（時制のちがいで説明ずみのものは、くり返さない）
    if (tenseIssue) { miss = miss.filter((w) => !TENSE_WORDS.has(w)); extra = extra.filter((w) => !TENSE_WORDS.has(w)); }
    for (const m of miss.filter((w) => BE.has(w))) { add('be', 'be動詞', `${q(m)} が抜けています。名詞・形容詞・-ing・場所を続けるときは be動詞が必要です（${[h.before, m, h.after].filter(Boolean).join(' ')}）。`); take(miss, m); }
    for (const m of miss.filter((w) => AUX.has(w))) {
      add('aux', '助動詞', m === 'will' ? `これからのことなので ${q('will')} が必要です。` : ['do', 'does', 'did'].includes(m) ? `疑問文・否定文には ${q(m)} が必要です（${[h.before, m, h.after].filter(Boolean).join(' ')}）。` : `${q(m)} が抜けています。`);
      take(miss, m);
    }
    for (const e of extra.filter((w) => AUX.has(w))) { add('aux', '助動詞', `${q(e)} はいりません。`); take(extra, e); }
    // 残り
    if (miss.length && extra.length) add('word', '語の選び方', `${q(extra.join(' '))} ではなく ${q(miss.join(' '))} と言います。`);
    else if (miss.length) add('missing', '抜けている語', `${q(miss.join(' '))} が抜けています（${[h.before, '［' + miss.join(' ') + '］', h.after].filter(Boolean).join(' ')}）。`);
    else if (extra.length) add('extra', 'よけいな語', `${q(extra.join(' '))} はお手本にありません。`);
  }
  contrNote();
  return out;
}

/** 間接疑問の語順ミス：答えでは「疑問詞 + be/助動詞」、お手本では疑問詞のあとが主語。戻り値はお手本での疑問詞の位置 + 1（なければ 0） */
function indirect(a, b) {
  for (let i = 1; i < a.length - 1; i++) {
    if (!WH.has(a[i]) || !AUX.has(a[i + 1])) continue;
    const j = b.indexOf(a[i]);
    if (j > 0 && !AUX.has(b[j + 1])) return j + 1;
  }
  return 0;
}
function prepTip(m, e) {
  const s = new Set([m, e]);
  if (s.has('at') || s.has('on') || s.has('in')) {
    if ([...s].every((w) => ['in', 'on', 'at'].includes(w))) return '時間なら at＝時刻、on＝日・曜日、in＝月・年・朝/午後。場所なら at＝地点、on＝面の上、in＝中・広い場所。';
  }
  if (s.has('to') && s.has('for')) return 'to は「行き先・相手（～へ・～に）」、for は「目的・ためになる相手（～のために）」。';
  if (s.has('by') && s.has('until')) return 'by は「～までに（期限）」、until は「～までずっと（継続）」。';
  if (s.has('with') && s.has('by')) return '道具は with、手段・交通は by（by bus）。';
  return '';
}
function formTip(m, before) {
  if (/ing$/.test(m)) return before && BE.has(before) ? 'be動詞のあとで「～している」は -ing 形。' : '前置詞のあと・enjoy / mind / finish などのあとは -ing 形です。';
  if (before === 'to') return 'to のあとは動詞の原形です。';
  if (['can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'do', 'does', 'did'].includes(before)) return `${q(before)} のあとは動詞の原形です。`;
  if (['have', 'has', 'had'].includes(before) || BE.has(before)) return `${q(before)} のあとは過去分詞です。`;
  return '';
}
