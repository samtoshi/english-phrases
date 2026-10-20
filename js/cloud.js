// Firebase（Google ログイン ＋ Firestore）。anki-app の cloud.js と同じ読みこみ方・同じプロジェクト。
// - 使うのは phrasebook/{uid}/… だけ。Firestore のルールで「本人（登録したアカウント）だけ」が読み書きできる
// - ログインしなくても、この端末だけで使える（ログインは「設定」から）
// - Firebase の SDK は、ログインしたときだけ読みこむ（オフラインでも起動は速いまま）
import { firebaseConfig, appCheckSiteKey, ROOT_COLLECTION } from './firebase-config.js';
import { syncOnce } from './cloudsync.js';

export const SDK_VERSION = '13.0.0';
const CDN = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/`;
const APP_NAME = 'english-phrases'; // anki-app とは別の名前（同じサイトでもログインが混ざらない）

// テスト用：localhost のときだけ、エミュレーターにつなぐ設定を localStorage から読む
function emulatorCfg() {
  try {
    if (!['localhost', '127.0.0.1'].includes(location.hostname)) return null;
    return JSON.parse(localStorage.getItem('english-phrases:emulator') || 'null');
  } catch { return null; }
}

let fbPromise = null;
export function loadFirebase() {
  if (!fbPromise) fbPromise = (async () => {
    const appM = await import(CDN + 'firebase-app.js');
    const emu = emulatorCfg();
    const app = appM.initializeApp(emu ? { apiKey: 'demo-key', projectId: emu.projectId, appId: 'demo', authDomain: 'localhost' } : firebaseConfig, APP_NAME);
    if (appCheckSiteKey && !emu) {
      try {
        const ac = await import(CDN + 'firebase-app-check.js');
        ac.initializeAppCheck(app, { provider: new ac.ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
      } catch (e) { console.warn('App Check', e); }
    }
    const authM = await import(CDN + 'firebase-auth.js');
    const fs = await import(CDN + 'firebase-firestore.js');
    const auth = authM.initializeAuth(app, {
      persistence: [authM.indexedDBLocalPersistence, authM.browserLocalPersistence],
      popupRedirectResolver: authM.browserPopupRedirectResolver,
    });
    auth.languageCode = 'ja';
    const db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true });
    if (emu) {
      authM.connectAuthEmulator(auth, `http://${emu.host}:${emu.authPort}`, { disableWarnings: true });
      fs.connectFirestoreEmulator(db, emu.host, emu.fsPort);
    }
    await auth.authStateReady();
    return { app, auth, authM, fs, db, emu };
  })().catch((e) => { fbPromise = null; throw e; });
  return fbPromise;
}

export async function currentUser() { return (await loadFirebase()).auth.currentUser; }

export async function signInGoogle() {
  const fb = await loadFirebase();
  const p = new fb.authM.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  try { return await fb.authM.signInWithPopup(fb.auth, p); }
  catch (e) {
    if (/popup-blocked|operation-not-supported/.test(e.code || '')) return fb.authM.signInWithRedirect(fb.auth, p);
    throw e;
  }
}
/** エミュレーターのときだけ：にせの Google アカウントでログイン（テスト用） */
export async function signInEmulator(email) {
  const fb = await loadFirebase();
  if (!fb.emu) throw new Error('emulator only');
  const cred = fb.authM.GoogleAuthProvider.credential(JSON.stringify({ sub: 'g-' + email, email, email_verified: true }));
  return fb.authM.signInWithCredential(fb.auth, cred);
}
export async function signOut() { const fb = await loadFirebase(); await fb.authM.signOut(fb.auth); }

