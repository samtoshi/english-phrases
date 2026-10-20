// 勉強の順番（モードごとの出題リスト）と、5問ずつのセットの進み方
import { buildQueue, cardStatus, isDue } from './srs.js';

export const SET_SIZE = 5;
export const SETS_BEFORE_CONFIRM = 5;

export function shuffle(a, rnd = Math.random) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

/** 苦手：まちがえたことがある・最後が「もう一回／難しい」・覚えやすさ（EF）が低い */
export function isWeak(state, lastGrade) {
  if (!state || !state.seen) return false;
  return state.lapses > 0 || lastGrade === 'again' || lastGrade === 'hard' || state.ef < 2.3;
}

/**
 * 出題リストを作る
 * @param {'today'|'random'|'lesson'|'weak'} mode
 * @param {Array} cards  フレーズ（order 順）
 * @param {object} ctx { states, today, newLeft, lastGrades, lesson, rnd }
 */
export function buildList(mode, cards, ctx) {
  const { states = {}, today = 0, newLeft = 10, lastGrades = {}, lesson = '', rnd = Math.random } = ctx || {};
  if (mode === 'today') return buildQueue(cards, states, today, newLeft).map((c) => c.id);
  if (mode === 'random') return shuffle(cards, rnd).map((c) => c.id);
  if (mode === 'lesson') {
    const inL = cards.filter((c) => c.lesson === lesson);
    // 期限がきた復習 → まだやっていない → それ以外（順番どおり）
    const rank = (c) => (isDue(states[c.id], today) ? 0 : cardStatus(states[c.id]) === 'new' ? 1 : 2);
    return inL.map((c, i) => [c, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([c]) => c.id);
  }
  if (mode === 'weak') {
    return cards.filter((c) => isWeak(states[c.id], lastGrades[c.id]))
      .sort((a, b) => (states[a.id].ef - states[b.id].ef) || (states[b.id].lapses - states[a.id].lapses)).map((c) => c.id);
  }
  throw new Error('unknown mode ' + mode);
}

/**
 * 1回の勉強（5問ずつ）。「もう一回」のフレーズは、そのセッションの最後にもう一度（2回まで）
 */
export class Session {
  constructor(ids, { mode = 'today', label = '' } = {}) {
    this.queue = ids.slice(); this.i = 0; this.mode = mode; this.label = label;
    this.answered = 0; this.correct = 0; this.mastered = new Set(); this.requeued = {};
  }
  get current() { return this.queue[this.i] ?? null; }
  get left() { return this.queue.length - this.i; }
  /** 今のセットの何問目か（1〜5）・何セット目か */
  get posInSet() { return (this.answered % SET_SIZE) + 1; }
  get setNo() { return Math.floor(this.answered / SET_SIZE) + 1; }
  grade(g) {
    const id = this.current; if (id == null) return;
    this.answered++;
    if (g === 'good' || g === 'easy') this.correct++;
    if (g === 'again' && (this.requeued[id] || 0) < 2) { this.requeued[id] = (this.requeued[id] || 0) + 1; this.queue.push(id); }
  }
  master(id) { this.mastered.add(id); }
  /** 次へ。戻り値：'next'（続けて出す）| 'setEnd'（続ける？）| 'bigEnd'（5セット終わり：もう一度確認）| 'done'（もう問題がない） */
  advance() {
    this.i++;
    if (this.current == null) return 'done';
    if (this.answered % SET_SIZE === 0) return this.answered % (SET_SIZE * SETS_BEFORE_CONFIRM) === 0 ? 'bigEnd' : 'setEnd';
    return 'next';
  }
}
