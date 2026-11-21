import { $, $$, esc, toast, today, fmtDate, kind, REASONS, INTERVALS } from './util.js';
import { local } from './store-local.js';
import { cloud } from './store-cloud.js';
import { openDoc, pageText, pageImage } from './pdf.js';
import { mountViewer } from './viewer.js';
import { TEMPLATES, PRESETS, SCENARIOS } from './templates.js';

const cfg = window.SD_CONFIG || {};
const store = cfg.url && cfg.key ? cloud(cfg) : local();
const view = $('#view');
const nav = $('#nav');
const ICON = { pdf: '📕', image: '🖼️', text: '📝', other: '📄' };
let files = [], mistakes = [], viewer = null;
const filter = { cat: '전체', q: '' };
let S = { intervals: INTERVALS, reasons: REASONS, cats: [], activity: {}, flags: {}, tpl: null, seen: false };

const ai = (action, payload) => store.ai(action, payload);
const saveS = () => store.settings.set(S).catch(() => {});
const bump = () => { S.activity[today()] = (S.activity[today()] || 0) + 1; saveS(); };
const flag = (k) => { if (!S.flags[k]) { S.flags[k] = 1; saveS(); } };
const streak = () => { let i = S.activity[today()] > 0 ? 0 : 1, n = 0; while (S.activity[today(-i)] > 0) { n++; i++; } return n; };
const due = () => mistakes.filter((m) => !m.graduated && m.next_review <= today());
const steps = () => [files.length > 0, !!S.flags.draw, mistakes.length > 0, mistakes.some((m) => m.last_result)];
const STEP_LABEL = ['파일 올리기', '필기해 보기', '오답 등록', '복습 1회'];
const reasonsAll = () => [...new Set([...S.reasons, ...mistakes.map((m) => m.reason).filter(Boolean)])];

// ───────── 라우터 ─────────
async function route() {
  viewer?.destroy(); viewer = null;
  document.body.classList.remove('viewer-mode');
  const user = await store.auth.user();
  document.body.classList.toggle('auth', !user);
  if (!user) return authView();
  if (!route.loaded) { S = { ...S, ...(await store.settings.get().catch(() => ({}))) }; route.loaded = true; }
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const [a, b] = path.split('/');
  renderNav(user, a || 'files');
  view.classList.remove('fade'); void view.offsetWidth; view.classList.add('fade');
  if (a === 'f' && b) return viewerView(b, Number(new URLSearchParams(qs).get('p')) || 1);
  if (a === 'review') return reviewView();
  if (a === 'mistakes') return mistakesView();
  if (a === 'quiz') return quizView();
  if (a === 'explore') return exploreView();
  return filesView();
}
window.addEventListener('hashchange', route);

