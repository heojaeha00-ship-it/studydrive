import { $, $$, esc, toast, today, fmtDate, kind, REASONS, INTERVALS } from './util.js';
import { local } from './store-local.js';
import { cloud } from './store-cloud.js';
import { openDoc, pageText, pageImage } from './pdf.js';
import { mountViewer } from './viewer.js';

const cfg = window.SD_CONFIG || {};
const store = cfg.url && cfg.key ? cloud(cfg) : local();
const view = $('#view');
const nav = $('#nav');
const ICON = { pdf: '📕', image: '🖼️', text: '📝', other: '📄' };
let files = [], mistakes = [], viewer = null;
const filter = { cat: '전체', q: '' };

const ai = (action, payload) => store.ai(action, payload);

// ───────── 라우터 ─────────
async function route() {
  viewer?.destroy(); viewer = null;
  document.body.classList.remove('viewer-mode');
  const user = await store.auth.user();
  document.body.classList.toggle('auth', !user);
  if (!user) return authView();
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const [a, b] = path.split('/');
  renderNav(user, a || 'files');
  if (a === 'f' && b) return viewerView(b, Number(new URLSearchParams(qs).get('p')) || 1);
  if (a === 'review') return reviewView();
  if (a === 'mistakes') return mistakesView();
  return filesView();
}
window.addEventListener('hashchange', route);

function renderNav(user, active) {
  nav.innerHTML = `
    <div class="brand">📚 <span>스터디드라이브</span></div>
    <a href="#/files" class="${active === 'files' || active === 'f' ? 'on' : ''}"><i>🗂️</i><span>내 파일</span></a>
    <a href="#/review" class="${active === 'review' ? 'on' : ''}"><i>🔁</i><span>오늘 복습</span><b id="due-badge" hidden></b></a>
    <a href="#/mistakes" class="${active === 'mistakes' ? 'on' : ''}"><i>📒</i><span>오답노트</span></a>
    <div class="who"><span title="${esc(user.email || '')}">${esc(user.email || '')}</span>${store.mode === 'cloud' ? '<button class="btn ghost sm" id="logout">로그아웃</button>' : '<em>로컬 모드</em>'}</div>`;
  $('#logout')?.addEventListener('click', async () => { await store.auth.signOut(); route(); });
  store.mistakes.list().then((m) => { mistakes = m; badge(); }).catch(() => {});
}
const due = () => mistakes.filter((m) => !m.graduated && m.next_review <= today());
function badge() { const b = $('#due-badge'); if (b) { const n = due().length; b.hidden = !n; b.textContent = n; } }

// ───────── 로그인 ─────────
function authView() {
  nav.innerHTML = '';
  view.innerHTML = `
    <div class="auth-card">
      <div class="logo">📚</div>
      <h1>스터디드라이브</h1>
      <p class="muted">태블릿·폰·PC 어디서든 이어서 공부하는<br>AI 학습 드라이브</p>
      <form id="af">
        <input type="email" name="email" placeholder="이메일" required autocomplete="email">
        <input type="password" name="pw" placeholder="비밀번호 (6자 이상)" required minlength="6" autocomplete="current-password">
        <div class="row"><button class="btn primary grow" data-m="in">로그인</button><button class="btn grow" type="button" data-m="up">회원가입</button></div>
      </form>
      ${cfg.demoEmail ? '<button class="btn ghost" id="demo">🎯 데모 계정으로 바로 체험</button>' : ''}
    </div>`;
  const go = async (m, email, pw) => {
    try { await (m === 'up' ? store.auth.signUp(email, pw) : store.auth.signIn(email, pw)); route(); } catch (e) { toast(e.message, 5000); }
  };
  const f = $('#af');
  f.addEventListener('submit', (e) => { e.preventDefault(); go('in', f.email.value, f.pw.value); });
  $('[data-m=up]', f).addEventListener('click', () => f.reportValidity() && go('up', f.email.value, f.pw.value));
  $('#demo')?.addEventListener('click', () => go('in', cfg.demoEmail, cfg.demoPassword));
}

