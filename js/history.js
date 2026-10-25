// 進み具合のグラフ：「覚えた」「練習中」「3回リピート済」の数の、日ごとの移り変わり
//  ・hist（日ごとの記録）：採点したとき・進み具合を開いたときに、その日の数を残す（クラウドにも同期）
//  ・hist がない前の日は、この端末の採点の記録（log）から覚えぐあいを計算しなおして補う
import { schedule, dayIndex, cardStatus, dayToISO } from './srs.js';

/** 今の数 { m: 覚えた, l: 練習中, r: 3回リピート済 } */
export function snapshotOf(cards, states, reps = {}) {
  let m = 0, l = 0, r = 0;
  for (const c of cards) {
    const s = cardStatus(states[c.id]);
    if (s === 'mastered') m++; else if (s === 'learning') l++;
    if (reps[c.id]) r++;
  }
  return { m, l, r };
}

/**
 * 採点の記録をはじめから計算しなおして、その日の終わりの「覚えた」「練習中」の数を出す
 * @param {{t:number,id:string,g:string}[]} log
 * @param {Set<string>|string[]} ids 今あるフレーズ（消したフレーズは数えない）
 * @returns {Record<number, {m:number,l:number}>} 採点があった日だけ
 */
export function replayLog(log = [], ids = []) {
  const have = ids instanceof Set ? ids : new Set(ids);
  const states = {}; const out = {};
  const entries = log.filter((e) => e && e.g && have.has(e.id)).slice().sort((a, b) => a.t - b.t);
  let m = 0, l = 0;
  for (const e of entries) {
    const day = dayIndex(new Date(e.t));
    const before = cardStatus(states[e.id]);
    try { states[e.id] = schedule(states[e.id] || null, e.g, day); } catch { continue; }
    const after = cardStatus(states[e.id]);
    if (before === 'mastered') m--; else if (before === 'learning') l--;
    if (after === 'mastered') m++; else if (after === 'learning') l++;
    out[day] = { m, l };
  }
  return out;
}

/** 端末どうしの日ごとの記録をまぜる：日ごとに、あとで記録した方 */
export function mergeHist(local = {}, remote = {}) {
  const out = { ...local }; let changed = false;
  for (const [k, v] of Object.entries(remote || {})) {
    if (!v) continue;
    if (!out[k] || (v.ts || 0) > (out[k].ts || 0)) { out[k] = v; changed = true; }
  }
  return { hist: out, changed };
}

/**
 * グラフの点（1日1点）。今日は今の数・記録がある日は記録・それより前は log から計算・どちらもない日は前の日と同じ
 * @param {{ hist?: object, replay?: object, current: {m,l,r}, today: number, days?: number|0 }} p days：直近の日数（0＝全期間）
 * @returns {{ day:number, iso:string, m:number, l:number, r:number|null, est:boolean }[]}
 */
export function buildSeries({ hist = {}, replay = {}, current, today, days = 0 }) {
  const hk = Object.keys(hist).map(Number).filter((d) => d <= today);
  const firstHist = hk.length ? Math.min(...hk) : today;
  const rk = Object.keys(replay).map(Number).filter((d) => d < firstHist);
  const start = Math.min(today, firstHist, ...(rk.length ? [Math.min(...rk)] : []));
  const from = days > 0 ? Math.max(start, today - days + 1) : start;
  const out = [];
  let prev = { m: 0, l: 0, r: null, est: true };
  for (let d = start; d <= today; d++) {
    let p;
    if (d === today) p = { ...current, est: false };
    else if (hist[d]) p = { m: hist[d].m | 0, l: hist[d].l | 0, r: hist[d].r ?? null, est: false };
    else if (d < firstHist && replay[d]) p = { ...replay[d], r: null, est: true };
    else p = { ...prev };
    prev = p;
    if (d >= from) out.push({ day: d, iso: dayToISO(d), ...p });
  }
  return out;
}

const niceMax = (v) => {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v)); const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : 10) * p; // 真ん中の目もりが整数になるように
};
const md = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;

/** 積み上げ面グラフ（下：覚えた／上：練習中）＋ 3回リピート済の線。外部ライブラリなしの SVG */
export function chartSvg(series, { w = 340, h = 180 } = {}) {
  if (!series.length) return '';
  const pts = series.length === 1 ? [{ ...series[0] }, { ...series[0] }] : series;
  const L = 30, R = 8, T = 10, B = 22, iw = w - L - R, ih = h - T - B;
  const ymax = niceMax(Math.max(1, ...pts.map((p) => Math.max(p.m + p.l, p.r || 0))));
  const x = (i) => L + (pts.length === 1 ? 0 : (i * iw) / (pts.length - 1));
  const y = (v) => T + ih - (v / ymax) * ih;
  const f = (n) => n.toFixed(1);
  const line = (vals) => vals.map((v, i) => `${f(x(i))},${f(y(v))}`).join(' ');
  const area = (top, bot) => `${line(top)} ${bot.map((v, i) => `${f(x(i))},${f(y(v))}`).reverse().join(' ')}`;
  const M = pts.map((p) => p.m), ML = pts.map((p) => p.m + p.l), Z = pts.map(() => 0);
  const grid = [0, 0.5, 1].map((k) => { const v = Math.round(ymax * k); return `<line x1="${L}" x2="${w - R}" y1="${f(y(v))}" y2="${f(y(v))}" class="g"/><text x="${L - 4}" y="${f(y(v) + 4)}" text-anchor="end">${v}</text>`; }).join('');
  // リピートの線は、記録がある日だけ（つながっている区間ごと）
  let rep = ''; let seg = [];
  const flush = () => { if (seg.length) rep += seg.length === 1 ? `<circle cx="${seg[0][0]}" cy="${seg[0][1]}" r="2.5" class="rp"/>` : `<polyline points="${seg.map((s) => s.join(',')).join(' ')}" class="r"/>`; seg = []; };
  pts.forEach((p, i) => { if (p.r == null) flush(); else seg.push([f(x(i)), f(y(p.r))]); }); flush();
  const est = series.findIndex((p) => !p.est);
  const estEnd = series.length > 1 && est > 0 ? `<rect x="${L}" y="${T}" width="${f(x(est) - L)}" height="${ih}" class="est"/>` : '';
  const n = series.length; const labels = n === 1 ? [0] : n < 3 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];
  const xl = labels.map((i) => `<text x="${f(n === 1 ? L + iw / 2 : x(i))}" y="${h - 6}" text-anchor="${n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${md(series[i].iso)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="覚えた・練習中のフレーズ数の移り変わり">
    ${estEnd}${grid}
    <polygon points="${area(ML, M)}" class="al"/><polygon points="${area(M, Z)}" class="am"/>
    <polyline points="${line(ML)}" class="ll"/><polyline points="${line(M)}" class="lm"/>${rep}${xl}</svg>`;
}
