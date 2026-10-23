// クラウドとの同期の中身（Firebase に依存しない部分。テストではにせのクラウドを使う）
//   phrasebook/{uid}/data/state   … 覚えぐあい・日ごとの記録・設定
//   phrasebook/{uid}/cards/b0〜b7 … フレーズ本体（インポートした教材・マイフレーズ・削除の印）
import { mergeStates, mergeCards, mergeMeta, toBuckets, stableJSON, BUCKETS } from './merge.js';

const SYNC_SETTINGS = ['newPerDay', 'autoSpeak', 'rate', 'repeat', 'sheetId', 'sheetRemove'];

/**
 * 1回の同期：引っぱる → まぜる → ちがう分だけ送る
 * @param {import('./store.js').Store} store
 * @param {{ getState(): Promise<object|null>, getBuckets(): Promise<Record<string, object>>, setBucket(name: string, items: object): Promise<void>,
 *           setState(p: { states: object, meta: object }): Promise<void> }} api
 * @param {{ full?: boolean }} opt full＝フレーズ本体も比べる（起動・画面にもどったとき・フレーズを変えたとき）
 * @returns {Promise<{ pulledStates: number, pulledCards: number, pushedStates: number, pushedBuckets: number }>}
 */
export async function syncOnce(store, api, { full = true } = {}) {
  const data = store.data;
  let pulledCards = 0, pushedBuckets = 0;
  // 1) フレーズ本体
  if (full || data.cardsDirty) {
    const remoteB = await api.getBuckets();
    const remote = {};
    for (const items of Object.values(remoteB)) Object.assign(remote, items || {});
    const sentDirty = data.cardsDirty;
    const m = mergeCards(data.cards, data.deleted, remote);
    data.cards = m.cards; data.deleted = m.deleted; pulledCards = m.pulled.length;
    const want = toBuckets(m.merged, BUCKETS);
    for (const [name, items] of Object.entries(want)) {
      const have = remoteB[name] || {};
      if (stableJSON(items) !== stableJSON(have) && (Object.keys(items).length || Object.keys(have).length)) { await api.setBucket(name, items); pushedBuckets++; }
    }
    if (sentDirty === data.cardsDirty) data.cardsDirty = false;
  }
  // 2) 覚えぐあい・記録・設定
  const remote = (await api.getState()) || {};
  const ms = mergeStates(data.states, remote.states || {});
  data.states = ms.states;
  const mm = mergeMeta({ ...data, settings: data.settings }, { ...remote, settings: remote.settings ? { ...remote.settings } : null });
  Object.assign(data, { days: mm.days, newDays: mm.newDays, reps: mm.reps, resetAt: mm.resetAt, settings: mm.settings, settingsTs: mm.settingsTs });
  const statesPush = Object.fromEntries(ms.push.map((id) => [id, data.states[id]]));
  const meta = {
    days: data.days, newDays: data.newDays, reps: data.reps, resetAt: data.resetAt || 0,
    settings: Object.fromEntries(SYNC_SETTINGS.map((k) => [k, data.settings[k]])), settingsTs: data.settingsTs || 0,
  };
  const remoteMeta = { days: remote.days || [], newDays: remote.newDays || {}, reps: remote.reps || {}, resetAt: remote.resetAt || 0, settings: remote.settings || null, settingsTs: remote.settingsTs || 0 };
  const metaChanged = stableJSON(meta) !== stableJSON(remoteMeta);
  if (ms.push.length || metaChanged || !Object.keys(remote).length) await api.setState({ states: statesPush, meta });
  store._list = null;
  return { pulledStates: ms.pulled.length, pulledCards, pushedStates: ms.push.length, pushedBuckets, metaPulled: mm.changed };
}

/** にせのクラウド（テスト・エミュレーターなしの確認用） */
export function memoryCloud() {
  const db = { state: null, buckets: {} };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  return {
    db,
    getState: async () => (db.state ? clone(db.state) : null),
    getBuckets: async () => clone(db.buckets),
    setBucket: async (name, items) => { db.buckets[name] = clone(items); },
    setState: async ({ states, meta }) => { db.state = { ...(db.state || {}), ...clone(meta), states: { ...((db.state || {}).states || {}), ...clone(states) } }; },
  };
}