// ───────── 내 파일 ─────────
async function filesView() {
  view.innerHTML = `
    <header class="vh"><h2>내 파일</h2>
      <div class="row">
        <input id="q" type="search" placeholder="🔍 검색" value="${esc(filter.q)}">
        <label class="btn primary">＋ 업로드<input id="up" type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md"></label>
      </div>
    </header>
    <div id="banner"></div><div id="chips" class="chips"></div><div id="grid" class="grid"></div>
    <div id="drop" class="drop">여기에 놓아서 업로드</div>`;
  $('#grid').innerHTML = '<p class="muted">불러오는 중…</p>';
  try { [files, mistakes] = await Promise.all([store.files.list(), store.mistakes.list()]); } catch (e) { return void ($('#grid').innerHTML = `<p class="muted">불러오기 실패: ${esc(e.message)}</p>`); }
  badge();
  drawFiles();
  $('#q').addEventListener('input', (e) => { filter.q = e.target.value; drawFiles(); });
  $('#up').addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = ''; });
  const drop = $('#drop');
  addEventListener('dragover', (e) => { if ($('#grid')) { e.preventDefault(); drop.classList.add('on'); } });
  addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.classList.remove('on'); });
  addEventListener('drop', (e) => { if ($('#grid')) { e.preventDefault(); drop.classList.remove('on'); handleFiles([...e.dataTransfer.files]); } });
}

function drawFiles() {
  const cats = [...new Set(files.map((f) => f.category || '미분류'))].sort();
  if (filter.cat !== '전체' && !cats.includes(filter.cat)) filter.cat = '전체';
  const n = due().length;
  $('#banner').innerHTML = n ? `<a class="banner" href="#/review">🔁 오늘 복습할 오답 <b>${n}개</b>가 있어요 →</a>` : '';
  $('#chips').innerHTML = ['전체', ...cats].map((c) => `<button class="chip${filter.cat === c ? ' on' : ''}" data-c="${esc(c)}">${esc(c)} <small>${c === '전체' ? files.length : files.filter((f) => (f.category || '미분류') === c).length}</small></button>`).join('');
  const q = filter.q.trim().toLowerCase();
  const list = files.filter((f) => (filter.cat === '전체' || (f.category || '미분류') === filter.cat) && (!q || `${f.name} ${f.category} ${(f.tags || []).join(' ')} ${f.summary || ''}`.toLowerCase().includes(q)));
  $('#grid').innerHTML = list.length ? list.map((f) => `
    <article class="card file" data-id="${f.id}">
      <div class="fi">${ICON[kind(f.name, f.mime)]}</div>
      <div class="fb">
        <h3>${esc(f.name)}</h3>
        <div class="meta"><span class="badge" data-act="cat">${esc(f.category || '미분류')}</span>${(f.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
        ${f.summary ? `<p class="sum">${esc(f.summary)}</p>` : ''}
        <div class="foot"><small>${fmtDate(f.created_at)} · ${f.size < 1048576 ? Math.max(1, Math.round(f.size / 1024)) + 'KB' : (f.size / 1048576).toFixed(1) + 'MB'}</small>
          <span><button class="lnk" data-act="reclass">AI 분류</button><button class="lnk" data-act="rename">이름</button><button class="lnk danger" data-act="del">삭제</button></span></div>
      </div>
    </article>`).join('') : `<div class="empty"><div>📂</div><p>${files.length ? '검색 결과가 없어요' : '아직 파일이 없어요.<br>PDF 문제집이나 노트를 올려 보세요. AI가 알아서 분류해 줘요.'}</p></div>`;
}

view.addEventListener('click', async (e) => {
  const chip = e.target.closest('.chip');
  if (chip && $('#grid')) { filter.cat = chip.dataset.c; return drawFiles(); }
  const card = e.target.closest('.file');
  if (!card) return;
  const row = files.find((f) => f.id === card.dataset.id);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return void (location.hash = `#/f/${row.id}`);
  e.stopPropagation();
  if (act === 'cat') {
    const v = prompt('카테고리 이름', row.category || '');
    if (v?.trim()) update(row, { category: v.trim() });
  } else if (act === 'rename') {
    const v = prompt('파일 이름', row.name);
    if (v?.trim()) update(row, { name: v.trim() });
  } else if (act === 'del') {
    if (confirm(`"${row.name}"을(를) 삭제할까요? 필기도 함께 삭제돼요.`)) {
      try { await store.files.remove(row); files = files.filter((f) => f.id !== row.id); drawFiles(); } catch (er) { toast('삭제 실패: ' + er.message); }
    }
  } else if (act === 'reclass') classify(row, true);
});

async function update(row, patch) {
  try { const n = await store.files.update(row, patch); files = files.map((f) => (f.id === n.id ? n : f)); drawFiles(); } catch (e) { toast('저장 실패: ' + e.message); }
}

