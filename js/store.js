// 端末の中の記録（localStorage）。フレーズ・覚えぐあい・設定をまとめて1つに保存します。
import { schedule, dayIndex, cardStatus, MASTERED_DAYS } from './srs.js';
import { SAMPLE_PHRASES, MY_LESSON } from './data.js';

export const KEY = 'english-phrases-v1';
export const DEFAULT_SETTINGS = { newPerDay: 10, autoSpeak: true, rate: 0.9, useMic: true, repeat: true };

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
  return { v: 1, cards, states: {}, last: {}, days: [], newDays: {}, reps: {}, log: [], settings: { ...DEFAULT_SETTINGS }, created: Date.now() };
}
export function migrate(d) {
  if (!d || d.v !== 1) return emptyData();
  const e = emptyData();
  return { ...e, ...d, settings: { ...e.settings, ...(d.settings || {}) } };
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
  changed() { this._list = null; const p = this.adapter.save(this.data); for (const f of this.listeners) try { f(); } catch {} return p; }
  get settings() { return this.data.settings; }
  setSetting(k, v) { this.data.settings[k] = v; return this.changed(); }
  state(id) { return this.data.states[id] || null; }

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
  addItems(items) {
    let added = 0, updated = 0;
    for (const it of items) {
      if (this.data.cards[it.id]) updated++; else added++;
      this.data.cards[it.id] = { ...this.data.cards[it.id], ...it };
    }
    this.changed();
    return { added, updated };
  }
  saveCard({ id, japanese, english, note = '', lesson = '' }) {
    japanese = String(japanese || '').trim(); english = String(english || '').trim();
    if (!japanese || !english) throw new Error('日本語と英語の両方を入れてください');
    if (id && this.data.cards[id]) Object.assign(this.data.cards[id], { japanese, english, note: String(note).trim(), ...(lesson ? { lesson } : {}) });
    else {
      id = 'u' + rid();
      const order = Object.values(this.data.cards).filter((c) => c.src === 'mine').length;
      this.data.cards[id] = { id, japanese, english, note: String(note).trim(), lesson: lesson || MY_LESSON, theme: '自分で追加', step: '', src: 'mine', order };
    }
    this.changed();
    return id;
  }
  deleteCard(id) { delete this.data.cards[id]; delete this.data.states[id]; delete this.data.last[id]; delete this.data.reps[id]; return this.changed(); }
  deleteSource(src) {
    for (const c of Object.values(this.data.cards)) if (c.src === src) { delete this.data.cards[c.id]; delete this.data.states[c.id]; delete this.data.last[c.id]; delete this.data.reps[c.id]; }
    return this.changed();
  }

  newLeft(today = dayIndex()) { return Math.max(0, (this.settings.newPerDay | 0) - (this.data.newDays[today] || 0)); }

  /** 自己採点を記録 */
  grade(id, g, today = dayIndex(), now = Date.now()) {
    const prev = this.state(id);
    if (cardStatus(prev) === 'new') this.data.newDays[today] = (this.data.newDays[today] || 0) + 1;
    this.data.states[id] = schedule(prev, g, today);
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
    const cards = this.cards; const st = this.data.states;
    let mastered = 0, learning = 0, fresh = 0, due = 0;
    for (const c of cards) {
      const s = cardStatus(st[c.id]);
      if (s === 'mastered') mastered++; else if (s === 'learning') learning++; else fresh++;
      if (st[c.id] && st[c.id].seen && st[c.id].due <= today) due++;
    }
    const repeated = cards.filter((c) => this.data.reps[c.id]).length;
    const todayCount = this.data.log.filter((e) => dayIndex(new Date(e.t)) === today).length;
    return { total: cards.length, mastered, learning, fresh, due, repeated, todayCount, newLeft: this.newLeft(today), masteredDays: MASTERED_DAYS };
  }
  /** レッスンごと（並び順のまま） */
  lessons() {
    const map = new Map();
    for (const c of this.cards) {
      if (!map.has(c.lesson)) map.set(c.lesson, { name: c.lesson, theme: c.theme || '', total: 0, seen: 0, mastered: 0, repeated: 0, due: 0 });
      const L = map.get(c.lesson); const s = this.data.states[c.id];
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
    this.data = migrate(b.data);
    return this.changed();
  }
  resetProgress() { Object.assign(this.data, { states: {}, last: {}, days: [], newDays: {}, reps: {}, log: [] }); return this.changed(); }
}
