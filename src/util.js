export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const today = (add = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + add);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '');

export const REASONS = ['어휘', '문법', '듣기 놓침', '시간 부족', '함정 선택지', '찍어서 맞음', '기타'];
export const INTERVALS = [1, 3, 7, 14];

export function kind(name = '', mime = '') {
  const n = name.toLowerCase();
  if (mime === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/.test(n)) return 'image';
  if (mime.startsWith('text/') || /\.(txt|md)$/.test(n)) return 'text';
  return 'other';
}

export function toast(msg, ms = 2800) {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.append(box);
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  box.append(el);
  const close = () => el.remove();
  if (ms) setTimeout(close, ms);
  return { close, set: (t) => (el.textContent = t) };
}

export function debounceKey(fn, ms = 600) {
  const timers = new Map();
  return (key, ...args) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); fn(key, ...args); }, ms));
  };
}

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now());

const GUESS = [
  [/part\s*[1-4]\b|\blc\b|듣기|listening/i, 'LC(듣기)'],
  [/part\s*[5-7]\b|\brc\b|독해|reading/i, 'RC(독해)'],
  [/voca|어휘|단어/i, '어휘'],
  [/모의|실전|\btest\b/i, '모의고사'],
  [/노트|note|필기/i, '노트'],
];
export const guessCategory = (text = '') => (GUESS.find(([re]) => re.test(text)) || [0, '미분류'])[1];

const IC = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  book: '<path d="M4 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z"/><path d="M8 4v16"/><path d="M12 9h4"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  pointer: '<path d="M5 3l14 7-6 2-2 6z"/>',
  pen: '<path d="M3 21l3.5-.8L19 7.7a2.1 2.1 0 0 0-3-3L3.8 17.3z"/><path d="M14.5 6.5l3 3"/>',
  mark: '<path d="M9 11l4 4"/><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M15 5l4 4"/>',
  eraser: '<path d="M20 20H9l-5-5a2 2 0 0 1 0-2.8l8.4-8.4a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L12 20"/><path d="M7 11l6 6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  cards: '<rect x="4" y="8" width="13" height="12" rx="2"/><path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
};
export const ico = (n, sz = 20) => `<svg class="ico" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;
export const logo = (sz = 28) => `<svg class="logo-mark" width="${sz}" height="${sz}" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3451c7"/><stop offset="1" stop-color="#7c4dff"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#lg)"/><rect x="8" y="8" width="16" height="16" rx="3" fill="#fff"/><path d="M11 13h10M11 17h7" stroke="#3451c7" stroke-width="1.8" stroke-linecap="round"/><path d="M16 22l2 2 4-5" fill="none" stroke="#12b886" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
