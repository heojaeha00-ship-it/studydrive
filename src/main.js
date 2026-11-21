import { $, $$, esc, toast, today, fmtDate, kind, REASONS, INTERVALS, guessCategory } from './util.js';
import { local } from './store-local.js';
import { cloud } from './store-cloud.js';
import { openDoc, pageText, pageImage } from './pdf.js';
import { mountViewer } from './viewer.js';
import { TEMPLATES, PRESETS, SCENARIOS } from './templates.js';
import { PAPERS, paperKey, makeNotePdf, addPages, makeSamplePdf } from './blank.js';

const cfg = window.SD_CONFIG || {};
const store = cfg.url && cfg.key ? cloud(cfg) : local();
const view = $('#view');
const nav = $('#nav');
const RESERVED = new Set(['노트', '예시', ...Object.values(PAPERS)]);
const QUOTA = 100 * 1048576; // 사용자당 저장 한도
const mb = (b) => (b / 1048576 < 10 ? (b / 1048576).toFixed(1) : Math.round(b / 1048576)) + 'MB';
const usedBytes = () => files.reduce((a, f) => a + (f.size || 0), 0);
const ICON = { pdf: '📕', image: '🖼️', text: '📝', other: '📄' };
let files = [], mistakes = [], viewer = null;
const filter = { cat: '전체', q: '' };
let S = { intervals: INTERVALS, reasons: REASONS, cats: [], activity: {}, flags: {}, tpl: null, seen: false };

const ai = (action, payload) => store.ai(action, payload);
const saveS = () => store.settings.set(S).catch(() => {});
const bump = () => { S.activity[today()] = (S.activity[today()] || 0) + 1; saveS(); };
const flag = (k) => { if (!S.flags[k]) { S.flags[k] = 1; saveS(); } };
const streak = () => { let i = S.activity[today()] > 0 ? 0 : 1, n = 0; while (S.activity[today(-i)] > 0) { n++; i++; } return n; };
const hist = () => mistakes.flatMap((m) => m.hist || []);
function growthHtml() {
  const h = hist(), parts = [];
  if (S.goal?.date) { const n = Math.ceil((new Date(S.goal.date) - new Date(today())) / 864e5); if (n >= 0) parts.push(`<span>🎯 <b>D-${n}</b>${S.goal.target ? ` · 목표 ${esc(S.goal.target)}점` : ''}</span>`); }
  if (h.length >= 4) {
    const good = (x) => x.r === 'good' || x.r === 'easy';
    const pct = (a) => (a.length ? Math.round((a.filter(good).length / a.length) * 100) : null);
    const since = today(-7), pr = pct(h.filter((x) => x.d > since)), pb = pct(h.filter((x) => x.d <= since));
    parts.push(`<span>복습 ${h.length}회</span>`);
    if (pr != null) parts.push(`<span>최근 7일 기억률 <b>${pr}%</b>${pb != null ? ` <small class="muted">(이전 ${pb}%)</small>` : ''}</span>`);
  }
  const q = (S.quizLog || []).slice(-5);
  if (q.length) parts.push(`<span>퀴즈 평균 <b>${Math.round((q.reduce((a, x) => a + x.score / x.n, 0) / q.length) * 100)}%</b> <small class="muted">(${q.length}회)</small></span>`);
  return parts.length ? `<div class="growth card"><b>📈 나의 성장</b>${parts.join('')}</div>` : '';
}
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
// 다른 기기에서 바꾼 내용을 앱으로 돌아올 때 자동 반영 (목록·오답노트 화면만)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || $('#dlg')?.open) return;
  const h = location.hash || '#/files';
  if (h === '#/files' || h === '#/mistakes') route();
});

