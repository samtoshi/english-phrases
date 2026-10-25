import { mergeHist } from './history.js';
// 端末どうし（とクラウド）の記録をまぜる。オフラインで別々に勉強しても大丈夫なように。
// どれも「時刻（ts）が新しい方を残す」。anki-app の merge.js と同じ考え方。

export const BUCKETS = 8;
/** フレーズを入れるクラウドのドキュメント（cards/b0〜b7）を id から決める */
export function bucketOf(id, n = BUCKETS) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return 'b' + (h % n);
}

/** フレーズの覚えぐあい：フレーズごとに、最後に採点した方 */
export function mergeStates(local = {}, remote = {}) {
  const states = { ...local };
  const pulled = [], push = [];
  for (const id of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const a = local[id], b = remote[id];
    if (a && !b) { push.push(id); continue; }
    if (!a && b) { states[id] = b; pulled.push(id); continue; }
    const ta = a.ts || 0, tb = b.ts || 0;
    if (tb > ta) { states[id] = b; pulled.push(id); }
    else if (ta > tb) push.push(id);
  }
  return { states, pulled, push };
}

/**
 * フレーズ本体：追加・編集・削除（削除は {del:1, ts} の印で伝える）
 * @param {object} cards   この端末のフレーズ {id: card}
 * @param {object} deleted この端末で削除した印 {id: ts}
 * @param {object} remote  クラウドの {id: card | {del:1, ts}}
 * @returns {{ cards, deleted, pulled: string[], merged: object }} merged＝クラウドに置くべき中身（削除の印もふくむ）
 */
export function mergeCards(cards = {}, deleted = {}, remote = {}) {
  const out = {}, del = {}, merged = {}, pulled = [];
  const local = {};
  for (const [id, c] of Object.entries(cards)) local[id] = c;
  for (const [id, ts] of Object.entries(deleted)) if (!local[id] || (local[id].ts || 0) < ts) local[id] = { del: 1, ts };
  for (const id of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const a = local[id], b = remote[id];
    let w = a;
    if (!a) { w = b; pulled.push(id); }
    else if (b && (b.ts || 0) > (a.ts || 0)) { w = b; pulled.push(id); }
    if (w.del) del[id] = w.ts; else out[id] = w;
    merged[id] = w.del ? { del: 1, ts: w.ts } : w;
  }
  return { cards: out, deleted: del, pulled, merged };
}

/** cards のマップを、クラウドのドキュメントごとに分ける */
export function toBuckets(merged, n = BUCKETS) {
  const b = {};
  for (let i = 0; i < n; i++) b['b' + i] = {};
  for (const [id, c] of Object.entries(merged)) b[bucketOf(id, n)][id] = c;
  return b;
}

/** キーの順番によらない JSON（クラウドと同じかどうかを比べる） */
export function stableJSON(v) {
  if (Array.isArray(v)) return '[' + v.map(stableJSON).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableJSON(v[k])).join(',') + '}';
  return JSON.stringify(v ?? null);
}

/**
 * 日ごとの記録など（勉強した日・その日の新しいフレーズ数・3回リピート数・設定・リセット）
 * リセット（resetAt）が新しい方にそろえ、それより前の集計は捨てる
 */
export function mergeMeta(local, remote = {}) {
  const r = { days: remote.days || [], newDays: remote.newDays || {}, reps: remote.reps || {}, hist: remote.hist || {}, resetAt: remote.resetAt || 0, settings: remote.settings || null, settingsTs: remote.settingsTs || 0 };
  let L = { days: local.days || [], newDays: local.newDays || {}, reps: local.reps || {}, hist: local.hist || {}, resetAt: local.resetAt || 0 };
  let changed = false;
  if (r.resetAt > L.resetAt) { L = { days: [], newDays: {}, reps: {}, hist: {}, resetAt: r.resetAt }; changed = true; }
  const useRemote = r.resetAt >= L.resetAt;
  const days = [...new Set([...L.days, ...(useRemote ? r.days : [])].map(Number))].sort((a, b) => a - b);
  const newDays = { ...L.newDays };
  const reps = { ...L.reps };
  let hist = { ...L.hist };
  if (useRemote) {
    const mh = mergeHist(L.hist, r.hist); hist = mh.hist; if (mh.changed) changed = true;
    for (const [k, v] of Object.entries(r.newDays)) if ((newDays[k] || 0) < v) { newDays[k] = v; changed = true; }
    for (const [k, v] of Object.entries(r.reps)) if ((reps[k] || 0) < v) { reps[k] = v; changed = true; }
  }
  if (days.length !== (local.days || []).length) changed = true;
  let settings = local.settings, settingsTs = local.settingsTs || 0;
  if (r.settings && r.settingsTs > settingsTs) {
    // マイクを使うかどうかは端末ごと（同期しない）
    settings = { ...local.settings, ...r.settings, useMic: local.settings?.useMic }; settingsTs = r.settingsTs; changed = true;
  }
  return { days, newDays, reps, hist, resetAt: L.resetAt, settings, settingsTs, changed };
}
