// 端末の中の記録（localStorage）。フレーズ・覚えぐあい・設定をまとめて1つに保存します。
import { schedule, dayIndex, cardStatus, MASTERED_DAYS, isRelearn } from './srs.js';
import { SAMPLE_PHRASES, MY_LESSON } from './data.js';

export const KEY = 'english-phrases-v1';
// sheetId：読みこむ Google スプレッドシート（URL か ID。クラウドの設定に保存し、アプリのファイルには入れない）
// sheetRemove：シートから消した行を、アプリからも消すか
export const DEFAULT_SETTINGS = { newPerDay: 10, autoSpeak: true, rate: 0.9, useMic: true, repeat: true, sheetId: '', sheetRemove: false };

export function memoryAdapter(init = null) {
  let v = init ? JSON.parse(JSON.stringify(init)) : null;
  return { load: async () => (v ? JSON.parse(JSON.stringify(v)) : null), save: async (d) => { v = JSON.parse(JSON.stringify(d)); }, peek: () => v };
}
export function localAdapter(key = KEY) {
  return {
    load: async () => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
    save: async (d) => { try { localStorage.setItem(key, JSON.stringify(d)); } catch (e) { console.warn('save failed', e); throw e; } },
  };
}

export function emptyData() {
  const cards = {};
  for (const s of SAMPLE_PHRASES) cards[s.id] = { ...s };
  // ts：最後に変えた時刻（クラウドと端末をまぜるときに、新しい方を残す）。サンプルは ts 0
  return { v: 1, cards, deleted: {}, states: {}, last: {}, days: [], newDays: {}, reps: {}, log: [], settings: { ...DEFAULT_SETTINGS }, settingsTs: 0,
    resetAt: 0, cardsDirty: false, cloud: null, created: Date.now() };
}
export function migrate(d) {
  if (!d || d.v !== 1) return emptyData();
  const e = emptyData();
  return { ...e, ...d, deleted: d.deleted || {}, settings: { ...e.settings, ...(d.settings || {}) } };
}

