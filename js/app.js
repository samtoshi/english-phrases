// 英語フレーズ — 画面
import { GRADES, dayIndex, previewLabel, cardStatus, streak, upcoming } from './srs.js';
import { Store } from './store.js';
import { parseImport, splitNote, MY_LESSON } from './data.js';
import { judge, wordDiff, repeatOk } from './match.js';
import { buildList, Session, SET_SIZE, SETS_BEFORE_CONFIRM } from './session.js';
import { CloudSync } from './cloud.js';
import { speak, speakFromTap, stopSpeak, canSpeak, canListen, listen, armSpeechGestures, onSpeechBlocked } from './voice.js';

export const APP_VERSION = '1.1.0';
const $app = document.getElementById('app');
const $tab = document.getElementById('tabbar');
const store = new Store();
const cloud = new CloudSync(store);
let session = null;   // { s: Session, phase, card state... }
let mic = null;       // 今聞いている音声認識

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => dayIndex();
const rate = () => +store.settings.rate || 0.9;
const micUsable = () => canListen() && store.settings.useMic;

function toast(msg, ms = 2200) {
  const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function say(text, fromTap) { if (!canSpeak()) return; (fromTap ? speakFromTap : speak)(text, { rate: rate(), lang: 'en-US' }); }
function stopMic() { if (mic) { try { mic.abort(); } catch {} mic = null; } }

// ---------- ルーター ----------
function route() {
  stopMic();
  const h = location.hash.replace(/^#\/?/, '');
  const [name, arg] = h.split('/');
  if (name !== 'study') { stopSpeak(); document.body.classList.remove('studying'); }
  const views = { '': viewHome, lessons: viewLessons, study: viewStudy, progress: viewProgress, phrases: viewPhrases, edit: () => viewEdit(decodeURIComponent(arg || '')), settings: viewSettings };
  (views[name] || viewHome)();
  renderTabs(name);
  window.scrollTo(0, 0);
}
function renderTabs(name) {
  if (name === 'study') { $tab.hidden = true; return; }
  const tabs = [['', '⌂', 'ホーム'], ['progress', '▤', '進み具合'], ['phrases', '≡', 'フレーズ'], ['settings', '⚙', '設定']];
  const cur = name === 'lessons' ? '' : name === 'edit' ? 'phrases' : name;
  $tab.innerHTML = tabs.map(([k, i, l]) => `<a href="#/${k}" class="${cur === k ? 'on' : ''}"><span>${i}</span>${l}</a>`).join('');
  $tab.hidden = false;
}
const go = (h) => { if (location.hash === h) route(); else location.hash = h; };

// ---------- ホーム ----------
function viewHome() {
  const st = store.stats(today());
  const todayN = st.due + Math.min(st.newLeft, st.fresh);
  const sk = streak(store.data.days, today());
  const weakN = buildList('weak', store.cards, { states: store.states, lastGrades: store.lastGrades }).length;
  $app.innerHTML = `
    <div class="top"><h1>英語フレーズ</h1><span class="streak">連続 <b>${sk}</b> 日</span></div>
    ${store.data.cloud ? `<div class="small" id="cloudLine" style="margin-top:-6px">${esc(cloudLabel())}</div>` : ''}
    ${store.hasImported() ? '' : `<div class="banner">いまはサンプル ${st.total} 問だけです。<a href="#/settings">フレーズのファイルを読み込む</a>と、教材のフレーズで練習できます。</div>`}
    <div class="panel today">
      <div class="num">${todayN}<small> 問</small></div>
      <div class="sub">今日の復習 ${st.due} ・ 新しいフレーズ ${Math.min(st.newLeft, st.fresh)}${st.todayCount ? ` ・ 今日 ${st.todayCount} 回答済み` : ''}</div>
      <button class="btn primary big block" id="startToday" ${todayN ? '' : 'disabled'}>${todayN ? '今日の復習をはじめる' : '今日の分は終わりました'}</button>
    </div>
    <div class="modes">
      <button class="mode" id="mRandom"><b>ランダム</b><span>全${st.total}問から</span></button>
      <a class="mode" href="#/lessons"><b>レッスン</b><span>えらんで練習</span></a>
      <button class="mode" id="mWeak" ${weakN ? '' : 'disabled'}><b>苦手だけ</b><span>${weakN}問</span></button>
    </div>
    <div class="sec">覚えぐあい</div>
    <div class="panel">
      ${barHtml(st.mastered, st.learning, st.total)}
      <div class="small" style="margin-top:6px">覚えた ${st.mastered} ・ 練習中 ${st.learning} ・ まだ ${st.fresh}（全${st.total}）</div>
    </div>`;
  document.getElementById('startToday').onclick = () => startSession('today');
  document.getElementById('mRandom').onclick = () => startSession('random');
  document.getElementById('mWeak').onclick = () => startSession('weak');
}
function barHtml(m, s, total) {
  const p = (n) => (total ? (100 * n) / total : 0).toFixed(1);
  return `<div class="bar"><i class="m" style="width:${p(m)}%"></i><i class="s" style="width:${p(s)}%"></i></div>`;
}

// ---------- レッスンをえらぶ ----------
function viewLessons() {
  const ls = store.lessons();
  $app.innerHTML = `<div class="top"><a class="back" href="#/">‹</a><h1>レッスンをえらぶ</h1></div>
    <div class="list">${ls.map((L, i) => `<button class="item lesson" data-i="${i}">
      <div class="t">${esc(L.name)} <span class="m">${esc(L.theme)}</span></div>
      <div class="m">${L.total}問 ・ 練習済み ${L.seen} ・ 覚えた ${L.mastered}${L.due ? ` ・ 復習 ${L.due}` : ''}</div>
      ${barHtml(L.mastered, L.seen - L.mastered, L.total)}</button>`).join('')}</div>`;
  $app.querySelectorAll('.lesson').forEach((b) => { b.onclick = () => startSession('lesson', ls[+b.dataset.i].name); });
}

// ---------- 勉強 ----------
const MODE_LABEL = { today: '今日の復習', random: 'ランダム', lesson: 'レッスン', weak: '苦手だけ' };
function startSession(mode, lesson = '') {
  const ids = buildList(mode, store.cards, { states: store.states, today: today(), newLeft: store.newLeft(), lastGrades: store.lastGrades, lesson });
  if (!ids.length) { toast('出せるフレーズがありません'); return; }
  session = { s: new Session(ids, { mode, label: mode === 'lesson' ? lesson : MODE_LABEL[mode] }), phase: 'ask', setCorrect: 0 };
  newCard();
  go('#/study');
}
function newCard() {
  Object.assign(session, { phase: 'ask', answer: '', res: null, graded: null, reps: 0, repMsg: '', repNg: false, heard: '' });
}
function cur() { return session && store.card(session.s.current); }

function viewStudy() {
  if (!session) { go('#/'); return; }
  document.body.classList.add('studying');
  const s = session.s;
  if (['setEnd', 'bigEnd', 'done'].includes(session.phase)) return renderBreak();
  const c = cur();
  if (!c) { session.phase = 'done'; return renderBreak(); }
  const { hint, memo } = splitNote(c.note);
  const dots = Array.from({ length: SET_SIZE }, (_, i) => `<i class="${i < s.posInSet - 1 ? 'done' : i === s.posInSet - 1 ? 'cur' : ''}"></i>`).join('');
  const revealed = session.phase !== 'ask';
  $app.innerHTML = `
    <div class="study-top"><a class="back" href="#/" id="quit">×</a>
      <div class="prog"><div class="dots">${dots}</div><div class="head-meta">${esc(s.label)} ・ ${s.setNo}セット目 ・ 残り${s.left}問</div></div></div>
    <div class="qcard">
      <div class="lesson-name">${esc(c.lesson)}${c.theme ? '　' + esc(c.theme) : ''}${cardStatus(store.state(c.id)) === 'new' ? '<span class="tag">新しい</span>' : ''}</div>
      ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
      <div class="ja">${esc(c.japanese)}</div>
      ${revealed ? answerBoxHtml(c, memo) : ''}
    </div>
    <div id="bottom">${bottomHtml(c)}</div>`;
  bindStudy(c);
}
function answerBoxHtml(c, memo) {
  const r = session.res;
  const vlabel = r ? { exact: '正解', close: 'ほぼ正解', diff: 'お手本とちがいます', empty: '' }[r.verdict] : '';
  return `<div class="answer-box">
    ${r && r.verdict !== 'empty' ? `<div class="verdict ${r.verdict}">${vlabel}</div>` : ''}
    <div class="model en"><span>${esc(c.english)}</span>${canSpeak() ? '<button class="speak" id="speakBtn" aria-label="読み上げ">🔊</button>' : ''}</div>
    ${r && r.verdict !== 'empty' && r.verdict !== 'exact' ? `<div class="yours"><div class="lbl">あなたの答え</div><div class="diff en">${diffHtml(session.answer, c.english)}</div></div>` : ''}
    ${memo ? `<div class="memo">${esc(memo)}</div>` : ''}
  </div>`;
}
function diffHtml(answer, model) {
  return wordDiff(answer, model).map((d) => (d.t === 'ok' ? esc(d.w) : `<span class="${d.t}">${esc(d.w)}</span>`)).join(' ');
}
function bottomHtml(c) {
  if (session.phase === 'ask') {
    return `<div class="input-row">
        <input id="ans" class="en" type="text" inputmode="text" lang="en" autocomplete="off" autocapitalize="sentences" spellcheck="false" placeholder="英語で答える" value="${esc(session.answer)}">
        ${micUsable() ? `<button class="btn mic ${mic ? 'on' : ''}" id="micBtn" aria-label="声で答える">${mic ? '■' : '🎤'}</button>` : ''}
      </div>
      <div class="heard" id="heard">${mic ? '聞いています… 言い終わったら ■' : esc(session.heard)}</div>
      <button class="btn primary big block" id="checkBtn">答え合わせ</button>
      <button class="btn ghost block" id="showBtn">わからない（答えを見る）</button>`;
  }
  if (session.phase === 'reveal') {
    const st = store.state(c.id); const sugg = session.res && session.res.suggest;
    return `<div class="small center">自分で採点してください（次に出る時期）</div>
      <div class="grades">${Object.entries(GRADES).map(([g, v]) => `<button class="grade ${g} ${sugg === g ? 'sugg' : ''}" data-g="${g}">${v.label}<small>${previewLabel(st, g, today())}</small></button>`).join('')}</div>`;
  }
  if (session.phase === 'repeat') {
    const done = session.reps >= 3;
    return `<div class="panel repeat">
      <div><b>3回リピート</b>　お手本を声に出して3回言いましょう</div>
      <div class="reps">${[0, 1, 2].map((i) => `<i class="${i < session.reps ? 'ok' : ''}"></i>`).join('')}</div>
      <div class="rep-msg ${session.repNg ? 'ng' : ''}" id="repMsg">${done ? '<span class="mastered">マスター ✓</span>' : esc(session.repMsg)}</div>
      ${done ? '<button class="btn primary big block" id="nextBtn">次へ</button>' : `
        ${micUsable() ? `<button class="btn teal big block ${mic ? 'mic on' : ''}" id="repMic">${mic ? '■ 聞いています…' : `🎤 言う（${session.reps + 1}回目）`}</button>` : ''}
        <button class="btn ${micUsable() ? '' : 'primary big'} block" id="repTap">言えた（${session.reps + 1}/3）</button>
        <button class="btn ghost block" id="repSkip">リピートをとばす</button>`}
    </div>`;
  }
  return '';
}
function bindStudy(c) {
  const $ = (id) => document.getElementById(id);
  $('quit').onclick = (e) => { e.preventDefault(); stopMic(); stopSpeak(); session = null; go('#/'); };
  const sb = $('speakBtn'); if (sb) sb.onclick = () => say(c.english, true);
  if (session.phase === 'ask') {
    const inp = $('ans');
    inp.oninput = () => { session.answer = inp.value; };
    inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); check(c, true); } };
    $('checkBtn').onclick = () => check(c, true);
    $('showBtn').onclick = () => { session.answer = ''; check(c, true); };
    const mb = $('micBtn'); if (mb) mb.onclick = () => (mic ? mic.stop() : startAnswerMic(c));
    if (!mic && !('ontouchstart' in window)) inp.focus();
  } else if (session.phase === 'reveal') {
    $app.querySelectorAll('.grade').forEach((b) => { b.onclick = () => doGrade(c, b.dataset.g); });
  } else if (session.phase === 'repeat') {
    const nb = $('nextBtn'); if (nb) nb.onclick = () => next();
    const rm = $('repMic'); if (rm) rm.onclick = () => (mic ? mic.stop() : startRepeatMic(c));
    const rt = $('repTap'); if (rt) rt.onclick = () => repCount(c);
    const rs = $('repSkip'); if (rs) rs.onclick = () => next();
  }
}
function check(c, fromTap) {
  stopMic();
  session.res = judge(session.answer, c.english);
  session.phase = 'reveal';
  viewStudy();
  if (store.settings.autoSpeak) say(c.english, fromTap);
}
function micError(e) {
  const code = e && e.code || '';
  if (/not-allowed|service-not-allowed/.test(code)) toast('マイクが使えません（ブラウザのマイク許可を確認してください）', 3500);
  else if (code === 'no-sr') toast('この端末のブラウザは音声認識に対応していません', 3500);
  else toast('うまく聞き取れませんでした');
}
function startAnswerMic(c) {
  stopSpeak();
  try {
    mic = listen({ lang: 'en-US', continuous: false, maxMs: 15000, onPartial: (t) => { session.heard = t; const h = document.getElementById('heard'); if (h) h.textContent = t; } });
  } catch (e) { mic = null; micError(e); return; }
  const me = mic; viewStudy();
  me.done.then((said) => {
    if (mic !== me) return; mic = null;
    if (said) { session.answer = said; check(c, false); } else { session.heard = '聞き取れませんでした。もう一度どうぞ'; viewStudy(); }
  }).catch((e) => { if (mic === me) mic = null; micError(e); viewStudy(); });
}
function doGrade(c, g) {
  store.grade(c.id, g, today());
  session.s.grade(g);
  if (g === 'good' || g === 'easy') session.setCorrect++;
  if (store.settings.repeat) { session.phase = 'repeat'; session.repMsg = ''; viewStudy(); } else next();
}
function repCount(c) {
  session.reps++; session.repNg = false;
  session.repMsg = session.reps < 3 ? `${session.reps}回 OK` : '';
  if (session.reps >= 3) { session.s.master(c.id); store.repeatDone(c.id); }
  viewStudy();
  if (session.reps >= 3) setTimeout(() => { if (session && session.phase === 'repeat' && session.reps >= 3 && cur() === c) next(); }, 900);
}
function startRepeatMic(c) {
  stopSpeak();
  try {
    mic = listen({ lang: 'en-US', continuous: false, maxMs: 12000, onPartial: (t) => { const m = document.getElementById('repMsg'); if (m) { m.textContent = t; m.className = 'rep-msg'; } } });
  } catch (e) { mic = null; micError(e); return; }
  const me = mic; viewStudy();
  me.done.then((said) => {
    if (mic !== me) return; mic = null;
    if (said && repeatOk(said, c.english)) return repCount(c);
    // ちがったら：お手本をもう一度（声と文字で）見せて、同じ回をやり直し
    session.repNg = true;
    session.repMsg = said ? `「${said}」と聞こえました。もう一度：${c.english}` : `聞き取れませんでした。もう一度：${c.english}`;
    viewStudy(); say(c.english, false);
  }).catch((e) => { if (mic === me) mic = null; micError(e); viewStudy(); });
}
function next() {
  stopMic(); stopSpeak();
  const r = session.s.advance();
  if (r === 'next') { newCard(); viewStudy(); window.scrollTo(0, 0); return; }
  session.phase = r; viewStudy();
}
function renderBreak() {
  const s = session.s; const ph = session.phase;
  const msg = ph === 'done' ? 'おつかれさまでした。このモードの問題は全部終わりです。'
    : ph === 'bigEnd' ? `${SETS_BEFORE_CONFIRM}セット（${s.answered}問）終わりました。まだ続けますか？`
    : `${s.setNo - 1}セット目が終わりました。続けますか？`;
  const setScore = ph === 'done' ? '' : `<div class="small">このセット：言えた ${session.setCorrect} / ${SET_SIZE}</div>`;
  $app.innerHTML = `<div class="top"><h1>${esc(s.label)}</h1></div>
    <div class="panel center">
      <div class="big-num">${s.correct}<small style="font-size:18px"> / ${s.answered}</small></div>
      <div class="small">言えた / 回答 ・ マスター ${s.mastered.size}</div>
      ${setScore}
      <p>${msg}</p>
      ${ph === 'done' ? '' : '<button class="btn primary big block" id="contBtn">続ける</button>'}
      <button class="btn block" id="endBtn">終わる</button>
    </div>`;
  const cb = document.getElementById('contBtn');
  if (cb) cb.onclick = () => { session.setCorrect = 0; newCard(); viewStudy(); };
  document.getElementById('endBtn').onclick = () => { session = null; go('#/'); };
}

