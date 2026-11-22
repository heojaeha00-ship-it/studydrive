import { $, $$, esc, toast, kind, ico, uuid } from './util.js';
import { openDoc, toJpegB64 } from './pdf.js';

const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#111827', '#f59e0b'];

export async function mountViewer(root, { store, row, page = 1, onMistake, onBack, onEvent, onAppend, onCards, onAddCard, onLive }) {
  const type = kind(row.name, row.mime);
  const isPaged = type === 'pdf' || type === 'image';
  root.innerHTML = `
    <div class="vbar">
      <button class="btn ghost" data-a="back">← 목록</button>
      <div class="vtitle" title="${esc(row.name)}">${esc(row.name)}</div>
      ${isPaged ? `
      <div class="tools">
        <button class="tool on" data-tool="scroll" title="스크롤" aria-label="스크롤">${ico('pointer', 18)}</button>
        <button class="tool" data-tool="pen" title="펜" aria-label="펜">${ico('pen', 18)}</button>
        <button class="tool" data-tool="hl" title="형광펜" aria-label="형광펜">${ico('mark', 18)}</button>
        <button class="tool" data-tool="circle" title="동그라미 쳐서 오답 등록" aria-label="동그라미 오답"><span class="cm">⭕</span></button>
        <button class="tool" data-tool="eraser" title="지우개" aria-label="지우개">${ico('eraser', 18)}</button>
        <span class="colors">${COLORS.map((c, i) => `<button class="dot${i === 0 ? ' on' : ''}" data-color="${c}" style="background:${c}" aria-label="색 ${i + 1}"></button>`).join('')}</span>
        <button class="tool" data-a="undo" title="되돌리기" aria-label="되돌리기">${ico('undo', 18)}</button>
        <button class="tool" data-a="zoomout" title="축소" aria-label="축소">${ico('minus', 18)}</button>
        <button class="tool" data-a="zoomin" title="확대" aria-label="확대">${ico('plus', 18)}</button>
        <span class="pg" id="pg">1 / 1</span>
        <button class="btn sm" data-a="cards" title="이 쪽으로 암기 카드 만들기">${ico('cards', 16)} 카드</button>
        <button class="btn sm" data-a="ask">${ico('chat', 16)} AI 질문</button>
        <button class="btn primary sm" data-a="mistake">오답 등록</button>
        <span class="saved" id="saved"></span>
      </div>` : type === 'text' ? `<div class="tools"><button class="btn primary sm" data-a="savetext">저장</button><span class="saved" id="saved"></span></div>` : ''}
    </div>
    <div class="vscroll"><div class="vpages"></div></div>
    <aside class="askp" hidden>
      <div class="ah"><b>💬 AI에게 질문</b><small class="muted" id="askpg"></small><button class="lnk" data-a="askclose">닫기</button></div>
      <div class="am" id="askmsgs"><p class="muted">지금 보는 쪽을 바탕으로 답해요.</p></div>
      <div class="aq">${['이 쪽 요약', '핵심 어휘 정리', '퀴즈 3문제 만들기'].map((q) => `<button class="chip" data-q="${q}">${q}</button>`).join('')}</div>
      <form class="af"><input id="askin" placeholder="궁금한 걸 물어보세요" autocomplete="off"><button class="btn primary sm">보내기</button></form>
    </aside>`;

  const scroller = $('.vscroll', root);
  const pagesEl = $('.vpages', root);
  const savedEl = $('#saved', root);
  let tool = 'scroll', color = COLORS[0], zoom = 1, destroyed = false;
  const strokes = {}; // page -> [stroke]
  let drawingPage = 0;
  const undo = []; // 내가 그린 획 id
  const liveS = new Map(); // 다른 기기에서 그리는 중인 획
  const objs = [];
  let io, current = 1, doc = null, img = null, blob = null;

  const flash = (t) => { if (savedEl) { savedEl.textContent = t; } };
  const persistAdd = async (page, st) => { try { await store.ann.add(row.id, page, st); flash('저장됨 ✓'); } catch (e) { flash('저장 실패'); toast('필기 저장 실패: ' + e.message); } };
  const persistDel = async (ids) => { try { await store.ann.remove(ids); flash('저장됨 ✓'); } catch { flash('저장 실패'); } };

  try { blob = await store.files.blob(row); } catch (e) { pagesEl.innerHTML = `<p class="muted pad">파일을 불러오지 못했어요: ${esc(e.message)}</p>`; return { destroy() {}, capture: async () => null, page: () => 1 }; }

  // ── 텍스트/메모 파일: 바로 편집 ──
  if (type === 'text') {
    const text = await blob.text();
    pagesEl.innerHTML = `<textarea class="texted" spellcheck="false">${esc(text)}</textarea>`;
    const ta = $('.texted', root), tg = document.createElement('div');
    tg.className = 'rtag'; tg.hidden = true; root.append(tg);
    let lastTyped = 0, sendT = 0, saveT = 0, tagT2 = 0, dirty = false;
    const doSave = async () => { dirty = false; try { row = await store.files.replace(row, new Blob([ta.value], { type: row.mime || 'text/plain' })); flash('저장됨 ✓'); } catch { flash('저장 실패'); } };
    ta.addEventListener('input', () => {
      lastTyped = Date.now(); dirty = true; flash('저장 중…');
      clearTimeout(sendT); sendT = setTimeout(() => onLive?.({ k: 't', fid: row.id, text: ta.value }), 120);
      clearTimeout(saveT); saveT = setTimeout(doSave, 1000);
    });
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'back') onBack();
      if (a === 'savetext') doSave();
    });
    return {
      live(p) {
        if (p.k !== 't' || p.fid !== row.id || Date.now() - lastTyped < 1500) return;
        const pos = ta.selectionStart; ta.value = p.text; ta.setSelectionRange(Math.min(pos, p.text.length), Math.min(pos, p.text.length));
        tg.textContent = '✍️ 다른 기기에서 편집했어요'; tg.hidden = false; clearTimeout(tagT2); tagT2 = setTimeout(() => { tg.hidden = true; }, 2000);
      },
      remoteAdd() {}, remoteDel() {}, capture: async () => null, page: () => 1,
      destroy() { clearTimeout(saveT); if (dirty) doSave(); },
    };
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
    try { doc = await openDoc(blob); } catch (e) { pagesEl.innerHTML = `<p class="muted pad">이 브라우저에서는 PDF를 열 수 없어요. 최신 Chrome·Safari로 열어 주세요.</p>`; return { destroy() {}, capture: async () => null, page: () => 1 }; }
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

  function addPageEl(n) {
    const wrap = document.createElement('div');
    wrap.className = 'vpage';
    wrap.dataset.n = n;
    wrap.innerHTML = '<canvas class="base"></canvas><canvas class="ov"></canvas>';
    pagesEl.append(wrap);
    const o = { n, wrap, base: $('.base', wrap), ov: $('.ov', wrap), rw: 0, ratio, task: null };
    objs.push(o);
    bindDraw(o);
    return o;
  }
  for (let n = 1; n <= total; n++) addPageEl(n);

  // 노트: 맨 아래까지 내리면 새 페이지가 자동으로 붙어요 (삼성 노트 PDF처럼)
  const isNote = type === 'pdf' && row.tags?.includes('노트') && !!onAppend;
  let adding = false, lastAdd = 0;
  async function maybeAppend() {
    if (!isNote || adding || destroyed || total >= 300) return;
    if (scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 80) return;
    if (Date.now() - lastAdd < 800) return;
    adding = true;
    try {
      const { blob: nb, count } = await onAppend();
      doc = await openDoc(nb);
      for (let n = total + 1; n <= count; n++) { const o = addPageEl(n); o.wrap.style.width = W() + 'px'; o.wrap.style.height = W() * o.ratio + 'px'; io.observe(o.wrap); }
      total = count;
      updateCurrent();
    } catch (e) { toast('쪽 추가 실패: ' + e.message); }
    finally { adding = false; lastAdd = Date.now(); }
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
    for (const l of liveS.values()) if (l.page === o.n) drawStroke(ctx, l.s, w, d);
    if (extra) drawStroke(ctx, extra, w, d);
  }

  function bindDraw(o) {
    let cur = null, erasing = false, raf = 0, lastSend = 0, sentN = 0;
    // y 좌표도 가로폭 기준으로 정규화 (페이지 폭이 바뀌어도 위치 유지)
    const pt = (e) => { const r = o.ov.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.width]; };
    const sendLive = () => {
      if (!cur || cur.p.length <= sentN) return;
      onLive?.({ k: 's', fid: row.id, page: o.n, id: cur.id, t: cur.t, c: cur.c, w: cur.w, pts: cur.p.slice(sentN) });
      sentN = cur.p.length;
    };
    const erase = (p) => {
      const gone = [];
      strokes[o.n] = (strokes[o.n] || []).filter((s) => { const hit = s.p.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.02); if (hit) gone.push(s.id); return !hit; });
      if (gone.length) { redraw(o); flash('저장 중…'); persistDel(gone); }
    };
    o.ov.addEventListener('pointerdown', (e) => {
      if (tool === 'scroll') return;
      e.preventDefault();
      o.ov.setPointerCapture(e.pointerId);
      const p = pt(e); drawingPage = o.n;
      if (tool === 'eraser') { erasing = true; erase(p); return; }
      if (tool === 'circle') { cur = { id: 'c', t: 'circle', c: '#e03131', w: 0.0034, p: [p] }; redraw(o, cur); return; }
      cur = { id: uuid(), t: tool === 'hl' ? 'hl' : 'pen', c: color, w: tool === 'hl' ? 0.022 : 0.0024, p: [p] }; sentN = 0;
      redraw(o, cur); sendLive();
    });
    o.ov.addEventListener('pointermove', (e) => {
      if (erasing) return erase(pt(e));
      if (!cur) return;
      for (const ev of e.getCoalescedEvents?.() ?? [e]) cur.p.push(pt(ev));
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (cur) redraw(o, cur); });
      if (cur.t === 'circle') return;
      const now = performance.now(); if (now - lastSend > 55) { lastSend = now; sendLive(); }
    });
    const end = () => {
      erasing = false; drawingPage = 0;
      if (!cur) return;
      if (cur.t === 'circle') {
        const c = cur; cur = null; redraw(o);
        const xs = c.p.map((q) => q[0]), ys = c.p.map((q) => q[1]);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        if (c.p.length < 8 || x1 - x0 < 0.06 || y1 - y0 < 0.03) { flash('동그라미를 조금 더 크게 그려 주세요'); return; }
        const closed = Math.hypot(c.p[0][0] - c.p.at(-1)[0], c.p[0][1] - c.p.at(-1)[1]) < Math.max(x1 - x0, y1 - y0) * 0.6;
        if (!closed) { flash('동그라미를 닫아 주세요'); return; }
        redraw(o, { ...c, p: [...c.p, c.p[0]] });
        const W0 = o.base.width, pad = 0.03;
        const sx = Math.max(0, (x0 - pad) * W0), sy = Math.max(0, (y0 - pad) * W0), sw = Math.min(W0 - sx, (x1 - x0 + pad * 2) * W0), sh = Math.min(o.base.height - sy, (y1 - y0 + pad * 2) * W0);
        const cv = document.createElement('canvas'); const k = Math.min(1, 1000 / sw); cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
        cv.getContext('2d').drawImage(o.base, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
        const url = cv.toDataURL('image/jpeg', 0.8);
        setTimeout(() => redraw(o), 900);
        onMistake({ page: o.n, capture: async () => url.split(',')[1], crop: url, auto: true });
        return;
      }
      sendLive();
      const st = cur; cur = null;
      (strokes[o.n] ||= []).push(st);
      undo.push(st.id);
      redraw(o);
      flash('저장 중…');
      persistAdd(o.n, st);
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
  scroller.addEventListener('scroll', () => { if (!sraf) sraf = requestAnimationFrame(() => { sraf = 0; updateCurrent(); maybeAppend(); }); });

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
      const id = undo.pop();
      if (id) for (const k of Object.keys(strokes)) { const i = strokes[k].findIndex((x) => x.id === id); if (i >= 0) { strokes[k].splice(i, 1); redraw(objs[k - 1]); flash('저장 중…'); persistDel([id]); break; } }
    }
    if (a === 'ask') { const p = $('.askp', root); p.hidden = !p.hidden; root.classList.toggle('asking', !p.hidden); $('#askpg', root).textContent = `${current}쪽 기준`; if (!p.hidden) $('#askin', root).focus(); }
    if (a === 'cards') showCards();
    if (a === 'askclose') { $('.askp', root).hidden = true; root.classList.remove('asking'); }
    const q = e.target.closest('[data-q]')?.dataset.q; if (q) sendAsk(q);
    if (a === 'mistake') onMistake({ page: current, capture: () => capture(current) });
  });
  let cardsBusy = false;
  async function showCards() {
    if (cardsBusy) return;
    cardsBusy = true;
    const pg = current;
    const p = $('.askp', root); p.hidden = false; root.classList.add('asking');
    const box = $('#askmsgs', root); box.innerHTML = '<p class="muted">카드를 만드는 중…</p>';
    let cards = [];
    try { cards = await onCards?.(await capture(pg)) || []; } catch { cards = []; } finally { cardsBusy = false; }
    box.innerHTML = cards.length ? cards.map((c, i) => `<div class="msg a cardmsg"><b>${esc(c.front)}</b><br>${esc(c.back)}<br><button class="lnk" data-card="${i}">복습에 추가</button></div>`).join('') : '<p class="muted">카드를 만들지 못했어요.</p>';
    $$('[data-card]', box).forEach((b) => (b.onclick = async () => { b.disabled = true; try { await onAddCard?.(cards[b.dataset.card], pg); b.textContent = '추가됨 ✓'; } catch { b.disabled = false; toast('카드 추가 실패'); } }));
  }
  const tag = document.createElement('div'); tag.className = 'rtag'; tag.hidden = true; root.append(tag);
  let tagT = 0;
  function showTag(device) { tag.textContent = `✍️ ${device || '다른 기기'}에서 필기 중`; tag.hidden = false; clearTimeout(tagT); tagT = setTimeout(() => { tag.hidden = true; }, 2400); }
  function remoteAdd(fid, page, st, device) {
    if (fid !== row.id) return;
    const arr = (strokes[page] ||= []);
    liveS.delete(st.id);
    if (arr.some((x) => x.id === st.id)) return; // 내가 그린 획의 되돌아온 알림
    arr.push(st);
    const o = objs[page - 1]; if (!o) return;
    redraw(o); o.wrap.classList.remove('rflash'); void o.wrap.offsetWidth; o.wrap.classList.add('rflash');
    showTag(device);
  }
  function remoteDel(id) {
    for (const k of Object.keys(strokes)) { const i = strokes[k].findIndex((x) => x.id === id); if (i >= 0) { strokes[k].splice(i, 1); const o = objs[k - 1]; if (o) redraw(o); return; } }
  }
  function live(p) {
    if (p.fid !== row.id || p.k !== 's') return;
    let l = liveS.get(p.id);
    if (!l) { l = { page: p.page, s: { id: p.id, t: p.t, c: p.c, w: p.w, p: [] }, at: 0 }; liveS.set(p.id, l); }
    l.s.p.push(...p.pts); l.at = Date.now();
    const o = objs[p.page - 1]; if (o) redraw(o);
    showTag(p.from ? '다른 기기' : '');
  }
  const liveGc = setInterval(() => { for (const [id, l] of liveS) if (Date.now() - l.at > 4000) { liveS.delete(id); const o = objs[l.page - 1]; if (o) redraw(o); } }, 2000);
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
  const onVis = async () => {
    if (document.visibilityState !== 'visible' || destroyed) return;
    try { const fresh = await store.ann.get(row.id); for (const k of Object.keys(strokes)) delete strokes[k]; Object.assign(strokes, fresh); objs.forEach((o) => redraw(o)); } catch {}
  };
  document.addEventListener('visibilitychange', onVis);
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
    remoteAdd, remoteDel, live,
    page: () => current,
    capture,
    destroy() { destroyed = true; clearInterval(liveGc); document.removeEventListener('visibilitychange', onVis); io?.disconnect(); window.removeEventListener('resize', onResize); objs.forEach((o) => o.task?.cancel()); doc?.destroy?.(); },
  };
}