async function classify(row, manual = false) {
  const t = toast(`🤖 AI가 "${row.name}"을(를) 분류하는 중…`, 0);
  try {
    const blob = await store.files.blob(row);
    const type = kind(row.name, row.mime);
    let text = '', image = null;
    if (type === 'pdf') {
      const doc = await openDoc(blob);
      for (let i = 1; i <= Math.min(2, doc.numPages) && text.length < 2000; i++) text += (await pageText(doc, i)) + '\n';
      if (text.trim().length < 80) image = await pageImage(blob, 'pdf', 1, 900);
    } else if (type === 'text') text = (await blob.text()).slice(0, 2000);
    else if (type === 'image') image = await pageImage(blob, 'image', 1, 900);
    const r = await ai('classify', { name: row.name, text, image, categories: [...new Set(files.map((f) => f.category).filter((c) => c && c !== '미분류'))] });
    await update(row, { category: r.category || '미분류', tags: (r.tags || []).slice(0, 4), summary: r.summary || '' });
    t.close(); toast(`분류 완료: ${r.category}`);
  } catch (e) { t.close(); toast('AI 분류 실패: ' + e.message, 4500); }
}

async function handleFiles(list) {
  for (const f of list) {
    if (kind(f.name, f.type) === 'other') { toast(`${f.name}: PDF·이미지·텍스트만 올릴 수 있어요`, 4000); continue; }
    if (f.size > 50 * 1048576) { toast(`${f.name}: 50MB를 넘어요`, 4000); continue; }
    const t = toast(`⬆️ 업로드 중… ${f.name}`, 0);
    try {
      const row = await store.files.add(f);
      files.unshift(row); drawFiles(); t.close();
      await classify(row);
    } catch (e) { t.close(); toast('업로드 실패: ' + e.message, 5000); }
  }
}

// ───────── 뷰어 ─────────
async function viewerView(id, page) {
  document.body.classList.add('viewer-mode');
  if (!files.length) try { files = await store.files.list(); } catch {}
  const row = files.find((f) => f.id === id);
  if (!row) { view.innerHTML = '<p class="pad muted">파일을 찾을 수 없어요. <a href="#/files">목록으로</a></p>'; return; }
  view.innerHTML = '<div class="viewer"></div>';
  viewer = await mountViewer($('.viewer'), { store, row, page, onBack: () => (location.hash = '#/files'), onMistake: (ctx) => mistakeDialog({ file: row, ...ctx }) });
}

// ───────── 오답 등록 / AI 해설 ─────────
function mistakeDialog({ file, page, capture }) {
  const d = $('#dlg');
  d.innerHTML = `
    <form class="dlg-body">
      <h3>오답 등록</h3>
      <p class="muted">${esc(file.name)} · ${page}쪽</p>
      <label>문제 번호/이름<input name="label" placeholder="예: Part5 #103" required></label>
      <label>틀린 이유<select name="reason">${REASONS.map((r) => `<option>${r}</option>`).join('')}</select></label>
      <label>메모 (선택)<textarea name="memo" rows="3" placeholder="헷갈렸던 포인트"></textarea></label>
      <label class="chk"><input type="checkbox" name="ai" checked> 저장하고 AI 해설·유사 문제 받기</label>
      <div class="row end"><button type="button" class="btn ghost" data-x>취소</button><button class="btn primary">저장</button></div>
    </form>`;
  d.showModal();
  const f = $('form', d);
  f.label.focus();
  $('[data-x]', d).onclick = () => d.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const img = f.ai.checked ? await capture().catch(() => null) : null;
    const v = { label: f.label.value.trim(), reason: f.reason.value, memo: f.memo.value.trim(), want: f.ai.checked };
    d.close();
    try {
      const m = await store.mistakes.add({ file_id: file.id, file_name: file.name, page, label: v.label, reason: v.reason, memo: v.memo, stage: 0, next_review: today(1), graduated: false });
      mistakes.unshift(m); badge();
      toast('📒 오답노트에 저장했어요. 내일 복습 알림이 떠요');
      if (v.want) explain(m, img);
    } catch (er) { toast('저장 실패: ' + er.message, 5000); }
  };
}

async function explain(m, image) {
  const t = toast('🤖 AI 해설 생성 중… (10~20초)', 0);
  try {
    if (!image && m.file_id) {
      const row = files.find((f) => f.id === m.file_id);
      if (row) image = await pageImage(await store.files.blob(row), kind(row.name, row.mime), m.page || 1);
    }
    const r = await ai('explain', { label: m.label, reason: m.reason, memo: m.memo, image });
    const n = await store.mistakes.update(m.id, { ai: r });
    mistakes = mistakes.map((x) => (x.id === n.id ? n : x));
    t.close(); toast('✅ AI 해설이 준비됐어요');
    if ($('#mlist')) drawMistakes();
    if ($('#rv')) drawReview();
  } catch (e) { t.close(); toast('AI 해설 실패: ' + e.message, 5000); }
}