function renderNav(user, active) {
  const on = (k) => (active === k || (k === 'files' && active === 'f') ? 'on' : '');
  nav.innerHTML = `
    <div class="brand">📚 <span>스터디드라이브</span></div>
    <a href="#/files" class="${on('files')}"><i>🗂️</i><span>내 파일</span></a>
    <a href="#/review" class="${on('review')}"><i>🔁</i><span>오늘 복습</span><b id="due-badge" hidden></b></a>
    <a href="#/mistakes" class="${on('mistakes') || on('quiz')}"><i>📒</i><span>오답노트</span></a>
    <a href="#/explore" class="${on('explore')}"><i>🧭</i><span>둘러보기</span></a>
    <div class="who"><span title="${esc(user.email || '')}">${esc(user.email || '')}</span>${store.mode === 'cloud' ? '<button class="btn ghost sm" id="logout">로그아웃</button>' : '<em>로컬 모드</em>'}</div>`;
  $('#logout')?.addEventListener('click', async () => { await store.auth.signOut(); route.loaded = false; route(); });
  store.mistakes.list().then((m) => { mistakes = m; badge(); }).catch(() => {});
}
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
    try { await (m === 'up' ? store.auth.signUp(email, pw) : store.auth.signIn(email, pw)); route.loaded = false; route(); } catch (e) { toast(e.message, 5000); }
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
    <div id="stats"></div><div id="banner"></div><div id="chips" class="chips"></div><div id="grid" class="grid"></div>
    <div id="drop" class="drop">여기에 놓아서 업로드</div>`;
  $('#grid').innerHTML = '<p class="muted">불러오는 중…</p>';
  try { [files, mistakes] = await Promise.all([store.files.list(), store.mistakes.list()]); } catch (e) { return void ($('#grid').innerHTML = `<p class="muted">불러오기 실패: ${esc(e.message)}</p>`); }
  if (!S.seen) { S.seen = true; saveS(); if (!files.length) { location.hash = '#/explore'; return; } }
  badge();
  drawFiles();
  $('#q').addEventListener('input', (e) => { filter.q = e.target.value; drawFiles(); });
  $('#up').addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = ''; });
  const drop = $('#drop');
  addEventListener('dragover', (e) => { if ($('#grid')) { e.preventDefault(); drop.classList.add('on'); } });
  addEventListener('dragleave', (e) => { if (!e.relatedTarget) drop.classList.remove('on'); });
  addEventListener('drop', (e) => { if ($('#grid')) { e.preventDefault(); drop.classList.remove('on'); handleFiles([...e.dataTransfer.files]); } });
}

function statsHtml() {
  const n = due().length, grad = mistakes.filter((m) => m.graduated).length;
  const wk = [6, 5, 4, 3, 2, 1, 0].map((i) => S.activity[today(-i)] || 0), mx = Math.max(1, ...wk);
  return `<section class="stats">
    <a class="stat hot" href="#/review"><b>${n}</b><span>오늘 복습</span></a>
    <div class="stat"><b>🔥 ${streak()}</b><span>연속 학습일</span></div>
    <div class="stat"><b>🎓 ${grad}</b><span>졸업한 오답</span></div>
    <div class="stat week" title="최근 7일 학습량">${wk.map((v) => `<i style="height:${6 + (v / mx) * 30}px" class="${v ? 'on' : ''}"></i>`).join('')}<span>7일</span></div>
  </section>`;
}

function drawFiles() {
  const cats = [...new Set([...(S.cats || []), ...files.map((f) => f.category || '미분류')])];
  if (filter.cat !== '전체' && !cats.includes(filter.cat)) filter.cat = '전체';
  $('#stats').innerHTML = statsHtml();
  const st = steps(), dn = st.filter(Boolean).length;
  $('#banner').innerHTML = dn < 4 ? `<a class="banner" href="#/explore">🚀 시작 가이드 ${dn}/4 — 다음은 <b>${STEP_LABEL[st.indexOf(false)]}</b> → 둘러보기에서 원클릭으로 시작해 보세요</a>` : '';
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
    </article>`).join('') : `<div class="empty"><div>📂</div><p>${files.length ? '검색 결과가 없어요' : '아직 파일이 없어요.<br>PDF나 노트를 올리면 AI가 알아서 분류해 줘요.'}</p>${files.length ? '' : '<a class="btn primary" href="#/explore">🧭 원클릭으로 시작하기</a>'}</div>`;
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
  try { const n = await store.files.update(row, patch); files = files.map((f) => (f.id === n.id ? n : f)); if ($('#grid')) drawFiles(); return n; } catch (e) { toast('저장 실패: ' + e.message); }
}

async function classify(row) {
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
    const known = [...new Set([...(S.cats || []), ...files.map((f) => f.category)].filter((c) => c && c !== '미분류'))];
    const r = await ai('classify', { name: row.name, text, image, categories: known });
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
      files.unshift(row); if ($('#grid')) drawFiles(); t.close();
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
  viewer = await mountViewer($('.viewer'), {
    store, row, page,
    onBack: () => (location.hash = '#/files'),
    onEvent: flag,
    onMistake: (ctx) => mistakeDialog({ file: row, ...ctx }),
  });
}