// ---------- 進み具合 ----------
function viewProgress() {
  const t = today(); const st = store.stats(t);
  const sk = streak(store.data.days, t);
  const up = upcoming(store.states, store.cards.map((c) => c.id), t, 7);
  const wd = ['日', '月', '火', '水', '木', '金', '土'];
  const ls = store.lessons();
  $app.innerHTML = `<div class="top"><h1>進み具合</h1><span class="streak">連続 <b>${sk}</b> 日</span></div>
    <div class="stats">
      <div><b>${st.mastered}</b><span>覚えた</span></div>
      <div><b>${st.learning}</b><span>練習中</span></div>
      <div><b>${st.fresh}</b><span>まだ</span></div>
      <div><b>${st.repeated}</b><span>3回リピート済</span></div>
    </div>
    <p class="small">「覚えた」＝次の復習が${st.masteredDays}日以上先になったフレーズ。勉強した日：${store.data.days.length}日 ・ 今日の回答：${st.todayCount}</p>
    <div class="sec">これからの復習（7日）</div>
    <div class="week">${up.map((n, i) => `<div>${i === 0 ? '今日' : wd[new Date(Date.now() + i * 864e5).getDay()]}<b>${n}</b></div>`).join('')}</div>
    <div class="sec">レッスンごと</div>
    <div class="list">${ls.map((L) => `<div class="item lesson"><div class="t">${esc(L.name)} <span class="m">${esc(L.theme)}</span></div>
      <div class="m">覚えた ${L.mastered} / ${L.total} ・ 練習済み ${L.seen} ・ リピート済 ${L.repeated}</div>${barHtml(L.mastered, L.seen - L.mastered, L.total)}</div>`).join('')}</div>`;
}

