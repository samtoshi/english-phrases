// フレーズデータの読みこみ（JSON / CSV / TSV）と、はじめから入っているサンプル。
// アプリ本体には市販教材のフレーズは入れません。データは端末の中のファイルから読みこみます。

/** アプリに入っているサンプル（このアプリのために書いたオリジナルの会議・仕事の英語） */
export const SAMPLE_PHRASES = [
  { id: 's1', japanese: 'では、始めましょうか。', english: "Shall we get started?", note: '[会議の冒頭で]' },
  { id: 's2', japanese: 'その件は、あとで確認してご連絡します。', english: "Let me check on that and get back to you.", note: '[すぐに答えられない質問に]' },
  { id: 's3', japanese: 'もう少しゆっくり話していただけますか？', english: "Could you speak a little more slowly?", note: '' },
  { id: 's4', japanese: '要点だけ先に言うと、予定より2週間遅れています。', english: "The bottom line is, we're two weeks behind schedule.", note: '[報告の最初に結論を]' },
  { id: 's5', japanese: 'その点については、少し違う意見です。', english: "I see it a little differently.", note: '[やわらかく反対するとき]' },
  { id: 's6', japanese: '念のため、もう一度確認させてください。', english: "Just to be sure, let me confirm that again.", note: '' },
  { id: 's7', japanese: '今日はここまでにしましょう。', english: "Let's call it a day.", note: '[会議や作業を終えるとき]' },
  { id: 's8', japanese: '来週の火曜日はご都合いかがですか？', english: "Does next Tuesday work for you?", note: '[日程調整で]' },
].map((p, i) => ({ ...p, lesson: 'サンプル', theme: '会議・仕事の英語', step: '', src: 'sample', order: i }));

export const MY_LESSON = 'マイフレーズ';