function renderNav(user, active) {
  const on = (k) => (active === k || (k === 'files' && active === 'f') ? 'on' : '');
  nav.innerHTML = `
    <div class="brand">📚 <span>스터디드라이브</span></div>
    <a href="#/files" class="${on('files')}"><i>🗂️</i><span>내 파일</span></a>
    <a href="#/review" class="${on('review')}"><i>🔁</i><span>오늘 복습</span><b id="due-badge" hidden></b></a>
    <a href="#/mistakes" class="${on('mistakes') || on('quiz')}"><i>📒</i><span>오답노트</span></a>
    <a href="#/explore" class="${on('explore')}"><i>🧭</i><span>둘러보기</span></a>
    <div class="who"><span title="${esc(user.email || '')}">${esc(user.email || '게스트 체험')}</span>${store.mode === 'cloud' && !user.email ? '<button class="btn sm" id="upgrade">계정 만들기 (데이터 보존)</button>' : ''}${store.mode === 'cloud' ? '<button class="btn ghost sm" id="logout">로그아웃</button>' : '<em>이 기기에만 저장 중</em>'}</div>`;
  $('#upgrade')?.addEventListener('click', async () => {
    const email = prompt('이메일'); if (!email) return;
    const pw = prompt('비밀번호 (6자 이상)'); if (!pw) return;
    try { await store.auth.upgrade(email, pw); toast('확인 메일을 보냈어요. 메일의 링크를 누르면 계정이 완성돼요.', 6000); } catch (e) { toast(e.message, 5000); }
  });
  $('#logout')?.addEventListener('click', async () => { if (!user.email && !confirm('게스트 데이터는 로그아웃하면 사라져요. 계속할까요?')) return; await store.auth.signOut(); route.loaded = false; route(); });
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
      <p class="muted">태블릿·폰·PC에서 이어서 공부하는<br>AI 학습 드라이브</p>
      ${store.mode === 'cloud' ? '<button class="btn primary" id="demo">가입 없이 체험하기</button><div class="or">또는</div>' : ''}
      <form id="af">
        <label class="vh2" for="em">이메일</label><input id="em" type="email" name="email" placeholder="이메일" required autocomplete="email">
        <label class="vh2" for="pw">비밀번호</label><input id="pw" type="password" name="pw" placeholder="비밀번호 (6자 이상)" required minlength="6" autocomplete="current-password">
        <div class="row"><button class="btn grow" data-m="in">로그인</button><button class="btn grow" type="button" data-m="up">회원가입</button></div>
      </form>
    </div>`;
  const go = async (m, email, pw) => {
    try { await (m === 'up' ? store.auth.signUp(email, pw) : store.auth.signIn(email, pw)); route.loaded = false; route(); } catch (e) { toast(e.message, 5000); }
  };
  const f = $('#af');
  f.addEventListener('submit', (e) => { e.preventDefault(); go('in', f.email.value, f.pw.value); });
  $('[data-m=up]', f).addEventListener('click', () => f.reportValidity() && go('up', f.email.value, f.pw.value));
  $('#demo')?.addEventListener('click', async () => {
    try { await store.auth.signInAnon(); route.loaded = false; route(); } // 방문자마다 개인 공간
    catch (e) { if (cfg.demoEmail && /anonymous|disabled|not allowed|422|signups/i.test(String(e?.message))) { toast('개인 체험 공간을 못 만들어 공용 데모 계정으로 들어가요 (다른 방문자와 데이터가 섞일 수 있어요)', 5000); go('in', cfg.demoEmail, cfg.demoPassword); } else toast('체험 시작에 실패했어요. 네트워크를 확인하고 다시 시도해 주세요.'); }
  });
}

// ───────── 내 파일 ─────────
async function filesView() {
  view.innerHTML = `
    <header class="vh"><h2>내 파일</h2>
      <div class="row">
        <input id="q" type="search" placeholder="🔍 검색" value="${esc(filter.q)}">
        <button class="btn" id="newnote">📝 새 노트</button>
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
  $('#newnote').addEventListener('click', noteDialog);
  $('#up').addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = ''; });
  if (!filesView.bound) {
    filesView.bound = true;
    addEventListener('dragover', (e) => { if ($('#grid')) { e.preventDefault(); $('#drop')?.classList.add('on'); } });
    addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('#drop')?.classList.remove('on'); });
    addEventListener('drop', (e) => { if ($('#grid')) { e.preventDefault(); $('#drop')?.classList.remove('on'); handleFiles([...e.dataTransfer.files]); } });
  }
}