// ---------- フレーズ一覧・編集 ----------
let phraseFilter = { q: '', lesson: '' };
function viewPhrases() {
  const ls = store.lessons();
  $app.innerHTML = `<div class="top"><h1>フレーズ</h1><a class="btn" href="#/edit/new">＋ 追加</a></div>
    <div class="search"><input class="f-in" id="q" type="search" placeholder="検索（日本語・英語）" value="${esc(phraseFilter.q)}">
      <select class="f-in" id="lf"><option value="">すべて</option>${ls.map((L) => `<option ${L.name === phraseFilter.lesson ? 'selected' : ''}>${esc(L.name)}</option>`).join('')}</select></div>
    <div class="small" id="cnt"></div><div class="list" id="plist"></div>`;
  const draw = () => {
    const q = phraseFilter.q.trim().toLowerCase();
    const arr = store.cards.filter((c) => (!phraseFilter.lesson || c.lesson === phraseFilter.lesson) && (!q || (c.japanese + ' ' + c.english + ' ' + (c.note || '')).toLowerCase().includes(q)));
    document.getElementById('cnt').textContent = `${arr.length}件`;
    document.getElementById('plist').innerHTML = arr.slice(0, 300).map((c) => {
      const s = cardStatus(store.state(c.id));
      return `<a class="item" href="#/edit/${encodeURIComponent(c.id)}"><div class="ja">${esc(c.japanese)}${s === 'mastered' ? '<span class="tag m">覚えた</span>' : s === 'learning' ? '<span class="tag">練習中</span>' : ''}</div><div class="en">${esc(c.english)}</div><div class="m">${esc(c.lesson)}</div></a>`;
    }).join('') + (arr.length > 300 ? '<p class="small center">先頭300件を表示しています。検索でしぼってください。</p>' : '');
  };
  document.getElementById('q').oninput = (e) => { phraseFilter.q = e.target.value; draw(); };
  document.getElementById('lf').onchange = (e) => { phraseFilter.lesson = e.target.value; draw(); };
  draw();
}
function viewEdit(id) {
  const c = id && id !== 'new' ? store.card(id) : null;
  if (id && id !== 'new' && !c) { go('#/phrases'); return; }
  const lessons = [...new Set([MY_LESSON, ...store.lessons().map((L) => L.name)])];
  const st = c && store.state(c.id);
  $app.innerHTML = `<div class="top"><a class="back" href="#/phrases">‹</a><h1>${c ? 'フレーズを編集' : 'フレーズを追加'}</h1></div>
    <div class="panel">
      <label class="f" for="fja">日本語</label><textarea class="f-in" id="fja">${esc(c?.japanese || '')}</textarea>
      <label class="f" for="fen">英語（お手本）</label><textarea class="f-in en" id="fen" lang="en" autocapitalize="sentences" spellcheck="true">${esc(c?.english || '')}</textarea>
      <label class="f" for="fnote">メモ（[ ] でかこむと答える前に出る場面のヒント。例：[会議の冒頭で]）</label><input class="f-in" id="fnote" value="${esc(c?.note || '')}">
      <label class="f" for="fles">レッスン</label><select class="f-in" id="fles">${lessons.map((l) => `<option ${l === (c?.lesson || MY_LESSON) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <div class="row" style="margin-top:14px">${canSpeak() ? '<button class="btn" id="fspk">🔊 試聴</button>' : ''}<button class="btn primary" id="fsave">保存</button></div>
      ${c ? `<p class="small">${st && st.seen ? `回答 ${st.seen}回 ・ 次の復習 ${st.interval}日間隔` : 'まだ練習していません'}</p>
        <div class="row">${st && st.seen ? '<button class="btn" id="freset">覚えぐあいをリセット</button>' : ''}<button class="btn danger" id="fdel">削除</button></div>` : ''}
    </div>`;
  const v = (k) => document.getElementById(k).value;
  const sp = document.getElementById('fspk'); if (sp) sp.onclick = () => say(v('fen'), true);
  document.getElementById('fsave').onclick = () => {
    try { store.saveCard({ id: c?.id, japanese: v('fja'), english: v('fen'), note: v('fnote'), lesson: v('fles') }); toast('保存しました'); go('#/phrases'); }
    catch (e) { toast(e.message); }
  };
  const del = document.getElementById('fdel');
  if (del) del.onclick = () => { if (confirm('このフレーズを削除しますか？')) { store.deleteCard(c.id); toast('削除しました'); go('#/phrases'); } };
  const rs = document.getElementById('freset');
  if (rs) rs.onclick = () => { store.resetCard(c.id); toast('リセットしました'); viewEdit(c.id); };
}

// ---------- クラウド（Google ログイン・同期） ----------
const STATUS_LABEL = { idle: '', syncing: '同期中…', ok: '同期済み', offline: 'オフライン（つながったら同期します）', error: '同期できませんでした', signedout: 'ログインが切れています' };
function cloudLabel() {
  const l = store.data.cloud; if (!l) return '';
  const t = l.lastSync ? new Date(l.lastSync).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return `☁ ${STATUS_LABEL[cloud.status] || ''}${cloud.status === 'ok' && t ? `（${t}）` : ''}${cloud.status === 'error' ? `：${errText(cloud.error)}` : ''}`;
}
function errText(code) {
  if (/permission-denied/.test(code)) return 'このアカウントには許可がありません（登録したアカウントでログインしてください）';
  if (/unauthorized-domain/.test(code)) return 'このサイトのドメインが Firebase で許可されていません';
  if (/popup-closed|cancelled-popup/.test(code)) return 'ログインを中止しました';
  if (/network|unavailable|Failed to fetch|import/i.test(code)) return 'ネットにつながっていません';
  return code || '不明なエラー';
}
function cloudPanelHtml() {
  const l = store.data.cloud;
  if (!l) return `<p class="small" style="margin-top:0">Google アカウントでログインすると、フレーズと覚えぐあいがクラウドに保存され、スマホ・iPad など別の端末でも同じ記録で続けられます。ログインしなくても、この端末だけで使えます。</p>
    <button class="btn primary block" id="loginBtn">Google でログイン</button>`;
  return `<p class="small" style="margin-top:0">${esc(l.email || '')}<br><span id="cloudStat">${esc(cloudLabel())}</span></p>
    <div class="row"><button class="btn" id="syncBtn">今すぐ同期</button><button class="btn danger" id="logoutBtn">ログアウト</button></div>
    <p class="small">ログアウトしても、この端末のフレーズと記録は残ります（この端末だけで続けられます）。</p>`;
}
function bindCloudPanel() {
  const lb = document.getElementById('loginBtn');
  if (lb) lb.onclick = async () => {
    lb.disabled = true; lb.textContent = 'ログイン中…';
    try {
      const { signInGoogle } = await import('./cloud.js');
      const r = await signInGoogle();
      if (r && r.user) { await cloud.activate(r.user); toast(cloud.status === 'ok' ? 'ログインして同期しました' : errText(cloud.error), 3500); }
    } catch (e) { toast('ログインできませんでした：' + errText(e.code || e.message), 4000); }
    viewSettings();
  };
  const sb = document.getElementById('syncBtn');
  if (sb) sb.onclick = async () => { await cloud.sync({ full: true }); toast(cloud.status === 'ok' ? '同期しました' : cloudLabel(), 3000); viewSettings(); };
  const ob = document.getElementById('logoutBtn');
  if (ob) ob.onclick = async () => { if (!confirm('ログアウトしますか？（この端末の記録は残ります）')) return; await cloud.signOut(); toast('ログアウトしました'); viewSettings(); };
}

// ---------- 設定・データ ----------
function viewSettings() {
  const S = store.settings;
  const counts = store.cards.reduce((a, c) => ((a[c.src] = (a[c.src] || 0) + 1), a), {});
  $app.innerHTML = `<div class="top"><h1>設定</h1></div>
    <div class="panel">
      <div class="set-row"><div class="l">新しいフレーズ（1日）<small>今日の復習に入る新しいフレーズの数</small></div>
        <input type="number" id="sNew" min="0" max="100" value="${S.newPerDay}" style="width:80px"></div>
      <div class="set-row"><div class="l">答えを自動で読み上げる<small>${canSpeak() ? '英語（en-US）の音声' : 'この端末では読み上げが使えません'}</small></div><input type="checkbox" class="switch" id="sAuto" ${S.autoSpeak ? 'checked' : ''}></div>
      <div class="set-row"><div class="l">読み上げの速さ</div><select id="sRate">${[[0.7, 'ゆっくり'], [0.8, 'やや遅め'], [0.9, 'ふつう'], [1, '速め']].map(([r, l]) => `<option value="${r}" ${+S.rate === r ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="set-row"><div class="l">マイクで答える<small>${canListen() ? '音声認識（en-US）を使う' : 'この端末のブラウザは音声認識に未対応（入力で答えます）'}</small></div><input type="checkbox" class="switch" id="sMic" ${S.useMic ? 'checked' : ''} ${canListen() ? '' : 'disabled'}></div>
      <div class="set-row"><div class="l">採点のあと3回リピート</div><input type="checkbox" class="switch" id="sRep" ${S.repeat ? 'checked' : ''}></div>
    </div>
    <div class="sec">クラウド同期</div>
    <div class="panel" id="cloudPanel">${cloudPanelHtml()}</div>
    <div class="sec">フレーズのデータ</div>
    <div class="panel">
      <p class="small" style="margin-top:0">いま：読み込んだフレーズ ${counts.import || 0} ・ マイフレーズ ${counts.mine || 0} ・ サンプル ${counts.sample || 0}<br>
      ${store.data.cloud ? 'データはこの端末と、あなたのアカウント専用のクラウドの場所に保存されます（ほかの人は読めません）。' : 'データはこの端末の中だけに保存されます（ログインするまでサーバーには送りません）。'}</p>
      <button class="btn primary block" id="impBtn">ファイルから読み込む（JSON / CSV）</button>
      <p class="small">JSON：<code>japanese</code>・<code>english</code>（任意で <code>id, lesson, theme, note</code>）の配列。CSV：見出しに japanese, english（日本語, 英語 でも可）。見出しがなければ 1列目＝日本語・2列目＝英語。同じ id のフレーズは上書きされ、覚えぐあいは残ります。</p>
      <input type="file" id="impFile" accept=".json,.csv,.tsv,.txt,application/json,text/csv,text/plain" hidden>
    </div>
    <div class="sec">バックアップ</div>
    <div class="panel">
      <button class="btn block" id="expBtn">バックアップを書き出す（JSON）</button>
      <button class="btn block" id="resBtn">バックアップから元にもどす</button>
      <p class="small">バックアップにはフレーズ・覚えぐあい・設定がすべて入ります。機種変更のときや別の端末に移すときに使えます。</p>
    </div>
    <div class="sec">削除</div>
    <div class="panel">
      ${counts.import ? '<button class="btn danger block" id="delImp">読み込んだフレーズを削除</button>' : ''}
      ${counts.sample ? '<button class="btn danger block" id="delSmp">サンプルを削除</button>' : ''}
      <button class="btn danger block" id="resetBtn">覚えぐあいの記録をすべてリセット</button>
    </div>
    <p class="small center">英語フレーズ ${APP_VERSION}</p>`;
  const $ = (id) => document.getElementById(id);
  bindCloudPanel();
  $('sNew').onchange = (e) => store.setSetting('newPerDay', Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)));
  $('sAuto').onchange = (e) => store.setSetting('autoSpeak', e.target.checked);
  $('sRate').onchange = (e) => { store.setSetting('rate', +e.target.value); say('This is the reading speed.', true); };
  $('sMic').onchange = (e) => store.setSetting('useMic', e.target.checked);
  $('sRep').onchange = (e) => store.setSetting('repeat', e.target.checked);
  $('impBtn').onclick = () => { $('impFile').dataset.mode = 'import'; $('impFile').click(); };
  $('resBtn').onclick = () => { $('impFile').dataset.mode = 'restore'; $('impFile').click(); };
  $('impFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const r = parseImport(await f.text(), f.name);
      if (r.kind === 'backup') {
        if (!confirm('バックアップで今の記録を置きかえます。よろしいですか？')) return;
        await store.restoreBackup(r.backup); toast('元にもどしました'); viewSettings(); return;
      }
      if (e.target.dataset.mode === 'restore') { toast('これはバックアップではありません。「ファイルから読み込む」を使ってください', 3500); return; }
      const { added, updated } = store.addItems(r.items);
      toast(`読み込みました：新規 ${added}・更新 ${updated}${r.skipped ? `・スキップ ${r.skipped}` : ''}`, 3500);
      viewSettings();
    } catch (err) { toast('読み込めませんでした：' + err.message, 4000); }
  };
  $('expBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(store.exportBackup())], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    const d = new Date(); a.download = `english-phrases-backup-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  const di = $('delImp'); if (di) di.onclick = () => { if (confirm('読み込んだフレーズと、その覚えぐあいを削除します。よろしいですか？')) { store.deleteSource('import'); toast('削除しました'); viewSettings(); } };
  const ds = $('delSmp'); if (ds) ds.onclick = () => { if (confirm('サンプルのフレーズを削除しますか？')) { store.deleteSource('sample'); viewSettings(); } };
  $('resetBtn').onclick = () => { if (confirm('覚えぐあい・連続日数などの記録をすべて消します。フレーズは残ります。よろしいですか？')) { store.resetProgress(); toast('リセットしました'); } };
}

// ---------- 起動 ----------
(async function main() {
  await store.init();
  armSpeechGestures();
  onSpeechBlocked((on) => { const b = document.getElementById('speakBtn'); if (b) b.classList.toggle('blocked', on); });
  window.addEventListener('hashchange', route);
  // 変えたら少し待ってクラウドへ。クラウドから新しい記録が来たら、勉強中でなければ画面をかきなおす
  store.onChange(() => {
    if (cloud.applying) { if (!location.hash.startsWith('#/study')) route(); return; }
    cloud.schedule(2500, store.data.cardsDirty);
  });
  cloud.onStatus(() => {
    for (const id of ['cloudLine', 'cloudStat']) { const el = document.getElementById(id); if (el) el.textContent = cloudLabel(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cloud.schedule(300, true); });
  window.addEventListener('online', () => cloud.schedule(300, true));
  route();
  cloud.resume();
  try {
    if (['localhost', '127.0.0.1'].includes(location.hostname) && localStorage.getItem('english-phrases:emulator')) {
      const m = await import('./cloud.js'); window.__ep = { store, cloud, signInEmulator: m.signInEmulator, route };
    }
  } catch {}
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