// ───────── 오답 등록 / AI 해설 ─────────
function mistakeDialog({ file, page, capture }) {
  const d = $('#dlg');
  d.innerHTML = `
    <form class="dlg-body">
      <h3>오답 등록</h3>
      <p class="muted">${esc(file.name)} · ${page}쪽</p>
      <label>문제 번호/이름<input name="label" placeholder="예: Part5 #103" required></label>
      <label>틀린 이유<select name="reason">${S.reasons.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
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
      const m = await store.mistakes.add({ file_id: file.id, file_name: file.name, page, label: v.label, reason: v.reason, memo: v.memo, stage: 0, next_review: today(S.intervals[0]), graduated: false });
      mistakes.unshift(m); badge(); bump();
      toast(`📒 오답노트에 저장했어요. ${S.intervals[0]}일 뒤 복습 목록에 떠요`);
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
    ${a.sample ? '<p class="samplenote">※ 예시 해설이에요. 내 오답은 AI가 직접 만들어 줘요.</p>' : ''}
    ${a.translation ? `<h4>문제 해석·핵심</h4>${P(a.translation)}` : ''}
    ${a.answer ? `<h4>정답과 근거</h4>${P(a.answer)}` : ''}
    ${a.reason ? `<h4>틀린 이유</h4>${P(a.reason)}` : ''}
    ${a.tip ? `<h4>다음엔 이렇게</h4>${P(a.tip)}` : ''}
    ${(a.similar || []).map((s, i) => `<details class="sim"><summary>유사 문제 ${i + 1}</summary>${P(s.question)}<ul>${(s.choices || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul><details><summary>정답·해설 보기</summary>${P(`${s.answer} — ${s.explanation}`)}</details></details>`).join('')}
  </div>`;
}

// ───────── 오늘 복습 (4단계 평가) ─────────
let queue = [], qi = 0, done = {};
const RATINGS = [['again', '다시', 'r-again'], ['hard', '어려움', 'r-hard'], ['good', '좋음', 'r-good'], ['easy', '쉬움', 'r-easy']];
function plan(m, r) {
  const I = S.intervals, s = m.stage || 0;
  if (r === 'again') return { stage: 0, days: I[0], next_review: today(I[0]) };
  if (r === 'hard') { const d = I[Math.min(s, I.length - 1)]; return { stage: s, days: d, next_review: today(d) }; }
  const ns = s + (r === 'good' ? 1 : 2);
  if (ns >= I.length) return { stage: ns, graduated: true };
  return { stage: ns, days: I[ns], next_review: today(I[ns]) };
}
async function reviewView() {
  view.innerHTML = '<p class="muted pad">불러오는 중…</p>';
  try { mistakes = await store.mistakes.list(); if (!files.length) files = await store.files.list(); } catch (e) { view.innerHTML = `<p class="pad muted">${esc(e.message)}</p>`; return; }
  badge();
  queue = due(); qi = 0; done = {};
  view.innerHTML = '<div id="rv" class="narrow"></div>';
  drawReview();
}
function drawReview() {
  const rv = $('#rv'); if (!rv) return;
  if (!queue.length || qi >= queue.length) {
    const nxt = mistakes.filter((m) => !m.graduated).map((m) => m.next_review).sort()[0];
    const tot = Object.values(done).reduce((a, b) => a + b, 0);
    rv.innerHTML = `<div class="empty"><div>${queue.length ? '🎉' : '✅'}</div><h2>${queue.length ? '오늘 복습 끝!' : '오늘 복습할 오답이 없어요'}</h2>
      ${queue.length ? `<p>${tot}개 완료 · 🔥 연속 ${streak()}일</p>` : ''}<p class="muted">${nxt ? `다음 복습: ${nxt}` : '파일을 풀다가 틀린 문제를 오답 등록해 보세요.'}</p>
      <div class="row" style="justify-content:center"><a class="btn" href="#/quiz">🎯 AI 맞춤 퀴즈</a><a class="btn primary" href="#/files">내 파일로</a></div></div>`;
    return;
  }
  const m = queue[qi];
  rv.innerHTML = `
    <div class="prog"><div style="width:${(qi / queue.length) * 100}%"></div></div>
    <p class="muted">${qi + 1} / ${queue.length} · ${(m.stage || 0) + 1}번째 복습</p>
    <article class="card big">
      <h2>${esc(m.label)}</h2>
      <p class="muted">${esc(m.file_name || '')} ${m.page ? `· ${m.page}쪽` : ''} · <span class="badge">${esc(m.reason)}</span></p>
      ${m.memo ? P('📝 ' + m.memo) : ''}
      <p>👉 원본에서 <b>답을 가리고 다시 풀어 본 뒤</b> 얼마나 기억나는지 골라 주세요.</p>
      <div class="row">${m.file_id ? `<a class="btn" href="#/f/${m.file_id}?p=${m.page || 1}">원본 열기</a>` : ''}
        ${m.ai ? '' : '<button class="btn" id="mkai">🤖 AI 해설 받기</button>'}</div>
      ${m.ai ? `<details><summary>AI 해설·유사 문제 보기</summary>${aiHtml(m.ai)}</details>` : ''}
    </article>
    <div class="rates">${RATINGS.map(([k, label, cls], i) => { const p = plan(m, k); return `<button class="rate ${cls}" data-r="${k}"><b>${label}</b><small>${p.graduated ? '졸업 🎓' : p.days + '일 후'}</small><kbd>${i + 1}</kbd></button>`; }).join('')}</div>`;
  $('#mkai')?.addEventListener('click', () => explain(m));
  $$('[data-r]', rv).forEach((b) => b.addEventListener('click', () => rate(b.dataset.r)));
}
async function rate(r) {
  const m = queue[qi]; if (!m) return;
  const p = plan(m, r);
  const patch = p.graduated ? { graduated: true, stage: p.stage, last_result: r } : { stage: p.stage, next_review: p.next_review, last_result: r };
  try { const n = await store.mistakes.update(m.id, patch); mistakes = mistakes.map((x) => (x.id === n.id ? n : x)); queue[qi] = n; } catch (e) { return toast('저장 실패: ' + e.message); }
  done[r] = (done[r] || 0) + 1; qi++; bump(); badge(); drawReview();
}
addEventListener('keydown', (e) => {
  if (!$('#rv') || e.target.closest('input,textarea,select')) return;
  const k = RATINGS[Number(e.key) - 1]?.[0]; if (k) rate(k);
});

// ───────── 오답노트 ─────────
let mf = '전체';
async function mistakesView() {
  view.innerHTML = '<p class="muted pad">불러오는 중…</p>';
  try { mistakes = await store.mistakes.list(); if (!files.length) files = await store.files.list(); } catch (e) { view.innerHTML = `<p class="pad muted">${esc(e.message)}</p>`; return; }
  badge();
  view.innerHTML = `<header class="vh"><h2>오답노트</h2><div class="row"><a class="btn" href="#/quiz">🎯 AI 맞춤 퀴즈</a><button class="btn primary" id="weak">🤖 AI 약점 분석</button></div></header>
    <div id="wk"></div><div id="stats" class="card"></div><div id="mchips" class="chips"></div><div id="mlist"></div>`;
  $('#weak').addEventListener('click', weakness);
  drawMistakes();
}
function drawMistakes() {
  const R = reasonsAll();
  const by = R.map((r) => [r, mistakes.filter((m) => m.reason === r).length]).filter((x) => x[1]);
  const max = Math.max(1, ...by.map((x) => x[1]));
  const grad = mistakes.filter((m) => m.graduated).length;
  $('#stats').innerHTML = mistakes.length ? `<h4>틀린 이유 분포 <small class="muted">총 ${mistakes.length}개 · 졸업 ${grad}개 · 오늘 복습 ${due().length}개</small></h4>${by.map(([r, n]) => `<div class="bar"><span>${esc(r)}</span><i style="width:${(n / max) * 100}%"></i><b>${n}</b></div>`).join('')}` : '<p class="muted">아직 오답이 없어요. 파일 뷰어에서 [오답 등록]을 눌러 시작하세요. <a href="#/explore">예시로 먼저 체험하기 →</a></p>';
  $('#mchips').innerHTML = ['전체', ...R].map((r) => `<button class="chip${mf === r ? ' on' : ''}" data-r="${esc(r)}">${esc(r)}</button>`).join('');
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

// ───────── AI 맞춤 퀴즈 (내 오답 기반) ─────────
async function quizView() {
  view.innerHTML = '<div id="qz" class="narrow"><div class="empty"><div>🤖</div><p>AI가 내 오답으로 연습 문제를 만드는 중…<br><small>10~20초 걸려요</small></p></div></div>';
  try { mistakes = await store.mistakes.list(); } catch (e) { return void ($('#qz').innerHTML = `<p class="muted pad">${esc(e.message)}</p>`); }
  if (!mistakes.length) return void ($('#qz').innerHTML = '<div class="empty"><div>📒</div><p>오답이 있어야 퀴즈를 만들 수 있어요.</p><a class="btn primary" href="#/explore">예시로 체험하기</a></div>');
  const items = mistakes.slice(0, 12).map((m) => ({ label: m.label, reason: m.reason, memo: m.memo, 핵심: (m.ai?.answer || '').slice(0, 200), 유형문제: (m.ai?.similar?.[0]?.question || '').slice(0, 160) }));
  let qs;
  try { qs = (await ai('quiz', { items })).questions || []; } catch (e) { return void ($('#qz').innerHTML = `<div class="empty"><div>⚠️</div><p>${esc(e.message)}</p><a class="btn" href="#/mistakes">돌아가기</a></div>`); }
  let i = 0, score = 0;
  const draw = () => {
    const box = $('#qz'); if (!box) return;
    if (i >= qs.length) { bump(); flag('quiz'); box.innerHTML = `<div class="empty"><div>${score >= qs.length * 0.8 ? '🏆' : '💪'}</div><h2>${score} / ${qs.length} 정답</h2><p class="muted">틀린 문제는 오답노트에 등록해 복습하세요.</p><div class="row" style="justify-content:center"><button class="btn" id="again">새 문제로 다시</button><a class="btn primary" href="#/mistakes">오답노트로</a></div></div>`; $('#again').onclick = quizView; return; }
    const q = qs[i], L = ['A', 'B', 'C', 'D'];
    box.innerHTML = `<div class="prog"><div style="width:${(i / qs.length) * 100}%"></div></div><p class="muted">${i + 1} / ${qs.length}${q.target ? ` · 겨냥: ${esc(q.target)}` : ''}</p>
      <article class="card big"><h3 class="pre">${esc(q.question)}</h3><div class="choices">${(q.choices || []).map((c, k) => `<button class="choice" data-k="${L[k]}">${L[k]}. ${esc(c)}</button>`).join('')}</div><div id="fb"></div></article>`;
    $$('.choice', box).forEach((b) => (b.onclick = () => {
      const ok = b.dataset.k === q.answer; if (ok) score++;
      $$('.choice', box).forEach((x) => { x.disabled = true; if (x.dataset.k === q.answer) x.classList.add('right'); });
      if (!ok) b.classList.add('wrong');
      $('#fb').innerHTML = `<div class="ai"><h4>${ok ? '정답! 🎉' : `정답은 ${esc(q.answer)}`}</h4>${P(q.explanation)}</div><button class="btn primary" id="nx" style="margin-top:10px">${i + 1 < qs.length ? '다음 문제' : '결과 보기'}</button>`;
      $('#nx').onclick = () => { i++; draw(); };
    }));
  };
  draw();
}

// ───────── 둘러보기 (처음 쓰는 사람용) ─────────
async function exploreView() {
  try { [files, mistakes] = await Promise.all([store.files.list(), store.mistakes.list()]); } catch {}
  badge();
  const st = steps(), dn = st.filter(Boolean).length;
  const hasSample = files.some((f) => (f.tags || []).includes('예시')) || mistakes.some((m) => m.label?.startsWith('[예시]'));
  view.innerHTML = `
    <section class="hero">
      <h1>처음이세요? 3분이면 시작해요 🚀</h1>
      <p>아래에서 나에게 맞는 세팅을 <b>한 번만 누르면</b> 폴더·복습 주기·예시 문제가 알아서 만들어져요.</p>
      <div class="steps">${STEP_LABEL.map((l, i) => `<div class="step ${st[i] ? 'ok' : ''}"><i>${st[i] ? '✓' : i + 1}</i><span>${l}</span></div>`).join('')}</div>
      <small>${dn}/4 완료</small>
    </section>

    <h3 class="sec">① 원클릭 시작 세팅</h3>
    <div class="tpls">${TEMPLATES.map((t) => `
      <article class="card tpl ${S.tpl === t.id ? 'active' : ''}">
        <div class="te">${t.emoji}</div>
        <h3>${esc(t.title)}</h3><p class="muted who">${esc(t.who)}</p>
        <p>${esc(t.desc)}</p>
        <div class="meta">${t.cats.map((c) => `<span class="badge">${esc(c)}</span>`).join('')}</div>
        <ol class="howto">${t.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <p class="muted"><small>복습 주기 ${PRESETS[t.preset].intervals.join('·')}일 · 예시 노트 ${t.notes.length}개 · 예시 오답 ${t.mistakes.length}개</small></p>
        <button class="btn ${S.tpl === t.id ? '' : 'primary'}" data-tpl="${t.id}">${S.tpl === t.id ? '다시 적용하기' : '이 세팅으로 시작하기'}</button>
      </article>`).join('')}
      <article class="card tpl"><div class="te">📤</div><h3>내 자료로 바로 시작</h3><p class="muted who">세팅 없이 가볍게</p><p>가지고 있는 PDF나 사진을 올리면 AI가 알아서 폴더와 태그를 붙여 줘요.</p><a class="btn" href="#/files">파일 올리러 가기</a></article>
    </div>
    ${hasSample ? '<div class="row" style="margin:10px 0 0"><button class="btn ghost" id="rmsample">🧹 예시 데이터 지우기</button><small class="muted">예시 노트·예시 오답만 삭제돼요. 내 파일은 그대로예요.</small></div>' : ''}

    <h3 class="sec">② 이렇게도 쓸 수 있어요</h3>
    <div class="scen">${SCENARIOS.map((s) => `<a class="card sc" href="${s.href}"><div class="te">${s.emoji}</div><h3>${esc(s.title)}</h3><p class="muted">${esc(s.body)}</p><span class="lnk">${esc(s.cta)} →</span></a>`).join('')}</div>

    <h3 class="sec">③ 내 학습 설정</h3>
    <div class="card"><p><b>복습 주기</b> <small class="muted">— 오답을 다시 보여 주는 간격이에요</small></p>
      <div class="chips" id="presets">${Object.entries(PRESETS).map(([k, p]) => `<button class="chip ${JSON.stringify(p.intervals) === JSON.stringify(S.intervals) ? 'on' : ''}" data-p="${k}">${p.name}</button>`).join('')}</div>
      <p class="muted"><small>복습할 때 [다시·어려움·좋음·쉬움]을 고르면 다음 복습일이 자동으로 정해져요. 시험이 가까우면 “시험 임박”을 고르세요.</small></p></div>`;
  $$('[data-tpl]').forEach((b) => (b.onclick = () => applyTemplate(TEMPLATES.find((t) => t.id === b.dataset.tpl))));
  $('#rmsample')?.addEventListener('click', removeSamples);
  $$('#presets .chip').forEach((c) => (c.onclick = () => { S.intervals = PRESETS[c.dataset.p].intervals; saveS(); toast('복습 주기를 바꿨어요'); exploreView(); }));
}

async function applyTemplate(t) {
  const tk = toast(`${t.emoji} "${t.title}" 세팅을 만드는 중…`, 0);
  try {
    S.intervals = PRESETS[t.preset].intervals; S.reasons = t.reasons; S.cats = [...new Set([...(S.cats || []), ...t.cats])]; S.tpl = t.id;
    files = await store.files.list(); mistakes = await store.mistakes.list();
    const rows = [];
    for (const n of t.notes) {
      let row = files.find((f) => f.name === n.name);
      if (!row) {
        row = await store.files.add(new File([n.content], n.name, { type: 'text/markdown' }));
        row = await store.files.update(row, { category: n.category, tags: n.tags, summary: n.summary });
        files.unshift(row);
      }
      rows.push(row);
    }
    const have = new Set(mistakes.map((m) => m.label));
    for (const m of t.mistakes) {
      if (have.has(m.label)) continue;
      const mk = await store.mistakes.add({ file_id: rows[m.note].id, file_name: rows[m.note].name, page: 1, label: m.label, reason: m.reason, memo: m.memo, stage: 0, next_review: today(), graduated: false, ai: { ...m.ai, sample: true } });
      mistakes.unshift(mk);
    }
    await saveS(); tk.close();
    toast(`✅ 세팅 완료! 오늘 복습 ${due().length}개가 준비됐어요`, 4000);
    location.hash = '#/review';
  } catch (e) { tk.close(); toast('세팅 실패: ' + e.message, 5000); }
}

async function removeSamples() {
  if (!confirm('예시 노트와 예시 오답을 지울까요? 내가 올린 파일은 그대로 남아요.')) return;
  try {
    for (const f of files.filter((f) => (f.tags || []).includes('예시'))) await store.files.remove(f);
    for (const m of mistakes.filter((m) => m.label?.startsWith('[예시]'))) await store.mistakes.remove(m.id);
    S.tpl = null; await saveS(); toast('예시 데이터를 지웠어요'); exploreView();
  } catch (e) { toast('삭제 실패: ' + e.message); }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
route();