const P = (s) => `<p class="pre">${esc(s)}</p>`;
function aiHtml(a) {
  if (!a) return '';
  return `<div class="ai">
    ${a.translation ? `<h4>해석</h4>${P(a.translation)}` : ''}
    ${a.answer ? `<h4>정답과 근거</h4>${P(a.answer)}` : ''}
    ${a.reason ? `<h4>틀린 이유</h4>${P(a.reason)}` : ''}
    ${a.tip ? `<h4>다음엔 이렇게</h4>${P(a.tip)}` : ''}
    ${(a.similar || []).map((s, i) => `<details class="sim"><summary>유사 문제 ${i + 1}</summary>${P(s.question)}<ul>${(s.choices || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul><details><summary>정답·해설 보기</summary>${P(`${s.answer} — ${s.explanation}`)}</details></details>`).join('')}
  </div>`;
}

// ───────── 오늘 복습 ─────────
let queue = [], qi = 0, done = { ok: 0, ng: 0 };
async function reviewView() {
  view.innerHTML = '<p class="muted pad">불러오는 중…</p>';
  try { [mistakes, files] = await Promise.all([store.mistakes.list(), files.length ? files : store.files.list()]); } catch (e) { view.innerHTML = `<p class="pad muted">${esc(e.message)}</p>`; return; }
  badge();
  queue = due(); qi = 0; done = { ok: 0, ng: 0 };
  view.innerHTML = '<div id="rv" class="narrow"></div>';
  drawReview();
}
function drawReview() {
  const rv = $('#rv'); if (!rv) return;
  if (!queue.length || qi >= queue.length) {
    const nxt = mistakes.filter((m) => !m.graduated).map((m) => m.next_review).sort()[0];
    rv.innerHTML = `<div class="empty"><div>${queue.length ? '🎉' : '✅'}</div><h2>${queue.length ? '오늘 복습 끝!' : '오늘 복습할 오답이 없어요'}</h2>
      ${queue.length ? `<p>맞힘 ${done.ok} · 또 틀림 ${done.ng}</p>` : ''}<p class="muted">${nxt ? `다음 복습: ${nxt}` : '파일을 풀다가 틀린 문제를 오답 등록해 보세요.'}</p><a class="btn primary" href="#/files">내 파일로</a></div>`;
    return;
  }
  const m = queue[qi];
  rv.innerHTML = `
    <div class="prog"><div style="width:${(qi / queue.length) * 100}%"></div></div>
    <p class="muted">${qi + 1} / ${queue.length} · ${m.stage + 1}번째 복습</p>
    <article class="card big">
      <h2>${esc(m.label)}</h2>
      <p class="muted">${esc(m.file_name || '')} ${m.page ? `· ${m.page}쪽` : ''} · <span class="badge">${esc(m.reason)}</span></p>
      ${m.memo ? P('📝 ' + m.memo) : ''}
      <p>👉 원본에서 <b>답을 가리고 다시 풀어 보세요.</b></p>
      <div class="row">${m.file_id ? `<a class="btn" href="#/f/${m.file_id}?p=${m.page || 1}">원본 열기</a>` : ''}
        ${m.ai ? '' : '<button class="btn" id="mkai">🤖 AI 해설 받기</button>'}</div>
      ${m.ai ? `<details><summary>AI 해설·유사 문제 보기</summary>${aiHtml(m.ai)}</details>` : ''}
    </article>
    <div class="row sp"><button class="btn bad grow" data-r="ng">또 틀렸어요</button><button class="btn good grow" data-r="ok">맞았어요 ✓</button></div>`;
  $('#mkai')?.addEventListener('click', () => explain(m));
  $$('[data-r]', rv).forEach((b) => b.addEventListener('click', async () => {
    const ok = b.dataset.r === 'ok';
    const s = ok ? m.stage + 1 : 0;
    const patch = ok ? (s >= INTERVALS.length ? { graduated: true, stage: s, last_result: 'ok' } : { stage: s, next_review: today(INTERVALS[s]), last_result: 'ok' }) : { stage: 0, next_review: today(1), last_result: 'ng' };
    try { const n = await store.mistakes.update(m.id, patch); mistakes = mistakes.map((x) => (x.id === n.id ? n : x)); queue[qi] = n; } catch (e) { return toast('저장 실패: ' + e.message); }
    done[ok ? 'ok' : 'ng']++; qi++; badge(); drawReview();
  }));
}

// ───────── 오답노트 ─────────
let mf = '전체';
async function mistakesView() {
  view.innerHTML = '<p class="muted pad">불러오는 중…</p>';
  try { mistakes = await store.mistakes.list(); if (!files.length) files = await store.files.list(); } catch (e) { view.innerHTML = `<p class="pad muted">${esc(e.message)}</p>`; return; }
  badge();
  view.innerHTML = `<header class="vh"><h2>오답노트</h2><button class="btn primary" id="weak">🤖 AI 약점 분석</button></header>
    <div id="wk"></div><div id="stats" class="card"></div><div id="mchips" class="chips"></div><div id="mlist"></div>`;
  $('#weak').addEventListener('click', weakness);
  drawMistakes();
}
function drawMistakes() {
  const by = REASONS.map((r) => [r, mistakes.filter((m) => m.reason === r).length]).filter((x) => x[1]);
  const max = Math.max(1, ...by.map((x) => x[1]));
  const grad = mistakes.filter((m) => m.graduated).length;
  $('#stats').innerHTML = mistakes.length ? `<h4>틀린 이유 분포 <small class="muted">총 ${mistakes.length}개 · 졸업 ${grad}개 · 오늘 복습 ${due().length}개</small></h4>${by.map(([r, n]) => `<div class="bar"><span>${r}</span><i style="width:${(n / max) * 100}%"></i><b>${n}</b></div>`).join('')}` : '<p class="muted">아직 오답이 없어요. 파일 뷰어에서 [오답 등록]을 눌러 시작하세요.</p>';
  $('#mchips').innerHTML = ['전체', ...REASONS].map((r) => `<button class="chip${mf === r ? ' on' : ''}" data-r="${r}">${r}</button>`).join('');
  const list = mistakes.filter((m) => mf === '전체' || m.reason === mf);
  $('#mlist').innerHTML = list.map((m) => `
    <article class="card m" data-id="${m.id}">
      <div class="mh"><b>${esc(m.label)}</b><span class="badge">${esc(m.reason)}</span>${m.graduated ? '<span class="badge ok">졸업</span>' : `<small class="muted">다음 복습 ${m.next_review}</small>`}</div>
      <small class="muted">${esc(m.file_name || '')} ${m.page ? `· ${m.page}쪽` : ''}</small>
      ${m.memo ? P(m.memo) : ''}
      <div class="row">${m.file_id ? `<a class="lnk" href="#/f/${m.file_id}?p=${m.page || 1}">원본 열기</a>` : ''}${m.ai ? '' : '<button class="lnk" data-act="ai">AI 해설</button>'}<button class="lnk danger" data-act="del">삭제</button></div>
      ${m.ai ? `<details><summary>AI 해설·유사 문제</summary>${aiHtml(m.ai)}</details>` : ''}
    </article>`).join('');
  $$('#mchips .chip').forEach((c) => (c.onclick = () => { mf = c.dataset.r; drawMistakes(); }));
  $$('#mlist [data-act]').forEach((b) => (b.onclick = async () => {
    const m = mistakes.find((x) => x.id === b.closest('.m').dataset.id);
    if (b.dataset.act === 'ai') explain(m);
    else if (confirm('이 오답을 삭제할까요?')) { await store.mistakes.remove(m.id); mistakes = mistakes.filter((x) => x.id !== m.id); badge(); drawMistakes(); }
  }));
}
async function weakness() {
  if (!mistakes.length) return toast('오답이 있어야 분석할 수 있어요');
  const t = toast('🤖 약점 분석 중…', 0);
  try {
    const r = await ai('weakness', { mistakes: mistakes.slice(0, 60).map((m) => ({ label: m.label, reason: m.reason, memo: m.memo, file: m.file_name, result: m.last_result })) });
    $('#wk').innerHTML = `<div class="card ai"><h4>AI 진단</h4>${P(r.summary)}${(r.weaknesses || []).map((w) => `<p><b>${esc(w.topic)}</b><br>${esc(w.advice)}</p>`).join('')}<h4>이번 주 계획</h4><ul>${(r.plan || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    t.close();
  } catch (e) { t.close(); toast('분석 실패: ' + e.message, 5000); }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
route();
