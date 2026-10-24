// Firebase の設定（あんきカード anki-app と同じプロジェクトを使います）
// ※ この値は公開されても大丈夫な設計です（守りは Firestore のルールと App Check で行います）。
// このアプリが使うのは phrasebook/{自分のuid}/… だけで、ルールで「本人のアカウントだけ」が読み書きできます。
export const firebaseConfig = {
  apiKey: 'AIzaSyCEmU1udKpvPLfeK6dzRc_89B2iHQ6rK-k',
  authDomain: 'anki-54902.firebaseapp.com',
  projectId: 'anki-54902',
  storageBucket: 'anki-54902.firebasestorage.app',
  messagingSenderId: '1050192493102',
  appId: '1:1050192493102:web:68a291191cb3687815fdbf',
};
// App Check（anki-app と同じサイトキー。このサイトのドメインでしか使えない公開用の値）
export const appCheckSiteKey = '6LdswPMtAAAAAAfQN0WkM5gqpm3qQZidO_Se0sBT';
// Firestore の中の、このアプリの場所（anki-app の content/・learners/ とは別）
export const ROOT_COLLECTION = 'phrasebook';

export function isFirebaseConfigured(cfg = firebaseConfig) {
  return !!(cfg && cfg.apiKey && cfg.projectId && !String(cfg.apiKey).startsWith('YOUR'));
}

// 「AIに質問」で使うモデル（Firebase AI Logic / Gemini Developer API。anki-app と同じ）。
// 上から順に使い、その日の上限に達した・使えないモデルは次のモデルにかえます。APIキーはアプリに入れず、App Check で守ります。
export const aiModels = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