/** CSV / TSV を行と列に分ける（"..." の中のカンマ・改行・"" に対応） */
export function parseCSV(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const HEAD = {
  japanese: /^(japanese|ja|jp|日本語|和文|問題|question|q)$/i,
  english: /^(english|en|英語|英文|英訳|答え|answer|a)$/i,
  lesson: /^(lesson|レッスン|課|章|unit)$/i,
  theme: /^(theme|テーマ|タイトル|title)$/i,
  step: /^(step|ステップ)$/i,
  note: /^(note|notes|メモ|ヒント|hint|場面|解説)$/i,
  id: /^(id|番号|no\.?)$/i,
};
// 見出しに説明がついているとき（「日本語（問題）」「English phrase」など）用のゆるい判定
const HEAD_LOOSE = {
  japanese: /japanese|日本語|和文/i,
  english: /english|英語|英文|英訳/i,
  lesson: /lesson|レッスン/i,
  theme: /theme|テーマ/i,
  note: /note|メモ|ヒント|解説|場面/i,
};
const hasJa = (s) => /[\u3040-\u30ff\u3400-\u9fff]/.test(s);

/** 見出しの行 → 列の番号 { japanese: 0, english: 1, ... }（日本語と英語がそろわなければ null） */
export function headerColumns(headRow) {
  const head = headRow.map((h) => String(h ?? '').trim().replace(/^\uFEFF/, ''));
  const col = {}; const used = new Set();
  for (const [k, re] of Object.entries(HEAD)) { const i = head.findIndex((h) => re.test(h)); if (i >= 0) { col[k] = i; used.add(i); } }
  for (const [k, re] of Object.entries(HEAD_LOOSE)) {
    if (col[k] != null) continue;
    const i = head.findIndex((h, j) => !used.has(j) && re.test(h));
    if (i >= 0) { col[k] = i; used.add(i); }
  }
  return col.japanese != null && col.english != null ? col : null;
}

/** 表（行×列の配列）→ フレーズ。見出しがなければ 1列目＝日本語・2列目＝英語（逆なら入れかえ） */
export function itemsFromRows(rows) {
  rows = (rows || []).map((r) => (r || []).map((x) => String(x ?? ''))).filter((r) => r.some((x) => x.trim() !== ''));
  if (!rows.length) return [];
  let col = headerColumns(rows[0]);
  let body = rows;
  if (col) body = rows.slice(1);
  else {
    const swap = rows[0].length > 1 && !hasJa(rows[0][0]) && hasJa(rows[0][1]);
    col = { japanese: swap ? 1 : 0, english: swap ? 0 : 1 };
  }
  return body.map((r) => {
    const g = (k) => (col[k] != null ? String(r[col[k]] ?? '').trim() : '');
    return { id: g('id'), japanese: g('japanese'), english: g('english'), lesson: g('lesson'), theme: g('theme'), step: g('step'), note: g('note') };
  });
}

/** CSV の行 → フレーズ */
export function itemsFromCSV(text) { return itemsFromRows(parseCSV(text)); }

/** 文字列の短いハッシュ（id がないフレーズの id に使う。同じ文なら同じ id） */
export function hashId(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/**
 * ファイルの中身 → { kind: 'items', items } か { kind: 'backup', backup }
 * JSON：フレーズの配列 / { items: [...] } / このアプリのバックアップ。それ以外は CSV・TSV として読む
 */
export function parseImport(text, filename = '') {
  const t = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!t) throw new Error('ファイルが空です');
  let items;
  if (/^[[{]/.test(t) && !/\.(csv|tsv|txt)$/i.test(filename)) {
    let j;
    try { j = JSON.parse(t); } catch { throw new Error('JSON として読めませんでした'); }
    if (j && j.app === 'english-phrases' && j.type === 'backup') return { kind: 'backup', backup: j };
    items = Array.isArray(j) ? j : Array.isArray(j?.items) ? j.items : Array.isArray(j?.cards) ? j.cards : null;
    if (!items) throw new Error('フレーズの一覧（配列）が見つかりませんでした');
  } else items = itemsFromCSV(t);
  return { kind: 'items', ...normalizeItems(items) };
}

/**
 * 読みこんだ行 → アプリのフレーズ（id をそろえる・日本語か英語がない行と、同じ id の2つめはとばす）
 * id があれば 'i' + id、なければ 'i' + 日本語と英語のハッシュ（同じ文なら何度読んでも同じ id）
 */
export function normalizeItems(items, { lesson = 'インポート', from = '' } = {}) {
  const out = []; const seen = new Set(); let skipped = 0;
  items.forEach((x, i) => {
    const japanese = String(x?.japanese ?? x?.ja ?? x?.jp ?? '').trim();
    const english = String(x?.english ?? x?.en ?? '').trim();
    if (!japanese || !english) { skipped++; return; }
    const raw = x.id != null && String(x.id).trim() !== '' ? String(x.id).trim() : '';
    // id はクラウドのフィールド名にも使うので、英数字・_・- だけにする
    const id = 'i' + (raw ? raw.replace(/[^\w-]/g, '_').slice(0, 80) : hashId(japanese + '\n' + english));
    if (seen.has(id)) { skipped++; return; }
    seen.add(id);
    out.push({ id, japanese, english, lesson: String(x.lesson || '').trim() || lesson, theme: String(x.theme || '').trim(),
      step: String(x.step || '').trim(), note: String(x.note || '').trim(), src: 'import', order: i, ...(from ? { from } : {}) });
  });
  if (!out.length) throw new Error('日本語と英語の両方がある行が見つかりませんでした');
  return { items: out, skipped };
}

/** note が [ ... ] なら「場面のヒント」（答えの前に出す）、それ以外は「解説」（答えのあとに出す） */
export function splitNote(note) {
  const n = String(note || '').trim();
  const m = n.match(/^\[([^\]]+)\]\s*(.*)$/s);
  if (m) return { hint: m[1].trim(), memo: m[2].trim() };
  return { hint: '', memo: n };
}

/** レッスンの並び順（Lesson 1, 2, … 10、Bonus、Coffee Break は数字で） */
export function lessonKey(name) {
  const m = String(name).match(/(\d+)/);
  return m ? +m[1] : 9999;
}
