import { $, $$, esc, toast, debounceKey, kind } from './util.js';
import { openDoc, toJpegB64 } from './pdf.js';

const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#111827', '#f59e0b'];

export async function mountViewer(root, { store, row, page = 1, onMistake, onBack, onEvent }) {
  const type = kind(row.name, row.mime);
  const isPaged = type === 'pdf' || type === 'image';
  root.innerHTML = `
    <div class="vbar">
      <button class="btn ghost" data-a="back">← 목록</button>
      <div class="vtitle" title="${esc(row.name)}">${esc(row.name)}</div>
      ${isPaged ? `
      <div class="tools">
        <button class="tool on" data-tool="scroll" title="스크롤">✋</button>
        <button class="tool" data-tool="pen" title="펜">✏️</button>
        <button class="tool" data-tool="hl" title="형광펜">🖍️</button>
        <button class="tool" data-tool="eraser" title="지우개">🧽</button>
        <span class="colors">${COLORS.map((c, i) => `<button class="dot${i === 0 ? ' on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}</span>
        <button class="tool" data-a="undo" title="되돌리기">↩️</button>
        <button class="tool" data-a="zoomout" title="축소">－</button>
        <button class="tool" data-a="zoomin" title="확대">＋</button>
        <span class="pg" id="pg">1 / 1</span>
        <button class="btn sm" data-a="ask">💬 AI 질문</button>
        <button class="btn primary sm" data-a="mistake">오답 등록</button>
        <span class="saved" id="saved"></span>
      </div>` : type === 'text' ? `<div class="tools"><button class="btn primary sm" data-a="savetext">저장</button><span class="saved" id="saved"></span></div>` : ''}
    </div>
    <div class="vscroll"><div class="vpages"></div></div>
    <aside class="askp" hidden>
      <div class="ah"><b>💬 AI에게 질문</b><small class="muted" id="askpg"></small><button class="lnk" data-a="askclose">닫기</button></div>
      <div class="am" id="askmsgs"><p class="muted">지금 보고 있는 쪽을 AI가 읽고 답해요.</p></div>
      <div class="aq">${['이 쪽 핵심 요약', '핵심 어휘·용어 뽑아줘', '이 쪽으로 퀴즈 3개 내줘'].map((q) => `<button class="chip" data-q="${q}">${q}</button>`).join('')}</div>
      <form class="af"><input id="askin" placeholder="궁금한 걸 물어보세요" autocomplete="off"><button class="btn primary sm">보내기</button></form>
    </aside>`;

  const scroller = $('.vscroll', root);
  const pagesEl = $('.vpages', root);
  const savedEl = $('#saved', root);
  let tool = 'scroll', color = COLORS[0], zoom = 1, destroyed = false;
  const strokes = {}; // page -> [stroke]
  const undo = [];
  const objs = [];
  let io, current = 1, doc = null, img = null, blob = null;

  const flash = (t) => { if (savedEl) { savedEl.textContent = t; } };
  const save = debounceKey(async (n) => {
    try { await store.ann.save(row.id, n, strokes[n] || []); flash('저장됨 ✓'); } catch (e) { flash('저장 실패'); toast('필기 저장 실패: ' + e.message); }
  }, 600);

  try { blob = await store.files.blob(row); } catch (e) { pagesEl.innerHTML = `<p class="muted pad">파일을 불러오지 못했어요: ${esc(e.message)}</p>`; return { destroy() {}, capture: async () => null, page: () => 1 }; }

  // ── 텍스트/메모 파일: 바로 편집 ──
  if (type === 'text') {
    const text = await blob.text();
    pagesEl.innerHTML = `<textarea class="texted" spellcheck="false">${esc(text)}</textarea>`;
    root.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'back') onBack();
      if (a === 'savetext') {
        try { row = await store.files.replace(row, new Blob([$('.texted', root).value], { type: row.mime || 'text/plain' })); flash('저장됨 ✓'); } catch (er) { toast('저장 실패: ' + er.message); }
      }
    });
    return { destroy() {}, capture: async () => null, page: () => 1 };
  }

  // ── 지원하지 않는 형식 ──
  if (!isPaged) {
    const url = URL.createObjectURL(blob);
    pagesEl.innerHTML = `<div class="pad"><p>이 형식은 미리보기를 지원하지 않아요. PDF나 이미지로 변환해서 올려 주세요.</p><a class="btn" href="${url}" target="_blank">새 탭에서 열기</a></div>`;
    root.addEventListener('click', (e) => { if (e.target.closest('[data-a="back"]')) onBack(); });
    return { destroy() { URL.revokeObjectURL(url); }, capture: async () => null, page: () => 1 };
  }

  // ── PDF / 이미지 ──
  let ratio = 1.414, total = 1;
  if (type === 'pdf') {
    doc = await openDoc(blob);
    total = doc.numPages;
    const v = (await doc.getPage(1)).getViewport({ scale: 1 });
    ratio = v.height / v.width;
  } else {
    const url = URL.createObjectURL(blob);
    img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    ratio = img.naturalHeight / img.naturalWidth;
  }
  try { Object.assign(strokes, await store.ann.get(row.id)); } catch {}

  const W = () => Math.max(260, Math.min(scroller.clientWidth - 24, 1000) * zoom);
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

  for (let n = 1; n <= total; n++) {
    const wrap = document.createElement('div');
    wrap.className = 'vpage';
    wrap.dataset.n = n;
    wrap.innerHTML = '<canvas class="base"></canvas><canvas class="ov"></canvas>';
    pagesEl.append(wrap);
    const o = { n, wrap, base: $('.base', wrap), ov: $('.ov', wrap), rw: 0, ratio, task: null };
    objs.push(o);
    bindDraw(o);
  }

  function layout() {
    const w = W();
    for (const o of objs) { o.wrap.style.width = w + 'px'; o.wrap.style.height = w * o.ratio + 'px'; }
  }

  async function render(o) {
    const w = W();
    if (o.rw === w) return;
    o.rw = w;
    const d = dpr();
    if (type === 'pdf') {
      const pg = await doc.getPage(o.n);
      const v0 = pg.getViewport({ scale: 1 });
      o.ratio = v0.height / v0.width;
      const vp = pg.getViewport({ scale: (w / v0.width) * d });
      o.wrap.style.width = w + 'px'; o.wrap.style.height = w * o.ratio + 'px';
      o.base.width = vp.width; o.base.height = vp.height;
      o.task?.cancel();
      o.task = pg.render({ canvasContext: o.base.getContext('2d'), viewport: vp });
      try { await o.task.promise; } catch (e) { if (e?.name === 'RenderingCancelledException') return; throw e; }
    } else {
      o.base.width = Math.round(w * d); o.base.height = Math.round(w * o.ratio * d);
      o.base.getContext('2d').drawImage(img, 0, 0, o.base.width, o.base.height);
    }
    for (const c of [o.base, o.ov]) { c.style.width = w + 'px'; c.style.height = w * o.ratio + 'px'; }
    o.ov.width = o.base.width; o.ov.height = o.base.height;
    redraw(o);
  }

  function drawStroke(ctx, s, w, d) {
    ctx.save();
    ctx.scale(d, d);
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.globalAlpha = s.t === 'hl' ? 0.35 : 1;
    ctx.strokeStyle = s.c;
    ctx.lineWidth = s.w * w;
    ctx.beginPath();
    s.p.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * w) : ctx.moveTo(x * w, y * w)));
    if (s.p.length === 1) ctx.lineTo(s.p[0][0] * w + 0.01, s.p[0][1] * w);
    ctx.stroke();
    ctx.restore();
  }
  function redraw(o, extra) {
    const ctx = o.ov.getContext('2d');
    ctx.clearRect(0, 0, o.ov.width, o.ov.height);
    const w = o.rw || W(), d = dpr();
    for (const s of strokes[o.n] || []) drawStroke(ctx, s, w, d);
    if (extra) drawStroke(ctx, extra, w, d);
  }

  function bindDraw(o) {
    let cur = null, erasing = false, raf = 0;
    // y 좌표도 가로폭 기준으로 정규화 (페이지 폭이 바뀌어도 위치 유지)
    const pt = (e) => { const r = o.ov.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.width]; };
    const erase = (p) => {
      const before = (strokes[o.n] || []).length;
      strokes[o.n] = (strokes[o.n] || []).filter((s) => !s.p.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.02));
      if (strokes[o.n].length !== before) { redraw(o); save(o.n, o.n); flash('저장 중…'); }
    };
    o.ov.addEventListener('pointerdown', (e) => {
      if (tool === 'scroll') return;
      e.preventDefault();
      o.ov.setPointerCapture(e.pointerId);
      const p = pt(e);
      if (tool === 'eraser') { erasing = true; erase(p); return; }
      cur = { t: tool === 'hl' ? 'hl' : 'pen', c: color, w: tool === 'hl' ? 0.022 : 0.0024, p: [p] };
      redraw(o, cur);
    });
    o.ov.addEventListener('pointermove', (e) => {
      if (erasing) return erase(pt(e));
      if (!cur) return;
      for (const ev of e.getCoalescedEvents?.() ?? [e]) cur.p.push(pt(ev));
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (cur) redraw(o, cur); });
    });
    const end = () => {
      erasing = false;
      if (!cur) return;
      (strokes[o.n] ||= []).push(cur);
      undo.push(o.n);
      cur = null;
      redraw(o);
      flash('저장 중…');
      save(o.n, o.n);
      onEvent?.('draw');
    };
    o.ov.addEventListener('pointerup', end);
    o.ov.addEventListener('pointercancel', end);
  }

  layout();
  io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && render(objs[e.target.dataset.n - 1])), { root: scroller, rootMargin: '900px 0px' });
  objs.forEach((o) => io.observe(o.wrap));

  const setTool = (t) => {
    tool = t;
    scroller.classList.toggle('drawing', t !== 'scroll');
    $$('.tool[data-tool]', root).forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  };
  function updateCurrent() {
    const top = scroller.getBoundingClientRect().top, mid = scroller.clientHeight / 3;
    for (const o of objs) {
      const r = o.wrap.getBoundingClientRect();
      if (r.top - top <= mid && r.bottom - top > mid) { current = o.n; break; }
    }
    const pg = $('#pg', root);
    if (pg) pg.textContent = `${current} / ${total}`;
  }
  let sraf = 0;
  scroller.addEventListener('scroll', () => { if (!sraf) sraf = requestAnimationFrame(() => { sraf = 0; updateCurrent(); }); });

  function setZoom(z) {
    const frac = scroller.scrollTop / Math.max(1, scroller.scrollHeight);
    zoom = Math.max(0.6, Math.min(2.5, z));
    layout();
    objs.forEach((o) => { o.rw = 0; io.unobserve(o.wrap); io.observe(o.wrap); });
    scroller.scrollTop = frac * scroller.scrollHeight;
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool]'); if (t) return setTool(t.dataset.tool);
    const c = e.target.closest('[data-color]');
    if (c) { color = c.dataset.color; $$('.dot', root).forEach((d) => d.classList.toggle('on', d === c)); if (tool === 'scroll' || tool === 'eraser') setTool('pen'); return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'back') onBack();
    if (a === 'zoomin') setZoom(zoom + 0.2);
    if (a === 'zoomout') setZoom(zoom - 0.2);
    if (a === 'undo') {
      const n = undo.pop();
      if (n && strokes[n]?.length) { strokes[n].pop(); redraw(objs[n - 1]); flash('저장 중…'); save(n, n); }
    }
    if (a === 'ask') { const p = $('.askp', root); p.hidden = !p.hidden; $('#askpg', root).textContent = `${current}쪽 기준`; if (!p.hidden) $('#askin', root).focus(); }
    if (a === 'askclose') $('.askp', root).hidden = true;
    const q = e.target.closest('[data-q]')?.dataset.q; if (q) sendAsk(q);
    if (a === 'mistake') onMistake({ page: current, capture: () => capture(current) });
  });
  const hist = [];
  async function sendAsk(q) {
    q = (q || '').trim(); if (!q) return;
    const box = $('#askmsgs', root);
    const add = (cls, t) => { const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = t; box.append(d); box.scrollTop = box.scrollHeight; return d; };
    if (box.firstElementChild?.tagName === 'P') box.innerHTML = '';
    add('u', q); const w = add('a', '생각 중…');
    $('#askpg', root).textContent = `${current}쪽 기준`;
    try {
      const image = await capture(current);
      const r = await store.ai('ask', { question: q, image, history: hist });
      w.textContent = r.answer || '(답변이 비어 있어요)';
      hist.push({ role: 'user', content: q }, { role: 'assistant', content: r.answer || '' });
      onEvent?.('ask');
    } catch (er) { w.textContent = '⚠️ ' + er.message; }
    box.scrollTop = box.scrollHeight;
  }
  $('.af', root)?.addEventListener('submit', (e) => { e.preventDefault(); const i = $('#askin', root); const v = i.value; i.value = ''; sendAsk(v); });
  const onResize = () => { layout(); objs.forEach((o) => { o.rw = 0; io.unobserve(o.wrap); io.observe(o.wrap); }); };
  window.addEventListener('resize', onResize);

  async function capture(n) {
    const o = objs[n - 1];
    await render(o);
    return toJpegB64(o.base, 1200);
  }

  requestAnimationFrame(() => {
    updateCurrent();
    if (page > 1 && objs[page - 1]) { objs[page - 1].wrap.scrollIntoView(); updateCurrent(); }
  });

  return {
    page: () => current,
    capture,
    destroy() { destroyed = true; io?.disconnect(); window.removeEventListener('resize', onResize); objs.forEach((o) => o.task?.cancel()); doc?.destroy?.(); },
  };
}
