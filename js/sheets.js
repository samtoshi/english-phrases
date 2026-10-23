// Google スプレッドシートからフレーズを読みこむ（読み取りだけ）。
// - 使う権限は spreadsheets.readonly（読むだけ。書きかえ・ほかのファイルには触れない）
// - シートは本人の Google ドライブの中のまま（公開しない）。読むのはログインした本人のトークンで
// - シートの URL / ID はクラウドの設定に保存（このアプリのファイルには入れない）
import { itemsFromRows, normalizeItems } from './data.js';

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const API = 'https://sheets.googleapis.com/v4/spreadsheets/';
export const SHEET_LESSON = 'シート';

/** 「https://docs.google.com/spreadsheets/d/<ID>/edit#gid=123」や ID だけ → { id, gid } */
export function parseSheetRef(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  const id = m ? m[1] : (s.match(/^([A-Za-z0-9_-]{20,})(?:[#?&].*)?$/) || [])[1];
  if (!id) return null;
  const g = s.match(/[#?&]gid=(\d+)/);
  return { id, gid: g ? g[1] : null };
}
/** 設定に保存する形（ID と、あればタブの gid） */
export function sheetRefString(ref) { return ref ? ref.id + (ref.gid != null ? '#gid=' + ref.gid : '') : ''; }
export function sheetUrl(ref) { return ref ? `https://docs.google.com/spreadsheets/d/${ref.id}/edit${ref.gid != null ? '#gid=' + ref.gid : ''}` : ''; }

/** シートの値（行×列）→ フレーズ。見出しは CSV と同じく 日本語/英語 どちらの名前でもよい */
export function itemsFromSheet(values) {
  return normalizeItems(itemsFromRows(values), { lesson: SHEET_LESSON, from: 'sheet' });
}

export class SheetError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

async function call(url, token, fetchImpl) {
  let res;
  try { res = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + token } }); }
  catch (e) { throw new SheetError('network', e.message); }
  if (res.ok) return res.json();
  let body = {};
  try { body = await res.json(); } catch {}
  const msg = body?.error?.message || res.statusText || '';
  const reasons = JSON.stringify(body?.error?.details || []) + msg;
  if (res.status === 401) throw new SheetError('auth', msg);
  if (res.status === 403 && /SERVICE_DISABLED|has not been used|is disabled/.test(reasons)) throw new SheetError('disabled', msg);
  if (res.status === 403 && /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient.*scope/i.test(reasons)) throw new SheetError('scope', msg);
  if (res.status === 403) throw new SheetError('forbidden', msg);
  if (res.status === 404) throw new SheetError('notfound', msg);
  if (res.status === 400 && /Unable to parse range/i.test(msg)) throw new SheetError('notfound', msg);
  throw new SheetError('http' + res.status, msg);
}

/** シートの値を読む（gid があればそのタブ、なければ左はしのタブ） */
export async function fetchSheetValues(token, ref, fetchImpl = globalThis.fetch.bind(globalThis)) {
  let range = 'A:Z';
  if (ref.gid != null) {
    const meta = await call(`${API}${ref.id}?fields=sheets.properties(sheetId,title)`, token, fetchImpl);
    const tab = (meta.sheets || []).find((x) => String(x.properties?.sheetId) === String(ref.gid));
    if (tab) range = `'${tab.properties.title.replace(/'/g, "''")}'!A:Z`;
  }
  const j = await call(`${API}${ref.id}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`, token, fetchImpl);
  return j.values || [];
}

/** 読みこんでアプリのフレーズにまとめる */
export async function pullSheet(store, token, ref, { fetchImpl } = {}) {
  const values = await fetchSheetValues(token, ref, fetchImpl);
  let parsed;
  try { parsed = itemsFromSheet(values); }
  catch (e) { throw new SheetError('empty', e.message); }
  const r = store.applySheet(parsed.items, { removeMissing: !!store.settings.sheetRemove });
  return { ...r, rows: parsed.items.length, skipped: parsed.skipped };
}