/** Firestore を使う api（cloudsync.js の syncOnce に渡す） */
export function firestoreApi(fb, uid) {
  const { fs, db } = fb;
  const stateRef = fs.doc(db, ROOT_COLLECTION, uid, 'data', 'state');
  const cardsCol = fs.collection(db, ROOT_COLLECTION, uid, 'cards');
  return {
    async getState() { const s = await fs.getDoc(stateRef); return s.exists() ? s.data() : null; },
    async getBuckets() { const q = await fs.getDocs(cardsCol); const out = {}; q.forEach((d) => { out[d.id] = d.data().items || {}; }); return out; },
    async setBucket(name, items) { await fs.setDoc(fs.doc(db, ROOT_COLLECTION, uid, 'cards', name), { items, updatedAt: fs.serverTimestamp() }); },
    async setState({ states, meta }) {
      // states は送る分だけ（ほかのフレーズの状態は消さない）。日ごとの記録などは、まるごと入れかえ
      const ids = Object.keys(states);
      const data = { ...meta, updatedAt: fs.serverTimestamp(), clientAt: Date.now(), states };
      const fields = [...Object.keys(meta), 'updatedAt', 'clientAt', ...ids.map((id) => new fs.FieldPath('states', id))];
      await fs.setDoc(stateRef, data, { mergeFields: fields });
    },
  };
}

export class CloudSync {
  constructor(store) {
    this.store = store; this.status = 'idle'; this.error = ''; this.timer = null; this.running = null; this.listeners = new Set(); this.user = null;
  }
  get link() { return this.store.data.cloud; }
  onStatus(fn) { this.listeners.add(fn); }
  setStatus(s, err = '') { this.status = s; this.error = err; for (const f of this.listeners) try { f(s); } catch {} }

  /** 起動時：前にログインしていたら、Firebase を読みこんで同期 */
  async resume() {
    if (!this.link) return;
    try {
      const fb = await loadFirebase();
      const u = fb.auth.currentUser;
      if (!u) { this.setStatus('signedout'); return; }
      this.user = u;
      if (u.uid !== this.link.uid) return this.activate(u);
      return this.sync({ full: true });
    } catch (e) { this.setStatus(navigator.onLine === false ? 'offline' : 'error', e.code || e.message); }
  }
  /** ログインした：この端末の記録とクラウドの記録をまとめる */
  async activate(user) {
    this.user = user;
    const prev = this.store.data.cloud;
    if (!prev || prev.uid !== user.uid) {
      // はじめてこのアカウントとつなぐ：この端末のフレーズは全部「送るもの」にする
      this.store.data.cloud = { uid: user.uid, email: user.email, lastSync: 0, linkedAt: Date.now() };
      this.store.data.cardsDirty = true;
      this.store.save();
    }
    return this.sync({ full: true });
  }
  async signOut() {
    clearTimeout(this.timer);
    try { await signOut(); } catch {}
    this.user = null; this.store.data.cloud = null; this.store.save(); this.setStatus('idle');
  }
  schedule(ms = 2500, full = false) {
    if (!this.link || this.applying) return;
    this.wantFull = this.wantFull || full;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync({ full: this.wantFull }).catch(() => {}), ms);
  }
  async sync({ full = false } = {}) {
    if (!this.link) return;
    if (this.running) { this.again = true; this.wantFull = this.wantFull || full; return this.running; }
    if (globalThis.navigator && navigator.onLine === false) { this.setStatus('offline'); return; }
    this.wantFull = false;
    this.running = (async () => {
      this.setStatus('syncing');
      try {
        const fb = await loadFirebase();
        const u = fb.auth.currentUser;
        if (!u) { this.setStatus('signedout'); return; }
        const r = await syncOnce(this.store, firestoreApi(fb, u.uid), { full });
        this.link.lastSync = Date.now(); this.link.email = u.email;
        this.applying = true;
        try { if (r.pulledStates || r.pulledCards || r.metaPulled) this.store.changed(); else this.store.save(); } finally { this.applying = false; }
        this.last = r;
        this.setStatus('ok');
        return r;
      } catch (e) {
        console.warn('sync failed', e);
        const code = e.code || e.message || '';
        this.setStatus(navigator.onLine === false || code === 'unavailable' ? 'offline' : 'error', code);
      } finally {
        this.running = null;
        if (this.again) { this.again = false; this.schedule(500, this.wantFull); }
      }
    })();
    return this.running;
  }
}