function statsHtml() {
  const n = due().length, grad = mistakes.filter((m) => m.graduated).length;
  const wk = [6, 5, 4, 3, 2, 1, 0].map((i) => S.activity[today(-i)] || 0), mx = Math.max(1, ...wk);
  return `<section class="stats">
    <a class="stat hot" href="#/review"><b>${n}</b><span>오늘 복습</span></a>
    <div class="stat"><b>🔥 ${streak()}</b><span>연속 학습일</span></div>
    <div class="stat"><b>🎓 ${grad}</b><span>마스터한 오답</span></div>
    <div class="stat week" title="최근 7일 학습량">${wk.map((v) => `<i style="height:${6 + (v / mx) * 30}px" class="${v ? 'on' : ''}"></i>`).join('')}<span>7일</span></div>
  </section>${store.mode === 'cloud' ? `<div class="quota" title="사용자당 저장 한도"><div><i style="width:${Math.min(100, (usedBytes() / QUOTA) * 100)}%"></i></div><small>저장공간 ${mb(usedBytes())} / ${mb(QUOTA)}</small></div>` : ''}`;
}

function drawFiles() {
  const cats = [...new Set([...(S.cats || []), ...files.map((f) => f.category || '미분류')])];
  if (filter.cat !== '전체' && !cats.includes(filter.cat)) filter.cat = '전체';
  $('#stats').innerHTML = statsHtml() + growthHtml();
  const st = steps(), dn = st.filter(Boolean).length;
  $('#banner').innerHTML = dn < 4 ? `<a class="banner" href="#/explore">🚀 시작 가이드 ${dn}/4 · 다음: <b>${STEP_LABEL[st.indexOf(false)]}</b> (둘러보기에서 시작)</a>` : '';
  $('#chips').innerHTML = ['전체', ...cats].map((c) => `<button class="chip${filter.cat === c ? ' on' : ''}" data-c="${esc(c)}">${esc(c)} <small>${c === '전체' ? files.length : files.filter((f) => (f.category || '미분류') === c).length}</small></button>`).join('');
  const q = filter.q.trim().toLowerCase();
  const list = files.filter((f) => (filter.cat === '전체' || (f.category || '미분류') === filter.cat) && (!q || `${f.name} ${f.category} ${(f.tags || []).join(' ')} ${f.summary || ''}`.toLowerCase().includes(q)));
  $('#grid').innerHTML = list.length ? list.map((f) => `
    <article class="card file" data-id="${f.id}">
      <div class="fi">${ICON[kind(f.name, f.mime)]}</div>
      <div class="fb">
        <h3>${esc(f.name.replace(/\.(md|txt)$/i, ''))}</h3>
        <div class="meta"><span class="badge" data-act="cat">${esc(f.category || '미분류')}</span>${(f.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
        ${f.summary ? `<p class="sum">${esc(f.summary)}</p>` : ''}
        <div class="foot"><small>${fmtDate(f.created_at)} · ${f.size < 1048576 ? Math.max(1, Math.round(f.size / 1024)) + 'KB' : (f.size / 1048576).toFixed(1) + 'MB'}</small>
          <span><button class="lnk" data-act="reclass">자동 분류</button><button class="lnk" data-act="rename">이름 바꾸기</button><button class="lnk danger" data-act="del">삭제</button></span></div>
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
    if (confirm(`'${row.name}'을(를) 삭제할까요? 필기도 함께 지워지고, 되돌릴 수 없어요.`)) {
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
    const keep = (row.tags || []).filter((x) => RESERVED.has(x));
    await update(row, { category: r.category || '미분류', tags: [...keep, ...(r.tags || []).filter((x) => !RESERVED.has(x))].slice(0, 6), summary: r.summary || '' });
    t.close(); toast(`분류 완료: ${r.category}`);
  } catch (e) {
    t.close();
    await update(row, { category: guessCategory(row.name) });
    toast('AI 연결이 어려워 파일 이름으로 분류했어요', 3500);
  }
}

async function handleFiles(list) {
  for (const f of list) {
    if (kind(f.name, f.type) === 'other') { toast(`${f.name}: PDF·이미지·텍스트만 올릴 수 있어요`, 4000); continue; }
    if (f.size > 50 * 1048576) { toast(`${f.name}: 50MB를 넘어요`, 4000); continue; }
    if (store.mode === 'cloud' && usedBytes() + f.size > QUOTA) { toast(`저장공간이 부족해요 (${mb(usedBytes())} / ${mb(QUOTA)}). 안 쓰는 파일을 삭제해 주세요.`, 5000); continue; }
    const t = toast(`⬆️ 업로드 중… ${f.name}`, 0);
    try {
      const row = await store.files.add(f);
      files.unshift(row); if ($('#grid')) drawFiles(); t.close();
      await classify(row);
    } catch (e) { t.close(); toast('업로드 실패: ' + e.message, 5000); }
  }
}

// ───────── 새 노트 (빈 PDF) ─────────
function noteDialog() {
  const d = $('#dlg'), d0 = today();
  d.innerHTML = `
    <form class="dlg-body">
      <h3>📝 새 노트 만들기</h3>
      <p class="muted">빈 PDF 노트예요. 맨 아래까지 내리면 새 페이지가 자동으로 붙어요.</p>
      <label>제목<input name="title" value="새 노트 ${d0}" required></label>
      <label>종이<select name="paper">${Object.entries(PAPERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <div class="row end"><button type="button" class="btn ghost" data-x>취소</button><button class="btn primary">만들기</button></div>
    </form>`;
  d.showModal();
  const f = $('form', d);
  $('[data-x]', d).onclick = () => d.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const title = f.title.value.trim().replace(/[\\/:*?"<>|]/g, '-') || '새 노트', paper = f.paper.value;
    d.close();
    const t = toast('📝 노트를 만드는 중…', 0);
    try {
      const blob = await makeNotePdf({ paper, pages: 1 });
      if (store.mode === 'cloud' && usedBytes() + blob.size > QUOTA) throw new Error('저장공간이 부족해요');
      let row = await store.files.add(new File([blob], `${title}.pdf`, { type: 'application/pdf' }));
      row = await store.files.update(row, { category: '노트', tags: ['노트', PAPERS[paper]], summary: `직접 만든 ${PAPERS[paper]}` });
      files.unshift(row); t.close();
      location.hash = `#/f/${row.id}`;
    } catch (er) { t.close(); toast('노트 만들기 실패: ' + er.message, 5000); }
  };
}

// ───────── 뷰어 ─────────
async function viewerView(id, page) {
  document.body.classList.add('viewer-mode');
  if (!files.length) try { files = await store.files.list(); } catch {}
  let row = files.find((f) => f.id === id);
  if (!row) { view.innerHTML = '<p class="pad muted">파일을 찾을 수 없어요. <a href="#/files">목록으로</a></p>'; return; }
  view.innerHTML = '<div class="viewer"></div>';
  viewer = await mountViewer($('.viewer'), {
    store, row, page,
    onBack: () => (location.hash = '#/files'),
    onEvent: flag,
    onCards: async (image) => {
      const t = toast('🃏 암기 카드를 만드는 중…', 0);
      try { const r = await ai('cards', { image }); t.close(); return r.cards || []; } catch (e) { t.close(); toast('카드 만들기 실패: ' + e.message, 5000); return []; }
    },
    onAddCard: async (c, page) => {
      const m = await store.mistakes.add({ file_id: row.id, file_name: row.name, page, label: '[카드] ' + String(c.front).slice(0, 40), reason: S.reasons[S.reasons.length - 1] || '기타', memo: String(c.front), stage: 0, next_review: today(S.intervals[0]), graduated: false, ai: { answer: String(c.back), sample: false } });
      mistakes.unshift(m); badge(); bump();
    },
    onAppend: async () => {
      const cur = files.find((f) => f.id === id) || row;
      const { blob, count } = await addPages(await store.files.blob(cur), paperKey(cur.tags), 1);
      const n = await store.files.replace(cur, blob);
      files = files.map((f) => (f.id === n.id ? n : f));
      return { blob, count };
    },
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
    const qk = queue.findIndex((x) => x.id === n.id); if (qk >= 0) queue[qk] = n;
    t.close(); toast('✅ AI 해설이 준비됐어요');
    if ($('#mlist')) drawMistakes();
    if ($('#rv')) { const keep = $('#recall')?.value; drawReview(); if (keep && $('#recall')) $('#recall').value = keep; }
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
const RATINGS = [['again', '다시 볼래요', 'r-again'], ['hard', '어려웠어요', 'r-hard'], ['good', '괜찮았어요', 'r-good'], ['easy', '쉬웠어요', 'r-easy']];
const inDays = (d) => (d === 1 ? '내일' : `${d}일 뒤`);
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
  queue = due(); qi = 0; done = {}; sessionLog = []; conf = null;
  view.innerHTML = '<div id="rv" class="narrow"></div>';
  drawReview();
}
function drawReview() {
  const rv = $('#rv'); if (!rv) return;
  if (!queue.length || qi >= queue.length) {
    const nxt = mistakes.filter((m) => !m.graduated).map((m) => m.next_review).sort()[0];
    const tot = Object.values(done).reduce((a, b) => a + b, 0);
    rv.innerHTML = `<div class="empty"><div>${queue.length ? '🎉' : '✅'}</div><h2>${queue.length ? '오늘 복습 끝!' : '오늘 복습할 오답이 없어요'}</h2>
      ${queue.length ? `<p>${tot}개 완료 · 🔥 연속 ${streak()}일</p>${insightHtml()}` : ''}<p class="muted">${nxt ? `다음 복습: ${nxt}` : '파일을 풀다가 틀린 문제를 오답 등록해 보세요.'}</p>
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
      <div class="conf" role="group" aria-label="확신도"><small class="muted">내 확신도</small>${[['sure', '확실해요'], ['half', '반반이에요'], ['unsure', '모르겠어요']].map(([k, l]) => `<button class="chip" data-c="${k}">${l}</button>`).join('')}</div>
      <textarea id="recall" rows="2" placeholder="답이나 핵심을 먼저 떠올려 적어 보세요 (선택)"></textarea>
      <button class="btn" id="reveal">정답 확인</button>
      <div class="row">${m.file_id ? `<a class="btn" href="#/f/${m.file_id}?p=${m.page || 1}">원본 열기</a>` : ''}
        ${m.ai ? '' : '<button class="btn" id="mkai">🤖 AI 해설 받기</button>'}</div>
      <div id="ans" hidden>${m.ai ? aiHtml(m.ai) : P(m.memo || '저장된 해설이 없어요. 원본에서 확인해 보세요.')}</div>
    </article>
    <p class="muted center">얼마나 잘 기억났나요?</p>
    <div class="rates">${RATINGS.map(([k, label, cls], i) => { const p = plan(m, k); return `<button class="rate ${cls}" data-r="${k}"><b>${label}</b><small>${p.graduated ? '마스터 🎓' : inDays(p.days)}</small><kbd>${i + 1}</kbd></button>`; }).join('')}</div>`;
  $('#mkai')?.addEventListener('click', () => explain(m));
  $$('.conf .chip', rv).forEach((b) => b.addEventListener('click', () => { conf = b.dataset.c; $$('.conf .chip', rv).forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#reveal')?.addEventListener('click', async () => {
    const myQi = qi;
    const recall = $('#recall')?.value.trim();
    $('#ans').hidden = false; $('#reveal').hidden = true;
    const expected = m.ai?.answer || m.memo;
    if (!recall || !expected) return;
    const fb = document.createElement('p'); fb.className = 'samplenote'; fb.textContent = '🤖 내 답을 채점하는 중…'; $('#ans').prepend(fb);
    try {
      const r = await ai('grade', { label: m.label, expected: String(expected).slice(0, 600), answer: recall.slice(0, 400) });
      fb.textContent = `🤖 ${r.feedback || ''}`;
      if (qi !== myQi) return;
      const btn = $(`[data-r=${r.suggest}]`); if (btn) { btn.classList.add('suggest'); $('small', btn).textContent += ' · 추천'; }
    } catch { fb.remove(); }
  });
  $$('[data-r]', rv).forEach((b) => b.addEventListener('click', () => rate(b.dataset.r)));
}
function insightHtml() {
  const wrong = sessionLog.filter((x) => x.c === 'sure' && (x.r === 'again' || x.r === 'hard')).length;
  const under = sessionLog.filter((x) => x.c === 'unsure' && (x.r === 'good' || x.r === 'easy')).length;
  const lines = [];
  if (wrong) lines.push(`⚠️ <b>확신했는데 틀린 문제 ${wrong}개</b> — 가장 위험한 착각이에요. 해설을 다시 읽어 보세요.`);
  if (under) lines.push(`💡 모른다고 했지만 맞힌 문제 ${under}개 — 생각보다 알고 있어요.`);
  return lines.length ? `<div class="ai">${lines.map((l) => `<p>${l}</p>`).join('')}</div>` : '';
}
let rating = false, conf = null, sessionLog = [];
async function rate(r) {
  const m = queue[qi]; if (!m || rating) return;
  rating = true;
  const p = plan(m, r);
  const entry = { d: today(), r, s: m.stage || 0, c: conf || null };
  const hh = [...(m.hist || []), entry].slice(-30);
  const patch = p.graduated ? { graduated: true, stage: p.stage, last_result: r, hist: hh } : { stage: p.stage, next_review: p.next_review, last_result: r, hist: hh };
  try { const n = await store.mistakes.update(m.id, patch); mistakes = mistakes.map((x) => (x.id === n.id ? n : x)); queue[qi] = n; } catch (e) { rating = false; return toast('저장 실패: ' + e.message); }
  sessionLog.push({ r, c: conf }); conf = null;
  done[r] = (done[r] || 0) + 1; qi++; bump(); badge(); rating = false; drawReview();
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
  $('#stats').innerHTML = mistakes.length ? `<h4>틀린 이유 분포 <small class="muted">오답 ${mistakes.length}개 · 오늘 복습 ${due().length}개 · 마스터 ${grad}개</small></h4>${by.map(([r, n]) => `<div class="bar"><span>${esc(r)}</span><i style="width:${(n / max) * 100}%"></i><b>${n}</b></div>`).join('')}` : '<p class="muted">아직 오답이 없어요. 파일 뷰어에서 [오답 등록]을 눌러 시작하세요. <a href="#/explore">예시로 먼저 체험하기 →</a></p>';
  $('#mchips').innerHTML = ['전체', ...R].map((r) => `<button class="chip${mf === r ? ' on' : ''}" data-r="${esc(r)}">${esc(r)}</button>`).join('');
  const list = mistakes.filter((m) => mf === '전체' || m.reason === mf);
  $('#mlist').innerHTML = list.map((m) => `
    <article class="card m" data-id="${m.id}">
      <div class="mh"><b>${esc(m.label)}</b><span class="badge">${esc(m.reason)}</span>${m.graduated ? '<span class="badge ok">마스터</span>' : `<small class="muted">다음 복습 ${m.next_review}</small>`}</div>
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
  try { qs = (await ai('quiz', { items })).questions || []; } catch (e) {
    qs = fallbackQuiz();
    if (!qs.length) return void ($('#qz').innerHTML = `<div class="empty"><div>⚠️</div><p>${esc(e.message)}</p><a class="btn" href="#/mistakes">돌아가기</a></div>`);
    toast('AI 연결이 어려워 내 오답의 유사 문제로 퀴즈를 만들었어요', 4000);
  }
  qs = qs.filter((q) => Array.isArray(q.choices) && q.choices.length >= 2).map((q) => ({ ...q, answer: (String(q.answer || '').toUpperCase().match(/[A-D]/) || [''])[0] })).filter((q) => q.answer);
  qs = qs.map(shuffleQ);
  if (!qs.length) return void ($('#qz').innerHTML = '<div class="empty"><div>⚠️</div><p>퀴즈를 만들지 못했어요. 잠시 후 다시 시도해 주세요.</p><a class="btn" href="#/mistakes">돌아가기</a></div>');
  let i = 0, score = 0;
  const draw = () => {
    const box = $('#qz'); if (!box) return;
    if (i >= qs.length) { bump(); flag('quiz'); (S.quizLog ||= []).push({ d: today(), score, n: qs.length }); S.quizLog = S.quizLog.slice(-20); saveS(); box.innerHTML = `<div class="empty"><div>${score >= qs.length * 0.8 ? '🏆' : '💪'}</div><h2>${score} / ${qs.length} 정답</h2><p class="muted">틀린 문제는 자동으로 오답노트에 담겼어요. 복습 일정에 들어가요.</p><div class="row" style="justify-content:center"><button class="btn" id="again">새 문제로 다시</button><a class="btn primary" href="#/mistakes">오답노트로</a></div></div>`; $('#again').onclick = quizView; return; }
    const q = qs[i], L = ['A', 'B', 'C', 'D'];
    box.innerHTML = `<div class="prog"><div style="width:${(i / qs.length) * 100}%"></div></div><p class="muted">${i + 1} / ${qs.length}${q.target ? ` · 겨냥: ${esc(q.target)}` : ''}</p>
      <article class="card big"><h3 class="pre">${esc(q.question)}</h3><div class="choices">${(q.choices || []).map((c, k) => `<button class="choice" data-k="${L[k]}">${L[k]}. ${esc(c)}</button>`).join('')}</div><div id="fb"></div></article>`;
    $$('.choice', box).forEach((b) => (b.onclick = () => {
      const ok = b.dataset.k === q.answer; if (ok) score++;
      $$('.choice', box).forEach((x) => { x.disabled = true; if (x.dataset.k === q.answer) x.classList.add('right'); });
      if (!ok) { b.classList.add('wrong'); registerQuizMiss(q); }
      $('#fb').innerHTML = `<div class="ai"><h4>${ok ? '정답! 🎉' : `정답은 ${esc(q.answer)}`}</h4>${P(q.explanation)}</div><button class="btn primary" id="nx" style="margin-top:10px">${i + 1 < qs.length ? '다음 문제' : '결과 보기'}</button>`;
      $('#nx').onclick = () => { i++; draw(); };
    }));
  };
  draw();
}

function shuffleQ(q) {
  const L = ['A', 'B', 'C', 'D'], right = q.choices[L.indexOf(q.answer)];
  const ch = [...q.choices];
  for (let i = ch.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ch[i], ch[j]] = [ch[j], ch[i]]; }
  return { ...q, choices: ch, answer: L[ch.indexOf(right)] || q.answer };
}
function fallbackQuiz() {
  const out = [];
  for (const m of mistakes) for (const x of m.ai?.similar || []) {
    const letter = String(x.answer || '').match(/[A-D]/)?.[0];
    if (!letter || !Array.isArray(x.choices) || x.choices.length < 2) continue;
    out.push({ question: x.question, choices: x.choices.map((c) => String(c).replace(/^\(?[A-D]\)?[.\s]*/, '')), answer: letter, explanation: x.explanation || '', target: m.label });
  }
  return out.slice(0, 5);
}
async function registerQuizMiss(q) {
  try {
    const label = '[퀴즈] ' + String(q.question).replace(/\s+/g, ' ').slice(0, 40);
    if (mistakes.some((m) => m.label === label)) return;
    const L = ['A', 'B', 'C', 'D'], right = q.choices[L.indexOf(q.answer)] || '';
    const memo = `${q.question}\n${q.choices.map((c, k) => `${L[k]}. ${c}`).join('\n')}`.slice(0, 600);
    const m = await store.mistakes.add({ file_id: null, file_name: 'AI 퀴즈', page: 1, label, reason: S.reasons[S.reasons.length - 1] || '기타', memo, stage: 0, next_review: today(S.intervals[0]), graduated: false, ai: { answer: `정답 ${q.answer}. ${right}`, reason: q.explanation, tip: q.target ? `겨냥한 약점: ${q.target}` : '' } });
    mistakes.unshift(m); badge(); toast('틀린 문제를 오답노트에 담았어요 📒');
  } catch {}
}

// ───────── 둘러보기 (처음 쓰는 사람용) ─────────
async function exploreView() {
  try { [files, mistakes] = await Promise.all([store.files.list(), store.mistakes.list()]); } catch {}
  badge();
  const st = steps();
  const hasSample = files.some((f) => (f.tags || []).includes('예시')) || mistakes.some((m) => m.label?.startsWith('[예시]'));
  view.innerHTML = `
    <section class="hero">
      <h1>시작해 볼까요? 🚀</h1>
      <p>아래에서 하나만 고르면 바로 세팅돼요.</p>
      <div class="steps">${STEP_LABEL.map((l, i) => `<div class="step ${st[i] ? 'ok' : ''}"><i>${st[i] ? '✓' : i + 1}</i><span>${l}</span></div>`).join('')}</div>
    </section>

    <h3 class="sec">한 번에 시작하기</h3>
    <div class="tpls">${TEMPLATES.map((t) => `
      <article class="card tpl ${S.tpl === t.id ? 'active' : ''}">
        <div class="te">${t.emoji}</div>
        <h3>${esc(t.title)}</h3>
        <p class="muted">${esc(t.short)}</p>
        <button class="btn ${S.tpl === t.id ? '' : 'primary'}" data-tpl="${t.id}">${S.tpl === t.id ? '적용됨 ✓' : '이 템플릿으로 시작'}</button>
      </article>`).join('')}
    </div>
    ${hasSample ? '<div class="row" style="margin-top:10px"><button class="btn ghost sm" id="rmsample">🧹 예시 데이터 지우기</button></div>' : ''}

    <h3 class="sec">이렇게 써요</h3>
    <div class="scen">${SCENARIOS.map((s) => `<a class="card sc" href="${s.href}"><span class="te">${s.emoji}</span><div><b>${esc(s.title)}</b><p class="muted">${esc(s.body)}</p></div></a>`).join('')}</div>

    <h3 class="sec">목표</h3>
    <div class="row goal"><label>시험일 <input type="date" id="goaldate" value="${esc(S.goal?.date || '')}"></label><label>목표 점수 <input type="number" id="goaltarget" min="10" max="990" step="5" placeholder="예: 900" value="${esc(S.goal?.target || '')}"></label></div>

    <h3 class="sec">복습 주기</h3>
    <div class="chips" id="presets">${Object.entries(PRESETS).map(([k, p]) => `<button class="chip ${JSON.stringify(p.intervals) === JSON.stringify(S.intervals) ? 'on' : ''}" data-p="${k}">${p.name}</button>`).join('')}</div>`;
  $$('[data-tpl]').forEach((b) => (b.onclick = () => applyTemplate(TEMPLATES.find((t) => t.id === b.dataset.tpl))));
  $('#rmsample')?.addEventListener('click', removeSamples);
  const setGoal = () => { S.goal = { date: $('#goaldate').value, target: $('#goaltarget').value }; saveS(); };
  $('#goaldate')?.addEventListener('change', setGoal); $('#goaltarget')?.addEventListener('change', setGoal);
  $$('#presets .chip').forEach((c) => (c.onclick = () => { S.intervals = PRESETS[c.dataset.p].intervals; saveS(); toast('복습 주기를 바꿨어요'); exploreView(); }));
}

async function applyTemplate(t) {
  $$('[data-tpl]').forEach((b) => { b.disabled = true; });
  const tk = toast(`${t.emoji} "${t.title}" 세팅을 만드는 중…`, 0);
  try {
    S.intervals = PRESETS[t.preset].intervals; S.reasons = t.reasons; S.cats = [...new Set([...(S.cats || []), ...t.cats])]; S.tpl = t.id;
    files = await store.files.list(); mistakes = await store.mistakes.list();
    const rows = [];
    for (const n of t.notes) {
      let row = files.find((f) => f.name === n.name);
      if (!row) {
        let file;
        if (n.sample === 'toeic5') file = new File([await makeSamplePdf('TOEIC Part 5 Practice (original sample)', ['1. The manager asked all employees to ______ the report before Friday.', '   (A) submit   (B) submitting   (C) submission   (D) submitted', '', '2. The company will ______ a new energy-saving policy next month.', '   (A) implement   (B) appoint   (C) attend   (D) reserve', '', '3. Ms. Park was ______ for her outstanding contribution to the project.', '   (A) recognize   (B) recognized   (C) recognition   (D) recognizing', '', '4. Please keep your receipt ______ you need to return the item.', '   (A) in case   (B) because of   (C) as well as   (D) whereas', '', '5. The new software is ______ faster than the previous version.', '   (A) significant   (B) significantly   (C) signify   (D) significance', '', 'Answers: 1 A / 2 A / 3 B / 4 A / 5 B'])], n.name, { type: 'application/pdf' });
        else if (n.blank) file = new File([await makeNotePdf({ paper: n.blank, pages: 1 })], n.name, { type: 'application/pdf' });
        else file = new File([n.content], n.name, { type: 'text/markdown' });
        row = await store.files.add(file);
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
    toast(`✅ 예시 학습 공간을 만들었어요. 오늘 복습할 카드 ${due().length}장이 있어요`, 4500);
    location.hash = '#/review';
  } catch (e) { tk.close(); $$('[data-tpl]').forEach((b) => { b.disabled = false; }); toast('세팅 실패: ' + e.message, 5000); }
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
