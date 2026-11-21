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