const SRC_RANK = { import: 0, mine: 1, sample: 2 };
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export class Store {
  constructor(adapter = localAdapter()) { this.adapter = adapter; this.data = emptyData(); this._list = null; this.listeners = new Set(); }
  async init() {
    this.data = migrate(await this.adapter.load());
    if (globalThis.navigator?.storage?.persist) navigator.storage.persist().catch(() => {});
    return this;
  }
  onChange(fn) { this.listeners.add(fn); }
  save() { return this.adapter.save(this.data); }
  changed() { this._list = null; const p = this.adapter.save(this.data); for (const f of this.listeners) try { f(); } catch {} return p; }
  get settings() { return this.data.settings; }
  setSetting(k, v) { this.data.settings[k] = v; this.data.settingsTs = Date.now(); return this.changed(); }
  /** まだ練習していない（リセットの印 {seen:0} もふくむ）なら null */
  state(id) { const s = this.data.states[id]; return s && s.seen ? s : null; }
  /** フレーズごとの最後の自己採点（苦手の判定用） */
  get lastGrades() {
    const out = { ...this.data.last };
    for (const [id, s] of Object.entries(this.data.states)) if (s && s.seen && s.lg) out[id] = s.lg; else if (s && !s.seen) delete out[id];
    return out;
  }
  /** SRS の計算に渡す状態（リセットの印はのぞく） */
  get states() {
    const out = {};
    for (const [id, s] of Object.entries(this.data.states)) if (s && s.seen) out[id] = s;
    return out;
  }
  markCards() { this.data.cardsDirty = true; }

  /** フレーズを並び順で（インポート（ファイルの順）→ マイフレーズ → サンプル） */
  get cards() {
    if (!this._list) {
      this._list = Object.values(this.data.cards).sort((a, b) =>
        (SRC_RANK[a.src] ?? 1) - (SRC_RANK[b.src] ?? 1) || (a.order ?? 0) - (b.order ?? 0));
    }
    return this._list;
  }
  card(id) { return this.data.cards[id] || null; }
  hasImported() { return this.cards.some((c) => c.src === 'import'); }

  /** フレーズを追加（同じ id は上書き。覚えぐあいはそのまま） */
  addItems(items, now = Date.now()) {
    let added = 0, updated = 0;
    const same = (a, b) => ['japanese', 'english', 'lesson', 'theme', 'step', 'note', 'order', 'from'].every((k) => (a[k] ?? '') === (b[k] ?? ''));
    for (const it of items) {
      const prev = this.data.cards[it.id];
      if (prev && same(prev, it)) continue; // 同じ内容なら何もしない（クラウドにも送らない）
      if (prev) updated++; else added++;
      this.data.cards[it.id] = { ...prev, ...it, ts: now };
      delete this.data.deleted[it.id];
    }
    if (added || updated) { this.markCards(); this.changed(); }
    return { added, updated };
  }
  /**
   * スプレッドシートの中身をまとめる：新しい行・変わった行は追加・上書き（覚えぐあいはそのまま）
   * removeMissing のときだけ、前にシートから来て、今のシートにない行を削除する
   * （シートを取りちがえたときに全部消えないよう、今のシートと1行も重ならなければ削除しない）
   */
  applySheet(items, { removeMissing = false, now = Date.now() } = {}) {
    const ids = new Set(items.map((x) => x.id));
    const prev = Object.values(this.data.cards).filter((c) => c.from === 'sheet');
    const r = this.addItems(items, now);
    let removed = 0, removeSkipped = false;
    if (removeMissing) {
      const gone = prev.filter((c) => !ids.has(c.id));
      if (gone.length && gone.length === prev.length) removeSkipped = true;
      else if (gone.length) { for (const c of gone) this._del(c.id, now); removed = gone.length; this.markCards(); this.changed(); }
    }
    this.data.sheetPull = { at: now, rows: items.length, ...r, removed };
    this.save();
    return { ...r, removed, removeSkipped };
  }
  saveCard({ id, japanese, english, note = '', lesson = '' }) {
    japanese = String(japanese || '').trim(); english = String(english || '').trim();
    if (!japanese || !english) throw new Error('日本語と英語の両方を入れてください');
    const ts = Date.now();
    if (id && this.data.cards[id]) this.data.cards[id] = { ...this.data.cards[id], japanese, english, note: String(note).trim(), ...(lesson ? { lesson } : {}), ts };
    else {
      id = 'u' + rid();
      const order = Object.values(this.data.cards).filter((c) => c.src === 'mine').length;
      this.data.cards[id] = { id, japanese, english, note: String(note).trim(), lesson: lesson || MY_LESSON, theme: '自分で追加', step: '', src: 'mine', order, ts };
    }
    this.markCards(); this.changed();
    return id;
  }
  _del(id, ts) { delete this.data.cards[id]; delete this.data.last[id]; this.data.deleted[id] = ts; }
  deleteCard(id) { this._del(id, Date.now()); this.markCards(); return this.changed(); }
  deleteSource(src) {
    const ts = Date.now();
    for (const c of Object.values(this.data.cards)) if (c.src === src) this._del(c.id, ts);
    this.markCards(); return this.changed();
  }
  /** 覚えぐあいだけリセット（このフレーズ） */
  resetCard(id) { this.data.states[id] = { seen: 0, ts: Date.now() }; delete this.data.last[id]; return this.changed(); }

  newLeft(today = dayIndex()) { return Math.max(0, (this.settings.newPerDay | 0) - (this.data.newDays[today] || 0)); }

  /** 自己採点を記録 */
  grade(id, g, today = dayIndex(), now = Date.now()) {
    const prev = this.state(id);
    if (cardStatus(prev) === 'new') this.data.newDays[today] = (this.data.newDays[today] || 0) + 1;
    this.data.states[id] = { ...schedule(prev, g, today), ts: now, lg: g };
    this.data.last[id] = g;
    if (!this.data.days.includes(today)) this.data.days.push(today);
    this.data.log.push({ t: now, id, g });
    if (this.data.log.length > 5000) this.data.log.splice(0, this.data.log.length - 5000);
    return this.changed();
  }
  /** 3回リピートが終わった */
  repeatDone(id) { this.data.reps[id] = (this.data.reps[id] || 0) + 1; return this.changed(); }

  /** 進み具合 */
  stats(today = dayIndex()) {
    const cards = this.cards; const st = this.states;
    let mastered = 0, learning = 0, fresh = 0, due = 0, relearn = 0;
    for (const c of cards) {
      const s = cardStatus(st[c.id]);
      if (s === 'mastered') mastered++; else if (s === 'learning') learning++; else fresh++;
      // 今日まちがえて「もう一回」になったものは、まだやっていない復習（due）とは別に数える（ホームの数が減らないように）
      if (isRelearn(st[c.id], today)) relearn++;
      else if (st[c.id] && st[c.id].seen && st[c.id].due <= today) due++;
    }
    const repeated = cards.filter((c) => this.data.reps[c.id]).length;
    const todayCount = this.data.log.filter((e) => dayIndex(new Date(e.t)) === today).length;
    return { total: cards.length, mastered, learning, fresh, due, relearn, repeated, todayCount, newLeft: this.newLeft(today), masteredDays: MASTERED_DAYS };
  }
  /** レッスンごと（並び順のまま） */
  lessons() {
    const map = new Map();
    for (const c of this.cards) {
      if (!map.has(c.lesson)) map.set(c.lesson, { name: c.lesson, theme: c.theme || '', total: 0, seen: 0, mastered: 0, repeated: 0, due: 0 });
      const L = map.get(c.lesson); const s = this.state(c.id);
      L.total++; if (s && s.seen) L.seen++; if (cardStatus(s) === 'mastered') L.mastered++; if (this.data.reps[c.id]) L.repeated++;
      if (s && s.seen && s.due <= dayIndex()) L.due++;
    }
    return [...map.values()];
  }

  /** バックアップ（フレーズ・覚えぐあい・設定ぜんぶ）。この端末の中だけで作られるファイルです */
  exportBackup() {
    return { app: 'english-phrases', type: 'backup', v: 1, exported: new Date().toISOString(), data: this.data };
  }
  /** バックアップから元にもどす（今の記録は置きかえ） */
  restoreBackup(b) {
    if (!b || b.app !== 'english-phrases' || b.type !== 'backup' || !b.data) throw new Error('このアプリのバックアップではありません');
    const cloud = this.data.cloud; // ログインのつながりはこの端末のまま
    this.data = migrate(b.data);
    this.data.cloud = cloud;
    // もどした内容を新しい変更としてクラウドにも伝える
    const now = Date.now();
    for (const c of Object.values(this.data.cards)) c.ts = Math.max(c.ts || 0, now);
    for (const s of Object.values(this.data.states)) if (s) s.ts = Math.max(s.ts || 0, now);
    this.data.settingsTs = now; this.markCards();
    return this.changed();
  }
  /** 覚えぐあいの記録をすべてリセット（ほかの端末にも伝わるように、リセットの印と時刻を残す） */
  resetProgress(now = Date.now()) {
    const states = {};
    for (const id of Object.keys(this.data.states)) states[id] = { seen: 0, ts: now };
    Object.assign(this.data, { states, last: {}, days: [], newDays: {}, reps: {}, log: [], resetAt: now });
    return this.changed();
  }
}
