// Firebase adapter: gives the app the same small API it used inside Claude
// (db.collection/doc, onSnapshot, set/update/delete; user.id/profiles; assets.upload).
// Data lives under families/<family key>/..., and the key comes from the family link (?k=...).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeFirestore, persistentLocalCache, collection, doc, onSnapshot,
  setDoc, updateDoc, deleteDoc, getDoc, getDocs, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const cfg = window.FIREBASE_CONFIG;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};

// family key: from the link first, then from this device
const qp = new URLSearchParams(location.search);
let key = qp.get('k');
if (key) store.set('family-key', key); else key = store.get('family-key');
if (key && !qp.get('k')) { // keep the key in the address so "add to home screen" keeps working
  qp.set('k', key); history.replaceState(null, '', location.pathname + '?' + qp.toString() + location.hash);
}

let fs = null;
if (cfg && cfg.projectId && key) {
  const app = initializeApp(cfg);
  try { fs = initializeFirestore(app, { localCache: persistentLocalCache() }); }
  catch (e) { fs = initializeFirestore(app, {}); }
}
const base = 'families/' + key + '/';
const snapOf = s => ({ docs: s.docs.map(d => ({ id: d.id, data: () => d.data() })) });

// writes: resolve once saved on the server; when offline, resolve right away (Firestore keeps the write and sends it later)
function w(p) { if (navigator.onLine === false) { p.catch(e => console.warn(e)); return Promise.resolve(); } return p; }
function docApi(path) {
  const ref = doc(fs, base + path);
  return {
    set: d => w(setDoc(ref, d)),
    update: d => w(updateDoc(ref, d)),
    delete: () => w(deleteDoc(ref)),
    get: () => getDoc(ref).then(s => s.exists() ? s.data() : null)
  };
}
function colApi(path) {
  return {
    doc: id => docApi(path + '/' + id),
    onSnapshot: (cb, err) => onSnapshot(collection(fs, base + path), s => cb(snapOf(s)), err || (() => {}))
  };
}
const db = fs ? { collection: colApi, doc: docApi } : null;

// who is writing: chosen once per device (엄마 / 딸 / other)
function pickName() {
  return new Promise(resolve => {
    const saved = store.get('who');
    if (saved) return resolve(saved);
    const ov = document.createElement('div');
    ov.className = 'who-pick';
    ov.innerHTML = '<div class="panel" role="dialog" aria-label="누구세요"><h3>누구세요?</h3>' +
      '<p class="muted">기록에 이름이 붙어요. 이 기기에서 한 번만 고르면 돼요.</p>' +
      '<div class="row"><button class="btn" data-n="엄마">엄마</button><button class="btn" data-n="딸">딸</button></div>' +
      '<label class="field"><span>다른 이름</span><input id="who-other" placeholder="예: 아빠"></label>' +
      '<div class="row end"><button class="btn ghost" data-other>이 이름으로</button></div></div>';
    document.body.append(ov);
    ov.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const n = b.dataset.n || (b.hasAttribute('data-other') ? (ov.querySelector('#who-other').value || '').trim() : '');
      if (!n) return;
      store.set('who', n); ov.remove(); resolve(n);
    });
  });
}
const nameP = db ? pickName() : Promise.resolve(null);
const user = {
  id: () => nameP.then(n => n ? 'who:' + n : null),
  can: () => Promise.resolve(!!db),
  canEdit: () => Promise.resolve(!!db),
  profiles: ids => Promise.resolve(Object.fromEntries(ids.filter(Boolean).map(i => [i, { name: String(i).replace(/^who:/, ''), avatarUrl: null }])))
};

// photos: stored as small JPEG data URLs in families/<key>/blobs/<id>
const blobCache = {}, blobWait = {};
window.__blobUrl = id => {
  if (blobCache[id]) return blobCache[id];
  if (db && !blobWait[id]) {
    blobWait[id] = docApi('blobs/' + id).get().then(d => {
      blobCache[id] = (d && d.data) || ''; if (window.__rerender) window.__rerender();
    }).catch(() => {});
  }
  return 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
};
const toDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
async function squeeze(blob) {
  let url = await toDataUrl(blob);
  if (url.length < 900000) return url;
  try { // still too big for one document: shrink harder
    const bmp = await createImageBitmap(blob);
    for (const [max, q] of [[1000, .7], [800, .6], [600, .5]]) {
      const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      url = c.toDataURL('image/jpeg', q); if (url.length < 900000) return url;
    }
  } catch (e) {}
  throw { code: 'too_large' };
}
const assets = db ? {
  upload: async blob => {
    const url = await squeeze(blob);
    const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await docApi('blobs/' + id).set({ data: url, createdAt: new Date().toISOString() });
    blobCache[id] = url; return { id };
  }
} : null;

// backup: export / import everything as one JSON file
const SUBS = ['plan', 'notes', 'todo', 'budget', 'research'];
async function readCol(path) { const s = await getDocs(collection(fs, base + path)); const o = {}; s.docs.forEach(d => o[d.id] = d.data()); return o; }
window.__exportAll = async () => {
  const out = { format: 'family-log/1', exportedAt: new Date().toISOString(), trips: {}, ideas: await readCol('ideas') };
  const trips = await readCol('trips');
  for (const id in trips) { out.trips[id] = { doc: trips[id] }; for (const k of SUBS) out.trips[id][k] = await readCol('trips/' + id + '/' + k); }
  return out;
};
window.__importAll = async data => {
  if (!data || !data.trips) throw { code: 'bad_file' };
  const ops = [];
  for (const id in data.trips) {
    const t = data.trips[id]; if (t.doc) ops.push(['trips/' + id, t.doc]);
    for (const k of SUBS) for (const d in (t[k] || {})) ops.push(['trips/' + id + '/' + k + '/' + d, t[k][d]]);
  }
  for (const d in (data.ideas || {})) ops.push(['ideas/' + d, data.ideas[d]]);
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(fs); ops.slice(i, i + 400).forEach(([p, d]) => b.set(doc(fs, base + p), d)); await b.commit();
  }
  return ops.length;
};
window.__familyName = () => store.get('who');
window.__changeName = () => { try { localStorage.removeItem('who'); } catch (e) {} location.reload(); };

window.__resolveClaude({ db, user, assets });
