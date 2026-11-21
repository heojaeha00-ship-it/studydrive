// 로컬 모드: Supabase 설정이 없을 때 이 기기(IndexedDB)에만 저장. 개발·테스트용.
import { uuid } from './util.js';

let dbp;
const db = () =>
  (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('studydrive', 3);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of ['files', 'blobs', 'mistakes', 'folders', 'strokes']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      if (!d.objectStoreNames.contains('ann')) d.createObjectStore('ann', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
const tx = async (s, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(s, mode);
    const req = fn(t.objectStore(s));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
};
const all = (s) => tx(s, 'readonly', (st) => st.getAll());
const get = (s, k) => tx(s, 'readonly', (st) => st.get(k));
const put = (s, v) => tx(s, 'readwrite', (st) => st.put(v));
const del = (s, k) => tx(s, 'readwrite', (st) => st.delete(k));

const RULES = [
  [/part\s*[1-4]\b|\blc\b|듣기|listening/i, 'LC(듣기)'],
  [/part\s*[5-7]\b|\brc\b|독해|reading/i, 'RC(독해)'],
  [/voca|어휘|단어/i, '어휘'],
  [/모의|실전|\btest\b/i, '모의고사'],
];

export function local() {
  const files = {
    list: async () => (await all('files')).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    async add(file, extra = {}) {
      const row = { id: uuid(), name: file.name, mime: file.type || '', size: file.size, category: '미분류', tags: [], summary: '', folder_id: null, created_at: new Date().toISOString(), ...extra };
      await put('blobs', { id: row.id, blob: file });
      await put('files', row);
      return row;
    },
    async update(row, patch) { const n = { ...row, ...patch }; await put('files', n); return n; },
    async remove(row) {
      await del('files', row.id);
      await del('blobs', row.id);
      for (const x of await all('strokes')) if (x.file_id === row.id) await del('strokes', x.id);
    },
    blob: async (row) => (await get('blobs', row.id)).blob,
    async copy(row, extra = {}) {
      const id = uuid(), blob = (await get('blobs', row.id)).blob;
      const n = { ...row, id, created_at: new Date().toISOString(), ...extra };
      await put('blobs', { id, blob }); await put('files', n);
      for (const x of await all('strokes')) if (x.file_id === row.id) { const nid = uuid(); await put('strokes', { ...x, id: nid, file_id: id, data: { ...x.data, id: nid } }); }
      return n;
    },
    async replace(row, blob) { await put('blobs', { id: row.id, blob }); return files.update(row, { size: blob.size }); },
  };
  const folders = {
    list: async () => (await all('folders')).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
    async add(f) { const row = { id: uuid(), name: f.name, parent_id: f.parent_id || null, emoji: f.emoji || '📁', created_at: new Date().toISOString() }; await put('folders', row); return row; },
    async update(id, patch) { const n = { ...(await get('folders', id)), ...patch }; await put('folders', n); return n; },
    remove: (id) => del('folders', id),
  };
  const ann = {
    async get(fileId) {
      const out = {};
      for (const r of (await all('strokes')).filter((x) => x.file_id === fileId).sort((a, b) => a.t - b.t)) (out[r.page] ||= []).push(r.data);
      return out;
    },
    add: (fileId, page, st) => put('strokes', { id: st.id, file_id: fileId, page, data: st, t: Date.now() }),
    async remove(ids) { for (const id of ids) await del('strokes', id); },
  };
  const mistakes = {
    list: async () => (await all('mistakes')).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    async add(m) { const row = { id: uuid(), created_at: new Date().toISOString(), ai: null, ...m }; await put('mistakes', row); return row; },
    async update(id, patch) { const n = { ...(await get('mistakes', id)), ...patch }; await put('mistakes', n); return n; },
    remove: (id) => del('mistakes', id),
  };
  return {
    mode: 'local',
    auth: { user: async () => ({ id: 'local', email: '이 기기 (로컬 모드)' }), signIn: async () => {}, signUp: async () => {}, signInAnon: async () => {}, upgrade: async () => {}, signOut: async () => {} },
    files, ann, mistakes, folders,
    live() {},
    settings: {
      get: async () => { try { return JSON.parse(localStorage.getItem('sd-settings') || '{}'); } catch { return {}; } },
      set: async (v) => localStorage.setItem('sd-settings', JSON.stringify(v)),
    },
    async ai(action, p) {
      if (action === 'classify') {
        const hay = `${p.name} ${p.text || ''}`;
        const hit = RULES.find(([re]) => re.test(hay));
        return { category: hit ? hit[1] : '미분류', tags: [], summary: '' };
      }
      throw new Error('AI 기능은 서버(Supabase) 연결 후 사용할 수 있어요');
    },
  };
}
