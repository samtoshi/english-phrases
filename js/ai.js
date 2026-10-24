// 「AIに質問」：Firebase AI Logic（Gemini Developer API）に質問して、日本語＋英語の例文で答えてもらう。
// - APIキーはアプリに書かない。Firebase のプロジェクト（anki-54902）の AI Logic を使い、App Check（reCAPTCHA Enterprise）で守る
// - ログインしているときだけ使える（ボタンもログイン中だけ出す）
// - 送るもの：質問・いまのフレーズ（日本語・英語）・自分の答え・ルールの説明だけ。名前やメールは送らない。保存もしない
import { aiModels } from './firebase-config.js';
import { loadFirebase, SDK_VERSION } from './cloud.js';

export const SYSTEM = [
  'あなたは、日本人の大人（社会人）に英会話を教える、わかりやすくて親しみやすい英語の先生です。',
  '・答えは日本語で書き、英語の例文を2〜4個入れてください。例文は1行ずつ「・英文（日本語訳）」の形にします。',
  '・文法用語はかんたんに説明し、ネイティブがよく使う自然な言い方・場面（ていねい／カジュアル）のちがいも教えてください。',
  '・全体で400字くらいまで。見出しや表は使わず、強調は **ことば** だけにしてください。',
  '・英語や英会話と関係のない質問には、ひとことで断ってください。',
].join('\n');

/** 質問に添える、いまのフレーズの情報 */
export function contextText(ctx = {}) {
  if (!ctx || !ctx.english) return '';
  return [
    '【いま練習しているフレーズ】',
    ctx.japanese ? `日本語：${ctx.japanese}` : '',
    `英語（お手本）：${ctx.english}`,
    ctx.answer ? `学習者の答え：${ctx.answer}` : '',
    ctx.notes && ctx.notes.length ? `アプリの自動チェック：${ctx.notes.join(' / ')}` : '',
  ].filter(Boolean).join('\n');
}

/** Gemini に送る内容（会話のつづきも送る） */
export function buildContents(history, question, ctx) {
  const c = contextText(ctx);
  const msgs = history.map((m) => ({ role: m.role === 'ai' ? 'model' : 'user', parts: [{ text: m.text }] }));
  const first = !history.length && c ? `${c}\n\n【質問】${question}` : question;
  return [...msgs, { role: 'user', parts: [{ text: first }] }];
}

function fakeAI() {
  try { if (!['localhost', '127.0.0.1'].includes(location.hostname)) return null; return localStorage.getItem('english-phrases:fake-ai'); } catch { return null; }
}

let aiP = null;
async function aiInstance() {
  if (!aiP) aiP = (async () => {
    const fb = await loadFirebase();
    const ai = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-ai.js`);
    return { fb, ai, inst: ai.getAI(fb.app, { backend: new ai.GoogleAIBackend() }) };
  })().catch((e) => { aiP = null; throw e; });
  return aiP;
}
const models = new Map();
async function modelFor(name) {
  if (!models.has(name)) {
    const { ai, inst } = await aiInstance();
    models.set(name, ai.getGenerativeModel(inst, {
      model: name,
      systemInstruction: SYSTEM,
      generationConfig: { maxOutputTokens: 2500, temperature: 0.5, thinkingConfig: { thinkingBudget: 256 } }, // 考える分もふくむ
    }));
  }
  return models.get(name);
}

/**
 * 質問する
 * @param {Array<{role:'me'|'ai', text:string}>} history  これまでのやりとり
 * @returns {Promise<string>} 答え（ふつうの文字）
 */
export async function askAI(question, { history = [], ctx = null, timeout = 30000 } = {}) {
  const fake = fakeAI(); // テスト用（localhost だけ）
  if (fake) { await new Promise((r) => setTimeout(r, 200)); return fake; }
  const { fb } = await aiInstance();
  if (!fb.auth.currentUser) throw Object.assign(new Error('ログインしてください'), { code: 'ai-login' });
  const contents = buildContents(history, question, ctx);
  const list = aiModels.filter((m) => !skipped().includes(m));
  let last = null;
  for (const name of list) {
    try {
      const model = await modelFor(name);
      const res = await withTimeout(model.generateContent({ contents }), timeout);
      const text = res.response.text();
      if (!text.trim()) throw Object.assign(new Error('空の答え'), { code: 'ai-empty' });
      return text.trim();
    } catch (e) {
      last = e;
      const k = aiErrorKind(e);
      if (e.code === 'ai-empty') continue;
      if (k === 'quota' || k === 'model') { skip(name); continue; }
      throw Object.assign(e, { code: 'ai-' + k });
    }
  }
  throw Object.assign(new Error('AIが使えませんでした'), { code: 'ai-quota', cause: last });
}

/** エラーの種類：billing・quota（今日の上限）・model（そのモデルが使えない）・appcheck・disabled・offline・other */
export function aiErrorKind(e) {
  const t = `${e?.code || ''} ${e?.message || ''} ${e?.customErrorData?.status || ''}`;
  if (/prepayment|credits are depleted|billing/i.test(t)) return 'billing';
  if (/\b429\b|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(t)) return 'quota';
  if (/\b404\b|NOT_FOUND|not found|not supported/i.test(t)) return 'model';
  if (/api-not-enabled|SERVICE_DISABLED|has not been used|is disabled/i.test(t)) return 'disabled';
  if (/App ?Check|appCheck|\b401\b/i.test(t)) return 'appcheck';
  if ((typeof navigator !== 'undefined' && !navigator.onLine) || /Failed to fetch|NetworkError|network|timeout|時間切れ/i.test(t)) return 'offline';
  return 'other';
}
export const AI_ERR = {
  'ai-login': 'AIに質問するには、設定からログインしてください。',
  'ai-quota': '今日はAIの無料枠の上限に達したようです。明日また使えます。',
  'ai-billing': 'AIの利用料金（Google Cloud の支払い設定）に問題があるようです。',
  'ai-disabled': 'Firebase の AI Logic が有効になっていないようです。',
  'ai-appcheck': 'App Check の確認に失敗しました。ページを読みなおしてもう一度どうぞ。',
  'ai-offline': 'つながりませんでした（電波・時間切れ）。もう一度どうぞ。',
};

const SKIP_KEY = 'english-phrases:ai-skip';
const today = () => new Date().toLocaleDateString('sv-SE');
function skipped() { try { const s = JSON.parse(localStorage.getItem(SKIP_KEY) || '{}'); return s.day === today() ? s.models || [] : []; } catch { return []; } }
function skip(name) { const m = new Set(skipped()); m.add(name); try { localStorage.setItem(SKIP_KEY, JSON.stringify({ day: today(), models: [...m] })); } catch {} }
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('時間切れ'), { code: 'timeout' })), ms))]);
}

/** 答えを画面用の HTML に（エスケープしてから **太字** と改行だけ） */
export function aiHtml(text) {
  const e = String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return e.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/^\s*[*-]\s+/gm, '・').replace(/\n/g, '<br>');
}
