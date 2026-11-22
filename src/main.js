import { $, $$, esc, toast, today, fmtDate, kind, REASONS, INTERVALS, guessCategory, ico, logo, deviceInfo, confetti, countUp } from './util.js';
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
let files = [], folders = [], mistakes = [], viewer = null;
const classifying = new Set();
const filter = { cat: '전체', q: '' };
let S = { intervals: INTERVALS, reasons: REASONS, cats: [], activity: {}, flags: {}, tpl: null, seen: false };

const ai = (action, payload) => store.ai(action, payload);
const saveS = () => store.settings.set(S).catch(() => {});
const bump = () => { S.activity[today()] = (S.activity[today()] || 0) + 1; saveS(); };
const flag = (k) => { if (!S.flags[k]) { S.flags[k] = 1; saveS(); } };
const xp = () => Object.values(S.activity).reduce((a, b) => a + b, 0) * 10;
const level = () => Math.floor(Math.sqrt(xp() / 30)) + 1;
const hap = (ms = 15) => { try { navigator.vibrate?.(ms); } catch {} };
const applyFs = () => { document.body.style.zoom = { sm: 0.92, md: 1, lg: 1.12 }[S.fs || 'md']; };
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
const steps = () => [files.some((f) => !f.deleted_at), !!S.flags.draw, mistakes.length > 0, mistakes.some((m) => m.last_result)];
const STEP_LABEL = ['파일 올리기', '필기해 보기', '오답 등록', '복습 1회'];
const reasonsAll = () => [...new Set([...S.reasons, ...mistakes.map((m) => m.reason).filter(Boolean)])];

// ───────── 실시간 동기화 ─────────
let lastLocal = 0, stopRealtime = null, syncState = { status: 'idle', devices: [] }, lastAnnToast = 0, qrTimer = 0;
for (const grp of [store.files, store.mistakes, store.ann]) for (const k of Object.keys(grp)) if (/^(add|update|remove|replace|save)$/.test(k) && typeof grp[k] === 'function') { const f = grp[k]; grp[k] = (...a) => { lastLocal = Date.now(); return f.apply(grp, a); }; }

function devIcons() {
  const seen = new Map(); syncState.devices.forEach((d) => seen.set(d.id, d));
  return [...seen.values()].map((d) => `<span title="${esc(d.label)}">${esc(d.icon)}</span>`).join('');
}
function renderSync(flash) {
  const el = $('#sync'); if (!el) return;
  if (store.mode !== 'cloud' || document.body.classList.contains('auth')) { el.hidden = true; return; }
  el.hidden = false;
  const on = syncState.status === 'online', n = new Set(syncState.devices.map((d) => d.id)).size;
  el.className = `sync ${on ? 'on' : 'off'}${flash ? ' flash' : ''}`;
  el.innerHTML = `<i class="dot"></i><span>${flash ? esc(flash) : on ? `동기화 켜짐${n > 1 ? ` · 기기 ${n}대` : ''}` : syncState.status === 'idle' ? '연결 중…' : '오프라인'}</span><b>${devIcons()}</b>`;
  const dl = $('#devlist'); if (dl) dl.innerHTML = devList();
}
function devList() {
  const seen = new Map(); syncState.devices.forEach((d) => seen.set(d.id, d));
  const me = deviceInfo().id;
  return seen.size ? [...seen.values()].map((d) => `<span class="devchip ${d.id === me ? 'me' : ''}">${esc(d.icon)} ${esc(d.label)}${d.id === me ? ' (이 기기)' : ''}</span>`).join('') : '<span class="muted">연결 중…</span>';
}
function startSync() {
  if (store.mode !== 'cloud' || stopRealtime) return;
  stopRealtime = () => {};
  store.realtime({
    status: (st) => { syncState.status = st; renderSync(); },
    presence: (list) => { const had = new Set(syncState.devices.map((d) => d.id)); syncState.devices = list; renderSync();
      list.filter((d) => !had.has(d.id) && d.id !== deviceInfo().id && had.size).forEach((d) => toast(`${d.icon} ${d.label}이(가) 연결됐어요`, 3000)); },
    change: onRemote,
    live: (pl) => viewer?.live?.(pl),
  }).then((stop) => { stopRealtime = stop; });
}
function onRemote(table, p) {
  const ev = p.eventType, rec = p.new && p.new.id !== undefined || p.new?.file_id ? p.new : null, old = p.old || {};
  const mine = Date.now() - lastLocal < 2500;
  const dev = rec?.device;
  if (table === 'strokes') {
    if (ev === 'DELETE') viewer?.remoteDel?.(old.id);
    else if (rec) viewer?.remoteAdd?.(rec.file_id, rec.page, { ...rec.data, id: rec.id }, rec.device);
    if (!mine && rec && Date.now() - lastAnnToast > 8000) { lastAnnToast = Date.now(); renderSync(`${dev || '다른 기기'}에서 필기 중`); setTimeout(() => renderSync(), 2200); }
    return;
  }
  const arr = table === 'files' ? files : table === 'folders' ? folders : mistakes;
  if (ev === 'DELETE') { const i = arr.findIndex((x) => x.id === old.id); if (i >= 0) arr.splice(i, 1); }
  else if (rec) { const i = arr.findIndex((x) => x.id === rec.id); if (i >= 0) arr[i] = { ...arr[i], ...rec }; else arr.unshift(rec); }
  if (table === 'folders' && $('#grid')) drawFiles();
  if (table === 'files' && $('#grid')) { drawFiles(); rec && $(`.file[data-id="${rec.id}"]`)?.classList.add('flash'); }
  if (table === 'mistakes') { badge(); if ($('#mlist')) drawMistakes(); if ($('#grid')) drawFiles(); }
  if (!mine && ev === 'INSERT' && rec) {
    const label = dev || '다른 기기';
    toast(table === 'files' ? `${label}에서 파일을 올렸어요: ${rec.name}` : `${label}에서 오답을 등록했어요`, 3200);
    renderSync(`${label}에서 변경됨`); setTimeout(() => renderSync(), 2200);
  }
}
async function openLinkDialog() {
  const d = $('#dlg');
  d.innerHTML = `<div class="dlg-body linkdlg"><h3>📲 다른 기기에서 이어서 열기</h3>
    <p class="muted">폰이나 태블릿 카메라로 QR을 찍으면 <b>같은 계정</b>으로 열려요. 한쪽에서 필기·오답을 바꾸면 다른 쪽에 <b>바로</b> 나타나요.</p>
    <div class="qrbox"><canvas id="qr" width="260" height="260"></canvas><div id="qrnote" class="muted"></div></div>
    <div class="muted" style="font-size:12px">지금 연결된 내 기기</div><div id="devlist" class="devs">${devList()}</div>
    <p class="muted" style="font-size:12px;margin-top:6px">※ 이 QR에는 로그인 정보가 들어 있어요. 시연용이며 약 1시간 동안 안정적으로 유지돼요. 다른 사람에게 보여 주지 마세요.</p>
    <div class="row end"><button class="btn" data-x>닫기</button></div></div>`;
  d.showModal(); $('[data-x]', d).onclick = () => d.close(); d.onclose = () => clearInterval(qrTimer);
  const draw = async () => {
    const url = await store.auth.linkUrl(); if (!url) return;
    const QR = (await import('qrcode')).default;
    await QR.toCanvas($('#qr'), url, { width: 260, margin: 1, errorCorrectionLevel: 'L', color: { dark: '#1b2140', light: '#ffffff' } });
    let left = 120; $('#qrnote').textContent = `QR은 ${left}초 뒤 사라져요`;
    clearInterval(qrTimer);
    qrTimer = setInterval(() => {
      left--; const n = $('#qrnote'); if (!n) return clearInterval(qrTimer);
      if (left > 0) n.textContent = `QR은 ${left}초 뒤 사라져요`;
      else { clearInterval(qrTimer); $('#qr').getContext('2d').clearRect(0, 0, 260, 260); n.innerHTML = '<button class="btn sm" id="qrre">QR 다시 만들기</button>'; $('#qrre').onclick = draw; }
    }, 1000);
  };
  draw();
}

// ───────── 라우터 ─────────
let stop3d = null;
async function route() {
  viewer?.destroy(); viewer = null;
  if (stop3d) { stop3d(); stop3d = null; }
  document.body.classList.remove('viewer-mode');
  const user = await store.auth.user();
  document.body.classList.toggle('auth', !user);
  if (!user) { if (stopRealtime) { stopRealtime(); stopRealtime = null; } renderSync(); return authView(); }
  if (!route.loaded) { S = { ...S, ...(await store.settings.get().catch(() => ({}))) }; route.loaded = true; applyFs(); }
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const [a, b] = path.split('/');
  renderNav(user, a || 'files');
  startSync(); renderSync();
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
  if (h === '#/files' || h === '#/mistakes') (async () => { try { await store.auth.consumeLink?.(); } catch {} route(); })();
});

const AVATARS = ['🙂', '😎', '🧑‍🎓', '👩‍💻', '🧑‍💻', '🦊', '🐱', '🐶', '🦉', '🐼', '🐧', '🦁', '🚢', '⚓', '📚', '✏️', '🔥', '⭐', '🌈', '🍀', '🎯', '🚀', '🌙', '☕'];
const PCOLORS = ['#3451c7', '#7c4dff', '#0ea5e9', '#12b886', '#f59f00', '#f06595', '#fa5252', '#495057'];
const hasAcct = (user) => store.mode === 'cloud' && !!user.email;
const acctId = (user) => (hasAcct(user) ? user.email.replace(/@studydrive\.id$/, '') : '');
const profileOf = (user) => { const p = S.profile || {}; return { name: p.name || (hasAcct(user) ? acctId(user).split('@')[0] : store.mode === 'cloud' ? '게스트' : '나'), emoji: p.emoji || '🙂', color: p.color || '#3451c7', bio: p.bio || '' }; };
const avatarHtml = (pf, cls = '') => `<span class="avatar ${cls}" style="--c:${pf.color}">${esc(pf.emoji)}</span>`;
let curUser = null;

function renderNav(user, active) {
  curUser = user;
  const on = (k) => (active === k || (k === 'files' && active === 'f') ? 'on' : '');
  const pf = profileOf(user); applyFs();
  nav.innerHTML = `
    <div class="brand">${logo(26)} <span>스터디드라이브</span></div>
    <button class="profile" id="pfbtn" aria-label="내 프로필">${avatarHtml(pf)}<span class="pf-t"><b>${esc(pf.name)}</b><small>Lv.${level()} · ${esc(pf.bio || (hasAcct(user) ? acctId(user) : store.mode === 'cloud' ? '게스트 체험 중' : '이 기기에만 저장'))}</small></span><i>${ico('pen', 14)}</i></button>
    <a href="#/files" class="${on('files')}"><i>${ico('folder')}</i><span>내 파일</span></a>
    <a href="#/review" class="${on('review')}"><i>${ico('repeat')}</i><span>오늘 복습</span><b id="due-badge" hidden></b></a>
    <a href="#/mistakes" class="${on('mistakes') || on('quiz')}"><i>${ico('book')}</i><span>오답노트</span></a>
    <a href="#/explore" class="${on('explore')}"><i>${ico('compass')}</i><span>둘러보기</span></a>
    ${store.mode === 'cloud' ? `<button class="btn sm navsync" id="syncbtn">${ico('link', 16)} 다른 기기로 열기</button>` : '<em class="localnote">이 기기에만 저장 중</em>'}`;
  const mp = $('#mprofile'); if (mp) { mp.hidden = false; mp.innerHTML = avatarHtml(pf); }
  $('#pfbtn')?.addEventListener('click', () => openProfile(user));
  $('#syncbtn')?.addEventListener('click', openLinkDialog);
  store.mistakes.list().then((m) => { mistakes = m; badge(); }).catch(() => {});
}
function openProfile(user = curUser) {
  if (!user) return;
  const pf = { ...profileOf(user) }, d = $('#dlg'), guest = store.mode === 'cloud' && !user.email;
  d.className = '';
  d.innerHTML = `<form class="dlg-body profile-dlg">
    <div class="pf-head"><span id="pfav">${avatarHtml(pf, 'big')}</span><div><h3>내 프로필</h3><small class="muted">${esc(store.mode === 'cloud' ? (hasAcct(user) ? `아이디: ${acctId(user)}` : '게스트 계정 (이 브라우저에 저장)') : '이 기기에서만 쓰는 로컬 모드')}</small></div></div>
    <div class="lvl" title="복습·필기 활동으로 쌓여요"><b>Lv.${level()}</b><div><i style="width:${Math.max(4, Math.round(((xp() / 30) - Math.pow(level() - 1, 2)) / (Math.pow(level(), 2) - Math.pow(level() - 1, 2)) * 100))}%"></i></div><small>${xp()} XP · 🔥 ${streak()}일</small></div>
    <label>닉네임<input name="name" maxlength="14" value="${esc(pf.name)}" placeholder="닉네임"></label>
    <label>한 줄 소개<input name="bio" maxlength="40" value="${esc(pf.bio)}" placeholder="예: 토익 900 · 12월 시험"></label>
    <div class="pf-sec">아이콘</div><div class="emojis av">${AVATARS.map((e) => `<button type="button" class="emo${e === pf.emoji ? ' on' : ''}" data-e="${e}" aria-label="아이콘 ${e}">${e}</button>`).join('')}</div>
    <div class="pf-sec">색상</div><div class="swatches">${PCOLORS.map((c) => `<button type="button" class="sw${c === pf.color ? ' on' : ''}" data-c="${c}" style="--c:${c}" aria-label="색상"></button>`).join('')}</div>
    <div class="pf-sec">글자 크기</div><div class="chips" id="pffs">${[['sm', '작게'], ['md', '보통'], ['lg', '크게']].map(([k, l]) => `<button type="button" class="chip${(S.fs || 'md') === k ? ' on' : ''}" data-fs="${k}">${l}</button>`).join('')}</div>
    <details class="pf-more"><summary>학습 설정</summary>
      <div class="row goal"><label>시험일<input type="date" name="gdate" value="${esc(S.goal?.date || '')}"></label><label>목표 점수<input type="number" name="gtarget" min="10" max="990" step="5" placeholder="예: 900" value="${esc(S.goal?.target || '')}"></label></div>
      <div class="pf-sec">복습 주기</div><div class="chips" id="pfpresets">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" class="chip${JSON.stringify(p.intervals) === JSON.stringify(S.intervals) ? ' on' : ''}" data-p="${k}">${p.name}</button>`).join('')}</div>
    </details>
    ${store.mode === 'cloud' ? `<div class="pf-sec">계정</div><div class="row">${guest ? '<button type="button" class="btn" id="pfup">계정 만들기 (데이터 그대로)</button>' : ''}<button type="button" class="btn ghost" id="pflogout">로그아웃</button></div>` : ''}
    <div class="row end"><button type="button" class="btn ghost" data-x>닫기</button><button class="btn primary">저장</button></div></form>`;
  d.showModal();
  const f = $('form', d); let em = pf.emoji, col = pf.color, iv = S.intervals;
  const paint = () => { $('#pfav', d).innerHTML = avatarHtml({ emoji: em, color: col }, 'big'); };
  $$('.av .emo', d).forEach((b) => (b.onclick = () => { em = b.dataset.e; $$('.av .emo', d).forEach((x) => x.classList.toggle('on', x === b)); paint(); }));
  $$('.sw', d).forEach((b) => (b.onclick = () => { col = b.dataset.c; $$('.sw', d).forEach((x) => x.classList.toggle('on', x === b)); paint(); }));
  $$('#pfpresets .chip', d).forEach((c) => (c.onclick = () => { iv = PRESETS[c.dataset.p].intervals; $$('#pfpresets .chip', d).forEach((x) => x.classList.toggle('on', x === c)); }));
  $$('#pffs .chip', d).forEach((c) => (c.onclick = () => { S.fs = c.dataset.fs; applyFs(); $$('#pffs .chip', d).forEach((x) => x.classList.toggle('on', x === c)); }));
  $('[data-x]', d).onclick = () => d.close();
  $('#pflogout', d)?.addEventListener('click', async () => { if (guest && !confirm('게스트 데이터는 로그아웃하면 사라져요. 계속할까요?')) return; d.close(); await store.auth.signOut(); route.loaded = false; route(); });
  $('#pfup', d)?.addEventListener('click', () => { d.close(); upgradeDialog(); });
  f.onsubmit = (e) => {
    e.preventDefault();
    S.profile = { name: f.name.value.trim(), bio: f.bio.value.trim(), emoji: em, color: col };
    S.goal = { date: f.gdate.value, target: f.gtarget.value }; S.intervals = iv; saveS();
    d.close(); renderNav(user, (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'files'); toast('프로필을 저장했어요');
    if ($('#grid')) drawFiles();
  };
}
function upgradeDialog() {
  const d = $('#dlg'); d.className = '';
  d.innerHTML = `<form class="dlg-body"><h3>계정 만들기</h3><p class="muted">지금까지의 파일·필기·오답을 그대로 유지한 채 내 계정으로 바꿔요. <b>이메일 없이</b> 아이디만 정하면 돼요.</p>
    <label>아이디 (영문 소문자·숫자·_ 3~20자)<input name="id" required autocomplete="username" autocapitalize="none" spellcheck="false" pattern="[A-Za-z0-9_]{3,20}"></label>
    <label>비밀번호 (6자 이상)<input name="pw" type="password" minlength="6" required autocomplete="new-password"></label>
    <div class="row end"><button type="button" class="btn ghost" data-x>취소</button><button class="btn primary">계정 만들기</button></div></form>`;
  d.showModal();
  const f = $('form', d); f.id.focus(); $('[data-x]', d).onclick = () => d.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { await store.auth.upgrade(f.id.value.trim(), f.pw.value); d.close(); toast('계정이 만들어졌어요! 이제 이 아이디로 어디서든 로그인할 수 있어요', 5000); route.loaded = false; route(); } catch (er) { toast(er.message, 5000); }
  };
}
function badge() { const b = $('#due-badge'); if (b) { const n = due().length; b.hidden = !n; b.textContent = n; } }

// ───────── 로그인 ─────────
function authView() {
  nav.innerHTML = '';
  const FEATS = [
    ['folder', '#38bdf8', 'AI 자료 관리', 'PDF를 올리면 AI가 카테고리·태그·요약을 붙여요. 스캔본은 첫 쪽 이미지를 읽어 정리해요.'],
    ['repeat', '#34d399', '기기 간 동기화', 'PC·태블릿·폰 어디서든 같은 계정으로 이어서. 필기와 오답이 그대로 따라와요.'],
    ['book', '#fbbf24', '간격 복습', '틀린 문제는 오답노트로, 1·3·7·14일 주기로 복습 일정을 잡아 줘요.'],
    ['pen', '#c084fc', 'AI 해설·유사 문제', '문제 쪽 이미지를 AI가 읽고 해설, 틀린 이유, 유사 문제 2개를 만들어요.'],
    ['mark', '#fb7185', '약점 진단·맞춤 퀴즈', '오답 통계로 약점을 진단하고, 내 오답을 겨냥한 퀴즈 5문제를 내 줘요.'],
    ['compass', '#22d3ee', '원클릭 템플릿', '토익·수업·자격증 템플릿으로 폴더와 예시, 복습 일정을 3분 만에 시작해요.'],
  ];
  view.innerHTML = `
    <div class="landing">
      <div id="bg3d" class="bg3d" aria-hidden="true"></div>
      <header class="lp-head"><div class="brand">${logo(30)} <span>스터디드라이브</span></div>
        <nav class="lp-nav"><a href="#lp-feats" data-scroll>기능</a><a href="#lp-edu" data-scroll>학습과학</a></nav></header>
      <section class="lp-hero">
        <div class="lp-copy">
          <span class="lp-pill"><i></i>AI 학습 드라이브 · 개인 출품작</span>
          <h1>문서를 올리면<br><em>내 오답이 내 복습표</em>가 됩니다</h1>
          <p>태블릿에서 풀고, 폰으로 복습하고, PC로 정리하세요.<br>자료·필기·오답·복습이 하나로 이어지는 학습 드라이브예요.</p>
          <div class="lp-cta">
            ${store.mode === 'cloud' ? '<button class="btn primary lg" id="demo">가입 없이 체험하기 ✨</button>' : ''}
            <a class="btn lg" href="#lp-feats" data-scroll>기능 살펴보기</a>
          </div>
          <div class="lp-stats"><span><b>3</b>기기 이어쓰기</span><span><b>7</b>AI 기능</span><span><b>4</b>단계 복습</span></div>
        </div>
        <form id="af" class="lp-card glass">
          <h2>로그인</h2>
          <label class="vh2" for="em">아이디</label><input id="em" type="text" name="email" placeholder="아이디 (또는 이메일)" required autocomplete="username" autocapitalize="none" spellcheck="false">
          <label class="vh2" for="pw">비밀번호</label><input id="pw" type="password" name="pw" placeholder="비밀번호 (6자 이상)" required minlength="6" autocomplete="current-password">
          <div class="row"><button class="btn primary grow" data-m="in">로그인</button><button class="btn grow" type="button" data-m="up">회원가입</button></div>
          <small>아이디는 영문 소문자·숫자·밑줄(_) 3~20자. 이메일 없이 만들 수 있어요.<br>계정이 없어도 <b>가입 없이 체험하기</b>로 바로 써 볼 수 있어요.</small>
        </form>
      </section>
      <section class="lp-sync glass">
        <div class="lp-sync-copy"><span class="lp-pill"><i></i>이 앱의 핵심</span><h2>한 기기에서 쓰면,<br><em>다른 기기에 바로</em> 나타나요</h2>
          <p>PC에서 PDF에 필기하면 폰·태블릿 화면에 새로고침 없이 그려집니다. 오답 등록, 파일 업로드도 마찬가지예요. 지금 연결된 기기는 화면 위에 실시간으로 표시돼요.</p>
          <ul><li>실시간 반영 — 필기·오답·파일</li><li>연결된 기기 표시 — 💻 PC · 📟 태블릿 · 📱 폰</li><li>QR 한 번으로 다른 기기 연결</li></ul></div>
        <svg class="lp-sync-art" viewBox="0 0 420 240" role="img" aria-label="PC, 태블릿, 폰이 클라우드를 통해 실시간으로 연결되는 그림"><use href="#syncart-big"/></svg>
      </section>
      <section class="lp-video"><div class="lpv-copy"><h2>15초로 보는 스터디드라이브</h2><p>필기가 다른 기기에 바로 따라 그려지고, AI가 정리하고, 잊을 때쯤 복습을 알려줘요.</p></div>
        <video controls playsinline preload="none" poster="poster.jpg" src="promo.mp4" aria-label="스터디드라이브 15초 소개 영상"></video></section>
      <section id="lp-feats" class="lp-feats">
        ${FEATS.map(([i, c, t, d]) => `<article class="glass"><span class="fi" style="--c:${c}">${ico(i, 22)}</span><h3>${t}</h3><p>${d}</p></article>`).join('')}
      </section>
      <section id="lp-edu" class="lp-edu glass"><b>학습과학에 대응하는 기능</b>
        <span>먼저 떠올려 적기(인출 연습)</span><span>1·3·7·14일 간격 복습</span><span>확신도 체크(메타인지)</span><span>시험 D-day·성장 기록</span></section>
      <footer class="lp-foot">제출자 허재하 · 항해정보시스템학부 · 2024175 &nbsp;|&nbsp; 바이브코딩 경진대회 개인 출품작</footer>
    </div>`;
  import('./intro3d.js').then((m) => { if ($('#bg3d')) stop3d = m.start($('#bg3d')); }).catch(() => {});
  $$('[data-scroll]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); $(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth' }); }));
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

// ───────── 내 파일 (홈 화면처럼 정리: 폴더·드래그·휴지통) ─────────

const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const FV = { tab: lsGet('sd-tab', 'doc'), folder: null, sort: lsGet('sd-sort', 'new'), layout: lsGet('sd-layout', 'icons'), sel: new Set(), selecting: false };
const TABS = [['doc', '📚', '자료'], ['note', '✍️', '노트'], ['memo', '📝', '메모'], ['trash', '🗑', '휴지통']];
const TRASH_DAYS = 7;
const FEMOJI = ['📁', '📂', '📘', '📗', '📙', '📕', '⭐', '🎯', '🚢', '⚓', '🧠', '✏️', '🔥', '💡', '🎧', '🗓️', '🧪', '🏆', '🌱', '🌙'];
const alive = (f) => !f.deleted_at;
const tabOf = (f) => (kind(f.name, f.mime) === 'text' ? 'memo' : (f.tags || []).includes('노트') ? 'note' : 'doc');
const TILE = { pdf: ['#ff8787', '#f03e3e', 'PDF'], image: ['#69db7c', '#2f9e44', 'IMG'], note: ['#74c0fc', '#3451c7', '✍'], memo: ['#ffe066', '#f59f00', 'MD'] };
const tileKind = (f) => { const k = kind(f.name, f.mime); return k === 'text' ? 'memo' : (f.tags || []).includes('노트') ? 'note' : k === 'image' ? 'image' : 'pdf'; };
const kids = (pid) => folders.filter((x) => (x.parent_id || null) === (pid || null)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
const pathOf = (id) => { const out = []; let c = folders.find((x) => x.id === id), g = 0; while (c && g++ < 24) { out.unshift(c); c = folders.find((x) => x.id === c.parent_id); } return out; };
const descOf = (id) => { const out = new Set([id]); let ch = true; while (ch) { ch = false; for (const f of folders) if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) { out.add(f.id); ch = true; } } return out; };
const inFolder = (f) => (f.folder_id || null) === (FV.folder || null);
const sorters = { new: (a, b) => String(b.created_at).localeCompare(String(a.created_at)), name: (a, b) => a.name.localeCompare(b.name, 'ko'), size: (a, b) => (b.size || 0) - (a.size || 0) };
const sizeTxt = (n) => (n < 1048576 ? Math.max(1, Math.round((n || 0) / 1024)) + 'KB' : (n / 1048576).toFixed(1) + 'MB');
const dispName = (f) => f.name.replace(/\.(md|txt)$/i, '');
const daysLeft = (f) => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - new Date(f.deleted_at)) / 864e5));
const itemsIn = (id) => files.filter((f) => alive(f) && f.folder_id === id).length + folders.filter((x) => x.parent_id === id).length;

async function filesView() {
  view.innerHTML = `
    <header class="vh"><h2>내 파일</h2>
      <div class="row tools">
        <input id="q" type="search" placeholder="🔍 검색" value="${esc(filter.q)}" aria-label="검색">
        <button class="btn icon" id="selmode" title="여러 개 선택" aria-label="여러 개 선택">${ico('check', 18)}</button>
        <button class="btn icon" id="layout" title="보기 전환" aria-label="보기 전환">${ico(FV.layout === 'icons' ? 'list' : 'grid', 18)}</button>
        <select id="sort" aria-label="정렬"><option value="new">최신순</option><option value="name">이름순</option><option value="size">크기순</option></select>
      </div>
    </header>
    <div class="row actions">
      <label class="btn primary">＋ 업로드<input id="up" type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md"></label>
      <button class="btn" id="newfolder">${ico('folderplus', 18)} 새 폴더</button>
      <button class="btn" id="newnote">📝 새 노트</button>
      <button class="btn" id="newmemo">＋ 새 메모</button>
    </div>
    <div id="stats"></div><div id="banner"></div>
    <div id="tabs" class="tabs" role="tablist"></div>
    <nav id="crumbs" class="crumbs" aria-label="폴더 경로"></nav>
    <div id="chips" class="chips"></div>
    <div id="trashbar" class="trashbar" hidden></div>
    <div id="grid" class="grid tiles"></div>
    <div id="selbar" class="selbar" hidden></div>
    <div id="drop" class="drop">여기에 놓아서 업로드</div>`;
  $('#sort').value = FV.sort;
  $('#grid').innerHTML = Array.from({ length: 8 }, () => '<div class="tile skel"><div class="ticon"></div><i></i></div>').join('');
  try { [files, folders, mistakes] = await Promise.all([store.files.list(), store.folders.list(), store.mistakes.list()]); } catch (e) { return void ($('#grid').innerHTML = `<p class="muted">불러오기 실패: ${esc(e.message)}</p>`); }
  if (!S.seen) { S.seen = true; saveS(); if (!files.length) { location.hash = '#/explore'; return; } }
  await purgeOldTrash();
  badge();
  FV.sel.clear(); FV.selecting = false;
  drawFiles(true);
  $('#q').addEventListener('input', (e) => { filter.q = e.target.value; drawFiles(); });
  $('#sort').addEventListener('change', (e) => { FV.sort = e.target.value; lsSet('sd-sort', FV.sort); drawFiles(); });
  $('#layout').addEventListener('click', () => { FV.layout = FV.layout === 'icons' ? 'list' : 'icons'; lsSet('sd-layout', FV.layout); $('#layout').innerHTML = ico(FV.layout === 'icons' ? 'list' : 'grid', 18); drawFiles(); });
  $('#selmode').addEventListener('click', () => { FV.selecting = !FV.selecting; if (!FV.selecting) FV.sel.clear(); drawFiles(); });
  $('#newfolder').addEventListener('click', createFolderDialog);
  $('#newnote').addEventListener('click', noteDialog);
  $('#newmemo').addEventListener('click', newMemoDialog);
  $('#up').addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = ''; });
  if (!filesView.bound) {
    filesView.bound = true;
    addEventListener('dragover', (e) => { if ($('#grid') && !DND.on && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); $('#drop')?.classList.add('on'); } });
    addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('#drop')?.classList.remove('on'); });
    addEventListener('drop', (e) => { if ($('#grid') && e.dataTransfer?.files?.length) { e.preventDefault(); $('#drop')?.classList.remove('on'); handleFiles([...e.dataTransfer.files]); } });
    view.addEventListener('pointerdown', dndDown);
    addEventListener('pointermove', dndMove);
    addEventListener('pointerup', () => dndEnd(false));
    addEventListener('pointercancel', () => dndEnd(true));
    addEventListener('touchmove', (e) => { if (DND.on) e.preventDefault(); }, { passive: false });
    addEventListener('contextmenu', (e) => { if (DND.on || e.target.closest?.('.tile')) e.preventDefault(); });
  }
}

function heatmap() {
  const W = 14, tot = [...Array(W * 7)].map((_, i) => S.activity[today(-(W * 7 - 1 - i))] || 0), mx = Math.max(1, ...tot), days = tot.filter(Boolean).length;
  return `<section class="card heat" aria-label="최근 14주 학습 기록"><div class="heat-h"><b>학습 기록</b><small class="muted">최근 14주 · ${days}일 공부했어요</small></div>
    <div class="heat-g">${tot.map((v, i) => `<i class="l${v ? Math.min(4, Math.ceil((v / mx) * 4)) : 0}" title="${today(-(W * 7 - 1 - i))} · ${v}회"></i>`).join('')}</div></section>`;
}
function statsHtml() {
  const n = due().length, grad = mistakes.filter((m) => m.graduated).length;
  const wk = [6, 5, 4, 3, 2, 1, 0].map((i) => S.activity[today(-i)] || 0), mx = Math.max(1, ...wk);
  return `<section class="stats">
    <a class="stat hot" href="#/review"><b data-count="${n}">0</b><span>오늘 복습</span></a>
    <div class="stat"><b>🔥 <span data-count="${streak()}">0</span></b><span>연속 학습일</span></div>
    <div class="stat"><b>🎓 <span data-count="${grad}">0</span></b><span>마스터한 오답</span></div>
    <div class="stat week" title="최근 7일 학습량">${wk.map((v) => `<i style="height:${6 + (v / mx) * 30}px" class="${v ? 'on' : ''}"></i>`).join('')}<span>7일</span></div>
  </section>${store.mode === 'cloud' ? `<div class="quota" title="사용자당 저장 한도"><div><i style="width:${Math.min(100, (usedBytes() / QUOTA) * 100)}%"></i></div><small>저장공간 ${mb(usedBytes())} / ${mb(QUOTA)}</small></div>` : ''}`;
}

const tileIcon = (f) => { const [a, b, t] = TILE[tileKind(f)]; return `<div class="ticon" style="--g1:${a};--g2:${b}"><b>${t}</b></div>`; };

function fileTile(f, trash) {
  const sel = FV.sel.has(f.id);
  return `<article class="tile file${sel ? ' sel' : ''}" data-id="${f.id}" tabindex="0" role="button" aria-label="${esc(f.name)} 열기">
    ${FV.selecting ? `<label class="chk"><input type="checkbox" data-sel ${sel ? 'checked' : ''} aria-label="선택"></label>` : ''}
    ${tileIcon(f)}
    ${trash ? `<span class="tbadge">${daysLeft(f)}일 뒤 삭제</span>` : ''}
    <h3 class="tname">${esc(dispName(f))}</h3>
    <div class="tmeta">${classifying.has(f.id) ? '<span class="badge busy">AI 분류 중…</span>' : `<span class="badge" data-act="cat">${esc(f.category || '미분류')}</span>`}${(f.tags || []).filter((t) => t !== '노트').slice(0, 2).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}<small>${fmtDate(f.created_at)} · ${sizeTxt(f.size)}</small></div>
    <button class="more" data-act="menu" aria-label="더 보기">${ico('more', 18)}</button>
  </article>`;
}
function folderTile(f) {
  const inner = [...files.filter((x) => alive(x) && x.folder_id === f.id), ...folders.filter((x) => x.parent_id === f.id)].slice(0, 4);
  const mini = inner.map((x) => (x.deleted_at !== undefined || x.mime !== undefined ? (() => { const [a, b] = TILE[tileKind(x)]; return `<i style="--g1:${a};--g2:${b}"></i>`; })() : '<i style="--g1:#74c0fc;--g2:#3451c7"></i>')).join('');
  return `<article class="tile folder" data-fid="${f.id}" tabindex="0" role="button" aria-label="${esc(f.name)} 폴더 열기">
    <div class="ticon folderi"><span class="femo">${esc(f.emoji || '📁')}</span><div class="fprev">${mini}</div></div>
    <h3 class="tname">${esc(f.name)}</h3>
    <div class="tmeta"><small>${itemsIn(f.id)}개 항목</small></div>
    <button class="more" data-act="fmenu" aria-label="폴더 메뉴">${ico('more', 18)}</button>
  </article>`;
}

function drawFiles(anim) {
  const grid = $('#grid'); if (!grid) return;
  if (FV.folder && !folders.some((x) => x.id === FV.folder)) FV.folder = null;
  const liveFiles = files.filter(alive), trashed = files.filter((f) => f.deleted_at);
  const cats = [...new Set([...(S.cats || []), ...liveFiles.map((f) => f.category || '미분류')])];
  if (filter.cat !== '전체' && !cats.includes(filter.cat)) filter.cat = '전체';
  const q = filter.q.trim().toLowerCase(), searching = !!q, trash = FV.tab === 'trash' && !searching;

  $('#stats').innerHTML = statsHtml() + growthHtml();
  $$('#stats [data-count]').forEach((el) => countUp(el, +el.dataset.count));
  const st = steps(), dn = st.filter(Boolean).length;
  $('#banner').innerHTML = dn < 4 ? `<a class="banner" href="#/explore">🚀 시작 가이드 ${dn}/4 · 다음: <b>${STEP_LABEL[st.indexOf(false)]}</b> (둘러보기에서 시작)</a>` : '';

  const cnt = (k) => (k === 'trash' ? trashed.length : liveFiles.filter((f) => tabOf(f) === k && (searching || inFolder(f))).length);
  $('#tabs').innerHTML = TABS.map(([k, i, l]) => `<button class="tabb${FV.tab === k ? ' on' : ''}${k === 'trash' ? ' trashtab' : ''}" data-tab="${k}" role="tab" aria-selected="${FV.tab === k}">${i} ${l} <small>${cnt(k)}</small></button>`).join('');
  $('#newnote').hidden = FV.tab === 'memo' || trash; $('#newmemo').hidden = FV.tab !== 'memo'; $('#newfolder').hidden = trash;
  document.querySelector('.actions label.btn').hidden = trash;

  const crumbs = $('#crumbs');
  crumbs.hidden = searching || trash;
  crumbs.innerHTML = `<button class="crumb" data-fid="">🏠 내 파일</button>${pathOf(FV.folder).map((f) => `<span>›</span><button class="crumb" data-fid="${f.id}">${esc(f.emoji || '📁')} ${esc(f.name)}</button>`).join('')}`;

  $('#chips').hidden = trash;
  $('#chips').innerHTML = ['전체', ...cats].map((c) => `<button class="chip${filter.cat === c ? ' on' : ''}" data-c="${esc(c)}">${esc(c)} <small>${c === '전체' ? liveFiles.length : liveFiles.filter((f) => (f.category || '미분류') === c).length}</small></button>`).join('') + '<button class="chip add" id="addcat" title="카테고리 관리">＋</button>';

  const tb = $('#trashbar'); tb.hidden = !trash;
  tb.innerHTML = trash ? `<div class="tb-note"><b>🗑 휴지통</b><small>삭제한 파일은 ${TRASH_DAYS}일 동안 여기에 보관돼요. 그 사이에는 언제든 복원할 수 있고, ${TRASH_DAYS}일이 지나면 자동으로 완전히 삭제돼요.</small></div>${trashed.length ? `<div class="row"><button class="btn sm" data-tb="restoreall">모두 복원</button><button class="btn sm danger-b" data-tb="empty">휴지통 비우기</button></div>` : ''}` : '';

  grid.className = `grid tiles ${FV.layout === 'list' ? 'list' : 'icons'}${anim ? '' : ' static'}${FV.selecting ? ' selecting' : ''}`;
  let list, fl = [];
  if (trash) list = trashed;
  else if (searching) { list = liveFiles.filter((f) => `${f.name} ${f.category} ${(f.tags || []).join(' ')} ${f.summary || ''}`.toLowerCase().includes(q)); fl = folders.filter((f) => f.name.toLowerCase().includes(q)); }
  else { list = liveFiles.filter((f) => inFolder(f) && tabOf(f) === FV.tab && (filter.cat === '전체' || (f.category || '미분류') === filter.cat)); fl = kids(FV.folder); }
  list = [...list].sort(sorters[FV.sort]);
  const html = fl.map(folderTile).join('') + list.map((f) => fileTile(f, trash)).join('');
  const empty = {
    doc: ['📚', 'PDF나 사진을 올려 보세요', 'AI가 알아서 분류해 줘요. 끌어서 폴더로 옮길 수도 있어요.', '<a class="btn primary" href="#/explore">🧭 원클릭으로 시작하기</a>'],
    note: ['✍️', '빈 노트를 만들어 필기해 보세요', '백지·줄·모눈·점·코넬 노트를 고를 수 있어요.', ''],
    memo: ['📝', '메모(.md·.txt)는 여기에 따로 모여요', '글을 쓰면 다른 기기에서도 실시간으로 같이 편집돼요.', ''],
    trash: ['🗑', '휴지통이 비어 있어요', `삭제한 파일은 ${TRASH_DAYS}일 동안 여기서 복원할 수 있어요.`, ''],
  }[searching ? 'doc' : FV.tab];
  grid.innerHTML = html || (searching ? '<div class="empty"><div>🔍</div><p>검색 결과가 없어요</p></div>' : `<div class="empty"><div>${empty[0]}</div><h3>${empty[1]}</h3><p>${empty[2]}</p>${empty[3]}</div>`);
  updateSelUI();
}
function updateSelUI() {
  const bar = $('#selbar'); if (!bar) return;
  $$('.tile.file').forEach((t) => { const on = FV.sel.has(t.dataset.id); t.classList.toggle('sel', on); const c = $('input[data-sel]', t); if (c) c.checked = on; });
  bar.hidden = !FV.sel.size;
  bar.innerHTML = FV.sel.size ? (FV.tab === 'trash'
    ? `<b>${FV.sel.size}개 선택</b><button data-sb="restore">복원</button><button data-sb="purge" class="danger">영구 삭제</button><button data-sb="clear">해제</button>`
    : `<b>${FV.sel.size}개 선택</b><button data-sb="move">이동</button><button data-sb="copy">복사</button><button data-sb="cat">카테고리</button><button data-sb="del" class="danger">삭제</button><button data-sb="all">전체 선택</button><button data-sb="clear">해제</button>`) : '';
}

// ── 공용 대화상자 ──
function sheet(title, items) {
  return new Promise((res) => {
    const d = $('#dlg'); d.className = 'sheet';
    d.innerHTML = `<div class="dlg-body"><h3>${esc(title)}</h3><div class="sheet-list">${items.map((i) => `<button class="sheet-i${i.danger ? ' danger' : ''}" data-do="${i.id}"><span>${i.icon || ''}</span>${esc(i.label)}</button>`).join('')}</div><button class="btn ghost" data-x>닫기</button></div>`;
    let done = false; const fin = (v) => { if (done) return; done = true; d.className = ''; d.close(); res(v); };
    d.showModal(); $$('[data-do]', d).forEach((b) => (b.onclick = () => fin(b.dataset.do))); $('[data-x]', d).onclick = () => fin(null); d.onclose = () => fin(null);
  });
}
function askText({ title, label, value = '', ok = '확인', emojis = false, emoji = '📁', placeholder = '', max = 40 }) {
  return new Promise((res) => {
    const d = $('#dlg'); d.className = '';
    d.innerHTML = `<form class="dlg-body"><h3>${esc(title)}</h3>
      <label>${esc(label)}<input name="v" value="${esc(value)}" maxlength="${max}" placeholder="${esc(placeholder)}" required autocomplete="off"></label>
      ${emojis ? `<div class="emojis">${FEMOJI.map((e) => `<button type="button" class="emo${e === emoji ? ' on' : ''}" data-e="${e}" aria-label="아이콘 ${e}">${e}</button>`).join('')}</div>` : ''}
      <div class="row end"><button type="button" class="btn ghost" data-x>취소</button><button class="btn primary">${esc(ok)}</button></div></form>`;
    let em = emoji, done = false; const fin = (v) => { if (done) return; done = true; d.close(); res(v); };
    d.showModal(); const f = $('form', d); f.v.focus(); f.v.select();
    $$('.emo', d).forEach((b) => (b.onclick = () => { em = b.dataset.e; $$('.emo', d).forEach((x) => x.classList.toggle('on', x === b)); }));
    $('[data-x]', d).onclick = () => fin(null); d.onclose = () => fin(null);
    f.onsubmit = (e) => { e.preventDefault(); const v = f.v.value.trim(); if (v) fin(emojis ? { name: v, emoji: em } : v); };
  });
}
function pickFolder({ title = '폴더 선택', exclude = new Set(), current } = {}) {
  return new Promise((res) => {
    const d = $('#dlg'); d.className = '';
    const rows = (pid, depth) => kids(pid).filter((f) => !exclude.has(f.id)).map((f) => `<button class="pf${f.id === current ? ' cur' : ''}" style="--d:${depth}" data-f="${f.id}">${esc(f.emoji || '📁')} ${esc(f.name)}</button>${rows(f.id, depth + 1)}`).join('');
    d.innerHTML = `<div class="dlg-body"><h3>${esc(title)}</h3><div class="pflist"><button class="pf${current === null ? ' cur' : ''}" data-f="">🏠 내 파일 (맨 위)</button>${rows(null, 1)}</div><div class="row end"><button class="btn ghost" data-x>취소</button><button class="btn" id="pfnew">${ico('folderplus', 16)} 새 폴더</button></div></div>`;
    let done = false; const fin = (v) => { if (done) return; done = true; d.close(); res(v); };
    d.showModal(); $$('.pf', d).forEach((b) => (b.onclick = () => fin(b.dataset.f || null))); $('[data-x]', d).onclick = () => fin(undefined); d.onclose = () => fin(undefined);
    $('#pfnew', d).onclick = async () => { done = true; d.close(); const r = await askText({ title: '새 폴더', label: '폴더 이름', emojis: true }); if (r) { const f = await store.folders.add({ name: r.name, emoji: r.emoji, parent_id: null }); folders.push(f); } res(await pickFolder({ title, exclude, current })); };
  });
}

// ── 폴더 ──
async function createFolderDialog() {
  const r = await askText({ title: '새 폴더', label: '폴더 이름', emojis: true, placeholder: '예: 토익 Part5' });
  if (!r) return;
  try { const f = await store.folders.add({ name: r.name, emoji: r.emoji, parent_id: FV.folder }); folders.push(f); drawFiles(); toast('폴더를 만들었어요'); } catch (e) { toast('폴더 만들기 실패: ' + e.message); }
}
async function folderMenu(id) {
  const f = folders.find((x) => x.id === id); if (!f) return;
  const act = await sheet(`${f.emoji || '📁'} ${f.name}`, [{ id: 'open', icon: '📂', label: '열기' }, { id: 'rename', icon: '✏️', label: '이름·아이콘 바꾸기' }, { id: 'move', icon: '📦', label: '다른 폴더로 이동' }, { id: 'del', icon: '🗑', label: '폴더 삭제 (안의 파일은 위로 올라가요)', danger: true }]);
  if (act === 'open') { FV.folder = id; drawFiles(); }
  if (act === 'rename') { const r = await askText({ title: '폴더 이름·아이콘', label: '폴더 이름', value: f.name, emojis: true, emoji: f.emoji || '📁' }); if (r) { Object.assign(f, await store.folders.update(id, { name: r.name, emoji: r.emoji })); drawFiles(); } }
  if (act === 'move') { const to = await pickFolder({ title: '이동할 폴더', exclude: descOf(id), current: f.parent_id || null }); if (to !== undefined) await moveFolderTo(id, to); }
  if (act === 'del') await deleteFolder(id);
}
async function moveFolderTo(id, to) {
  const f = folders.find((x) => x.id === id); if (!f || (f.parent_id || null) === (to || null) || (to && descOf(id).has(to))) return;
  Object.assign(f, await store.folders.update(id, { parent_id: to || null })); drawFiles(); toast('폴더를 옮겼어요');
}
async function deleteFolder(id) {
  const f = folders.find((x) => x.id === id); if (!f) return;
  if (!confirm(`'${f.name}' 폴더를 삭제할까요? 안의 파일과 폴더는 상위로 옮겨져요.`)) return;
  try {
    for (const x of files.filter((x) => x.folder_id === id)) await update(x, { folder_id: f.parent_id || null }, true);
    for (const x of folders.filter((x) => x.parent_id === id)) Object.assign(x, await store.folders.update(x.id, { parent_id: f.parent_id || null }));
    await store.folders.remove(id); folders = folders.filter((x) => x.id !== id); drawFiles(); toast('폴더를 삭제했어요');
  } catch (e) { toast('삭제 실패: ' + e.message); }
}
async function mergeToFolder(targetId, movingIds) {
  try {
    const f = await store.folders.add({ name: '새 폴더', emoji: '📁', parent_id: FV.folder }); folders.push(f);
    for (const id of [targetId, ...movingIds]) { const r = files.find((x) => x.id === id); if (r) await update(r, { folder_id: f.id }, true); }
    drawFiles(); navigator.vibrate?.(30);
    const r = await askText({ title: '폴더가 만들어졌어요', label: '폴더 이름', value: '새 폴더', emojis: true, ok: '저장' });
    if (r) { Object.assign(f, await store.folders.update(f.id, { name: r.name, emoji: r.emoji })); drawFiles(); }
  } catch (e) { toast('폴더 만들기 실패: ' + e.message); }
}

// ── 파일 작업 ──
const idsFor = (id) => (FV.sel.size && FV.sel.has(id) ? [...FV.sel] : [id]);
async function moveFilesTo(ids, to) {
  let n = 0; for (const id of ids) { const r = files.find((x) => x.id === id); if (r && (r.folder_id || null) !== (to || null)) { await update(r, { folder_id: to || null }, true); n++; } }
  FV.sel.clear(); drawFiles(); if (n) toast(`${n}개를 ${to ? `'${folders.find((x) => x.id === to)?.name}' 폴더로` : '맨 위로'} 옮겼어요`);
}
async function copyFilesTo(ids, to) {
  let n = 0;
  for (const id of ids) {
    const r = files.find((x) => x.id === id); if (!r) continue;
    if (store.mode === 'cloud' && usedBytes() + (r.size || 0) > QUOTA) { toast('저장공간이 부족해서 복사하지 못했어요'); break; }
    const nm = r.name.replace(/(\.[^.]+)?$/, ' (사본)$1');
    try { const c = await store.files.copy(r, { folder_id: to || null, name: nm }); files.unshift(c); n++; } catch (e) { toast('복사 실패: ' + e.message); break; }
  }
  FV.sel.clear(); drawFiles(); if (n) toast(`${n}개를 복사했어요`);
}
async function trashFiles(ids) {
  const rows = ids.map((id) => files.find((x) => x.id === id)).filter(Boolean); if (!rows.length) return;
  const at = new Date().toISOString();
  for (const r of rows) await update(r, { deleted_at: at }, true);
  FV.sel.clear(); drawFiles();
  toast(`${rows.length}개를 휴지통으로 옮겼어요`, 7000, { label: '되돌리기', fn: () => restoreFiles(rows.map((r) => r.id)) });
}
async function restoreFiles(ids) {
  for (const id of ids) { const r = files.find((x) => x.id === id); if (r) await update(r, { deleted_at: null, ...(r.folder_id && !folders.some((f) => f.id === r.folder_id) ? { folder_id: null } : {}) }, true); }
  FV.sel.clear(); drawFiles(); toast(`${ids.length}개를 복원했어요`);
}
async function purgeFiles(ids, ask = true) {
  const rows = ids.map((id) => files.find((x) => x.id === id)).filter(Boolean); if (!rows.length) return;
  if (ask && !confirm(`${rows.length}개를 완전히 삭제할까요? 필기도 함께 지워지고 되돌릴 수 없어요.`)) return;
  for (const r of rows) { try { await store.files.remove(r); files = files.filter((x) => x.id !== r.id); } catch (e) { toast('삭제 실패: ' + e.message); } }
  FV.sel.clear(); drawFiles();
}
async function purgeOldTrash() {
  const old = files.filter((f) => f.deleted_at && Date.now() - new Date(f.deleted_at) > TRASH_DAYS * 864e5);
  if (!old.length) return;
  await purgeFiles(old.map((f) => f.id), false); toast(`휴지통에서 ${TRASH_DAYS}일이 지난 파일 ${old.length}개를 완전히 삭제했어요`, 4000);
}
async function pickCategory(ids) {
  const cats = [...new Set([...(S.cats || []), ...files.filter(alive).map((f) => f.category || '미분류')])];
  const act = await sheet('카테고리 선택', [...cats.map((c) => ({ id: 'c:' + c, icon: '🏷️', label: c })), { id: 'new', icon: '＋', label: '새 카테고리 만들기' }]);
  if (!act) return;
  let cat = act.startsWith('c:') ? act.slice(2) : await askText({ title: '새 카테고리', label: '이름', placeholder: '예: 문법' });
  if (!cat) return;
  if (!(S.cats || []).includes(cat)) { S.cats = [...(S.cats || []), cat]; saveS(); }
  for (const id of ids) { const r = files.find((x) => x.id === id); if (r) await update(r, { category: cat }, true); }
  FV.sel.clear(); drawFiles(); toast(`'${cat}'로 바꿨어요`);
}
async function catDialog() {
  const cats = [...new Set([...(S.cats || []), ...files.filter(alive).map((f) => f.category || '미분류')])].filter((c) => c !== '미분류');
  const act = await sheet('카테고리 관리', [...cats.flatMap((c) => [{ id: 'r:' + c, icon: '✏️', label: `'${c}' 이름 바꾸기` }, { id: 'd:' + c, icon: '🗑', label: `'${c}' 삭제 (파일은 미분류로)`, danger: true }]), { id: 'add', icon: '＋', label: '새 카테고리 추가' }]);
  if (!act) return;
  if (act === 'add') { const v = await askText({ title: '새 카테고리', label: '이름' }); if (v && !(S.cats || []).includes(v)) { S.cats = [...(S.cats || []), v]; saveS(); drawFiles(); } return; }
  const c = act.slice(2);
  if (act[0] === 'r') {
    const v = await askText({ title: '카테고리 이름 바꾸기', label: '이름', value: c }); if (!v || v === c) return;
    for (const f of files.filter((f) => f.category === c)) await update(f, { category: v }, true);
    S.cats = (S.cats || []).map((x) => (x === c ? v : x)); saveS(); if (filter.cat === c) filter.cat = v; drawFiles();
  } else {
    for (const f of files.filter((f) => f.category === c)) await update(f, { category: '미분류' }, true);
    S.cats = (S.cats || []).filter((x) => x !== c); saveS(); if (filter.cat === c) filter.cat = '전체'; drawFiles();
  }
}
async function fileMenu(row) {
  const trash = !!row.deleted_at;
  const items = trash
    ? [{ id: 'restore', icon: '♻️', label: '복원' }, { id: 'purge', icon: '🗑', label: '완전히 삭제', danger: true }]
    : [{ id: 'open', icon: '📂', label: '열기' }, { id: 'rename', icon: '✏️', label: '이름 바꾸기' }, { id: 'move', icon: '📦', label: '폴더로 이동' }, { id: 'copy', icon: '📄', label: '복사본 만들기' }, { id: 'cat', icon: '🏷️', label: '카테고리 바꾸기' }, { id: 'reclass', icon: '🤖', label: 'AI로 자동 분류' }, { id: 'trash', icon: '🗑', label: '휴지통으로 이동', danger: true }];
  const act = await sheet(dispName(row), items);
  const ids = idsFor(row.id);
  if (act === 'open') location.hash = `#/f/${row.id}`;
  if (act === 'rename') { const v = await askText({ title: '이름 바꾸기', label: '파일 이름', value: row.name, max: 80 }); if (v) update(row, { name: v }); }
  if (act === 'move') { const to = await pickFolder({ title: '이동할 폴더', current: row.folder_id || null }); if (to !== undefined) await moveFilesTo(ids, to); }
  if (act === 'copy') await copyFilesTo(ids, row.folder_id || null);
  if (act === 'cat') await pickCategory(ids);
  if (act === 'reclass') classify(row);
  if (act === 'trash') await trashFiles(ids);
  if (act === 'restore') await restoreFiles(ids);
  if (act === 'purge') await purgeFiles(ids);
}
async function selAction(a) {
  const ids = [...FV.sel];
  if (a === 'clear') { FV.sel.clear(); FV.selecting = false; return drawFiles(); }
  if (a === 'all') { $$('.tile.file').forEach((t) => FV.sel.add(t.dataset.id)); return updateSelUI(); }
  if (a === 'move') { const to = await pickFolder({ title: `${ids.length}개를 이동할 폴더` }); if (to !== undefined) await moveFilesTo(ids, to); }
  if (a === 'copy') { const to = await pickFolder({ title: `${ids.length}개를 복사할 폴더` }); if (to !== undefined) await copyFilesTo(ids, to); }
  if (a === 'cat') await pickCategory(ids);
  if (a === 'del') await trashFiles(ids);
  if (a === 'restore') await restoreFiles(ids);
  if (a === 'purge') await purgeFiles(ids);
}

// ── 클릭 ──
view.addEventListener('click', async (e) => {
  if (!$('#grid') || Date.now() - DND.justDragged < 450) return;
  const t = e.target;
  const tab = t.closest('[data-tab]'); if (tab) { FV.tab = tab.dataset.tab; lsSet('sd-tab', FV.tab); FV.sel.clear(); return drawFiles(); }
  const crumb = t.closest('.crumb'); if (crumb) { FV.folder = crumb.dataset.fid || null; FV.sel.clear(); return drawFiles(); }
  const chip = t.closest('.chip[data-c]'); if (chip) { filter.cat = chip.dataset.c; return drawFiles(); }
  if (t.closest('#addcat')) return catDialog();
  const tbb = t.closest('[data-tb]');
  if (tbb) { const ids = files.filter((f) => f.deleted_at).map((f) => f.id); return tbb.dataset.tb === 'empty' ? purgeFiles(ids) : restoreFiles(ids); }
  const sb = t.closest('[data-sb]'); if (sb) return selAction(sb.dataset.sb);
  const folder = t.closest('.tile.folder');
  if (folder) { if (t.closest('[data-act=fmenu]')) return folderMenu(folder.dataset.fid); FV.folder = folder.dataset.fid; FV.sel.clear(); return drawFiles(); }
  const card = t.closest('.tile.file'); if (!card) return;
  const row = files.find((f) => f.id === card.dataset.id); if (!row) return;
  if (t.closest('[data-act=menu]')) return fileMenu(row);
  if (t.closest('.chk')) { const on = !FV.sel.has(row.id); on ? FV.sel.add(row.id) : FV.sel.delete(row.id); return updateSelUI(); }
  if (FV.selecting || FV.sel.size) { FV.sel.has(row.id) ? FV.sel.delete(row.id) : FV.sel.add(row.id); return updateSelUI(); }
  if (row.deleted_at) return fileMenu(row);
  if (t.closest('[data-act=cat]')) return pickCategory([row.id]);
  location.hash = `#/f/${row.id}`;
});

// ── 드래그(마우스·터치 공통): 폴더로 이동 / 휴지통 / 1초 겹치면 폴더 만들기 ──
const DND = { on: false, ids: [], kind: '', ghost: null, tile: null, timer: 0, hoverT: 0, ready: false, hit: null, key: '', sx: 0, sy: 0, touch: false, justDragged: 0 };
function dndDown(e) {
  if (!$('#grid') || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const tile = e.target.closest('.tile'); if (!tile || tile.classList.contains('skel') || e.target.closest('.more,.chk')) return;
  if (FV.tab === 'trash' && !tile.classList.contains('folder')) return;
  DND.tile = tile; DND.sx = e.clientX; DND.sy = e.clientY; DND.touch = e.pointerType !== 'mouse';
  clearTimeout(DND.timer);
  if (DND.touch) DND.timer = setTimeout(() => dndStart(DND.sx, DND.sy), 380);
}
function dndMove(e) {
  if (!DND.tile) return;
  if (!DND.on) {
    const d = Math.hypot(e.clientX - DND.sx, e.clientY - DND.sy);
    if (DND.touch) { if (d > 12) { clearTimeout(DND.timer); DND.tile = null; } return; }
    if (d > 6) dndStart(e.clientX, e.clientY);
    return;
  }
  dndPos(e.clientX, e.clientY);
}
function dndStart(x, y) {
  const t = DND.tile; if (!t || DND.on) return;
  DND.on = true; DND.kind = t.classList.contains('folder') ? 'folder' : 'file';
  const id = t.dataset.id || t.dataset.fid;
  DND.ids = DND.kind === 'file' ? (FV.sel.has(id) ? [...FV.sel] : [id]) : [id];
  const g = t.cloneNode(true); g.classList.add('ghost'); g.style.width = t.offsetWidth + 'px'; g.querySelectorAll('.more,.chk').forEach((n) => n.remove());
  if (DND.ids.length > 1) g.insertAdjacentHTML('beforeend', `<span class="gcount">${DND.ids.length}</span>`);
  document.body.append(g); DND.ghost = g;
  const tz = document.createElement('div'); tz.className = 'trashzone'; tz.innerHTML = '<span>🗑</span><small>휴지통</small>'; document.body.append(tz);
  document.body.classList.add('dragging'); t.classList.add('dragsrc'); navigator.vibrate?.(15);
  dndPos(x, y);
}
function dndClear() { if (DND.hit?.el) DND.hit.el.classList.remove('drop-hover', 'merging', 'merge-ready'); $('.trashzone')?.classList.remove('hot'); $('[data-tab=trash]')?.classList.remove('drop-hover'); }
function dndPos(x, y) {
  const g = DND.ghost; if (!g) return;
  g.style.transform = `translate(${x - g.offsetWidth / 2}px, ${y - 36}px) rotate(-3deg) scale(.95)`;
  const el = document.elementFromPoint(x, y);
  const tz = el?.closest('.trashzone'), tabT = el?.closest('[data-tab=trash]'), crumb = el?.closest('.crumb'), ft = el?.closest('.tile.folder'), fl = el?.closest('.tile.file');
  let hit = null;
  if (tz || tabT) hit = { type: 'trash', el: tabT || null };
  else if (ft && !DND.ids.includes(ft.dataset.fid) && !(DND.kind === 'folder' && descOf(DND.ids[0]).has(ft.dataset.fid))) hit = { type: 'folder', id: ft.dataset.fid, el: ft };
  else if (crumb && !(DND.kind === 'folder' && descOf(DND.ids[0]).has(crumb.dataset.fid || ''))) hit = { type: 'folder', id: crumb.dataset.fid || null, el: crumb };
  else if (fl && DND.kind === 'file' && !DND.ids.includes(fl.dataset.id) && FV.tab !== 'trash') hit = { type: 'file', id: fl.dataset.id, el: fl };
  const key = hit ? `${hit.type}:${hit.id || ''}` : '';
  if (key === DND.key) return;
  dndClear(); clearTimeout(DND.hoverT); DND.ready = false; DND.key = key; DND.hit = hit;
  if (!hit) return;
  if (hit.type === 'trash') { $('.trashzone')?.classList.add('hot'); hit.el?.classList.add('drop-hover'); }
  else { hit.el.classList.add('drop-hover'); }
  if (hit.type === 'file') { hit.el.classList.add('merging'); DND.hoverT = setTimeout(() => { DND.ready = true; hit.el.classList.add('merge-ready'); navigator.vibrate?.(25); }, 1000); }
}
async function dndEnd(cancel) {
  clearTimeout(DND.timer); DND.tile = null;
  if (!DND.on) return;
  const { hit, ready, ids, kind } = DND;
  clearTimeout(DND.hoverT); dndClear();
  DND.ghost?.remove(); $('.trashzone')?.remove(); $('.dragsrc')?.classList.remove('dragsrc'); document.body.classList.remove('dragging');
  Object.assign(DND, { on: false, ghost: null, hit: null, key: '', ready: false, justDragged: Date.now() });
  if (cancel || !hit) return;
  if (hit.type === 'trash') { kind === 'file' ? await trashFiles(ids) : toast('폴더는 ⋯ 메뉴에서 삭제할 수 있어요'); }
  else if (hit.type === 'folder') { kind === 'file' ? await moveFilesTo(ids, hit.id) : await moveFolderTo(ids[0], hit.id); }
  else if (hit.type === 'file') { ready ? await mergeToFolder(hit.id, ids) : toast('1초 동안 겹쳐 두면 폴더가 만들어져요'); }
}

async function newMemoDialog() {
  const v = await askText({ title: '새 메모', label: '제목', placeholder: '예: 문법 정리', max: 60 }); if (!v) return;
  try {
    const nm = v.replace(/[\\/:*?"<>|]/g, '-') + '.md';
    let row = await store.files.add(new File([`# ${v}\n\n`], nm, { type: 'text/markdown' }), FV.folder ? { folder_id: FV.folder } : {});
    row = await store.files.update(row, { category: '메모', tags: ['메모'], summary: '직접 쓴 메모' });
    files.unshift(row); FV.tab = 'memo'; lsSet('sd-tab', 'memo'); location.hash = `#/f/${row.id}`;
  } catch (e) { toast('메모 만들기 실패: ' + e.message); }
}

async function update(row, patch, noDraw) {
  try { const n = await store.files.update(row, patch); files = files.map((f) => (f.id === n.id ? n : f)); if (!noDraw && $('#grid')) drawFiles(); return n; } catch (e) { toast('저장 실패: ' + e.message); }
}

async function classify(row) {
  classifying.add(row.id); if ($('#grid')) drawFiles();
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
    classifying.delete(row.id);
    await update(row, { category: r.category || '미분류', tags: [...keep, ...(r.tags || []).filter((x) => !RESERVED.has(x))].slice(0, 6), summary: r.summary || '' });
    toast(`분류 완료: ${r.category}`);
  } catch (e) {
    classifying.delete(row.id);
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
      const row = await store.files.add(f, FV.folder ? { folder_id: FV.folder } : {});
      files.unshift(row); const tb = tabOf(row); if (tb !== FV.tab) { FV.tab = tb; lsSet('sd-tab', tb); } if ($('#grid')) drawFiles(); t.close();
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
      let row = await store.files.add(new File([blob], `${title}.pdf`, { type: 'application/pdf' }), FV.folder ? { folder_id: FV.folder } : {});
      row = await store.files.update(row, { category: '노트', tags: ['노트', PAPERS[paper]], summary: `직접 만든 ${PAPERS[paper]}` });
      files.unshift(row); FV.tab = 'note'; lsSet('sd-tab', 'note'); t.close();
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
  if (row.deleted_at) { view.innerHTML = `<div class="empty"><div>🗑</div><h3>휴지통에 있는 파일이에요</h3><p class="muted">${TRASH_DAYS}일 안에는 복원할 수 있어요.</p><div class="row" style="justify-content:center"><button class="btn primary" id="rst">복원하기</button><a class="btn" href="#/files">목록으로</a></div></div>`; $('#rst').onclick = async () => { await restoreFiles([row.id]); location.hash = `#/f/${row.id}`; }; return; }
  view.innerHTML = '<div class="viewer"></div>';
  viewer = await mountViewer($('.viewer'), {
    store, row, page,
    onBack: () => (location.hash = '#/files'),
    onEvent: flag,
    onLive: (pl) => store.live?.(pl),
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
async function autoMistake({ file, page, capture }) {
  const img = await capture().catch(() => null);
  const base = file.name.replace(/\.(pdf|png|jpe?g|webp)$/i, '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
  const nth = mistakes.filter((x) => x.file_id === file.id && x.page === page).length + 1;
  try {
    const m = await store.mistakes.add({ file_id: file.id, file_name: file.name, page, label: `${base} · ${page}쪽 #${nth}`, reason: S.reasons[S.reasons.length - 1] || '기타', memo: '', stage: 0, next_review: today(S.intervals[0]), graduated: false });
    mistakes.unshift(m); badge(); bump(); hap(20);
    toast(`⭕ 오답노트에 자동 저장 · ${S.intervals[0]}일 뒤 복습`, 6000, { label: '이유 고르기', fn: () => editMistake(m.id) });
    explain(m, img, true);
  } catch (er) { toast('저장 실패: ' + er.message, 5000); }
}
function editMistake(id) {
  const m = mistakes.find((x) => x.id === id); if (!m) return;
  const d = $('#dlg'); d.className = '';
  d.innerHTML = `<form class="dlg-body"><h3>오답 정보 수정</h3>
    <label>이름<input name="label" value="${esc(m.label)}" required></label>
    <label>틀린 이유<select name="reason">${S.reasons.map((r) => `<option${r === m.reason ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
    <label>메모<textarea name="memo" rows="2">${esc(m.memo || '')}</textarea></label>
    <div class="row end"><button type="button" class="btn ghost" data-x>닫기</button><button class="btn primary">저장</button></div></form>`;
  d.showModal(); $('[data-x]', d).onclick = () => d.close();
  $('form', d).onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try { const n = await store.mistakes.update(id, { label: f.label.value.trim(), reason: f.reason.value, memo: f.memo.value.trim(), custom: true }); mistakes = mistakes.map((x) => (x.id === n.id ? n : x)); d.close(); if ($('#mlist')) drawMistakes(); toast('수정했어요'); } catch (er) { toast(er.message, 4000); }
  };
}
function mistakeDialog({ file, page, capture, crop, auto }) {
  if (auto) return autoMistake({ file, page, capture });
  const d = $('#dlg');
  d.innerHTML = `
    <form class="dlg-body">
      <h3>오답 등록</h3>
      <p class="muted">${esc(file.name)} · ${page}쪽</p>
      ${crop ? `<img class="crop" src="${crop}" alt="동그라미 친 문제">` : ''}
      <label>문제 번호/이름<input name="label" placeholder="예: Part5 #103" value="${crop ? `${page}쪽 동그라미 문제` : ''}" required></label>
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

async function explain(m, image, quiet) {
  const t = toast('🤖 AI 해설 생성 중… (10~20초)', 0);
  try {
    if (!image && m.file_id) {
      const row = files.find((f) => f.id === m.file_id);
      if (row) image = await pageImage(await store.files.blob(row), kind(row.name, row.mime), m.page || 1);
    }
    const r = await ai('explain', { label: m.label, reason: m.reason, memo: m.memo, image });
    const patch = { ai: r };
    const cur = mistakes.find((x) => x.id === m.id);
    if (quiet && cur && !cur.custom && r.translation) patch.label = `${cur.label.split(' #')[0]} · ${String(r.translation).replace(/\s+/g, ' ').slice(0, 24)}`;
    const n = await store.mistakes.update(m.id, patch);
    mistakes = mistakes.map((x) => (x.id === n.id ? n : x));
    const qk = queue.findIndex((x) => x.id === n.id); if (qk >= 0) queue[qk] = n;
    t.close(); toast('✅ AI 해설이 준비됐어요');
    if ($('#mlist')) drawMistakes();
    if ($('#rv')) {
      const keep = $('#recall')?.value, shown = $('#ans') && !$('#ans').hidden, cf = conf;
      drawReview();
      if (keep && $('#recall')) $('#recall').value = keep;
      if (shown && $('#ans')) { $('#ans').hidden = false; if ($('#reveal')) $('#reveal').hidden = true; unlockRates(); }
      if (cf) $$('.conf .chip').forEach((x) => x.classList.toggle('on', x.dataset.c === cf));
    }
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
let started = false;
const FACES = { again: '😵', hard: '😅', good: '🙂', easy: '😎' };
const reasonHue = (r) => [...String(r || '')].reduce((a, c) => a + c.charCodeAt(0) * 7, 0) % 360;
async function reviewView() {
  view.innerHTML = '<div id="rv" class="narrow"><div class="skel card" style="min-height:280px"><i></i><i></i><i></i></div></div>';
  try { mistakes = await store.mistakes.list(); if (!files.length) files = await store.files.list(); } catch (e) { view.innerHTML = `<p class="pad muted">${esc(e.message)}</p>`; return; }
  badge();
  queue = due(); qi = 0; done = {}; sessionLog = []; conf = null; revealed = false; started = false;
  drawReview();
}
function drawReview() {
  const rv = $('#rv'); if (!rv) return;
  const n = queue.length;
  const nxt = mistakes.filter((m) => !m.graduated).map((m) => m.next_review).sort()[0];
  if (!n) {
    rv.innerHTML = `<section class="rv-done"><div class="rv-trophy">🌿</div><h2>오늘 복습할 오답이 없어요</h2>
      <p class="muted">${nxt ? `다음 복습은 <b>${esc(nxt)}</b>에 있어요.` : '파일을 풀다가 틀린 문제를 오답 등록하면 여기로 모여요.'}</p>
      <div class="row" style="justify-content:center"><a class="btn" href="#/quiz">🎯 AI 맞춤 퀴즈</a><a class="btn primary" href="#/files">내 파일로</a></div></section>`;
    return;
  }
  if (!started) {
    const by = {}; queue.forEach((m) => { by[m.reason || '기타'] = (by[m.reason || '기타'] || 0) + 1; });
    rv.innerHTML = `<section class="rv-intro">
      <div class="rv-ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="bg"/><circle cx="60" cy="60" r="52" class="fg"/></svg><div><b data-count="${n}">0</b><span>장</span></div></div>
      <h2>오늘의 복습</h2>
      <p class="muted">약 ${Math.max(1, Math.round(n * 0.8))}분 · 🔥 ${streak()}일째 이어가는 중</p>
      <div class="rv-reasons">${Object.entries(by).map(([r, c]) => `<span style="--h:${reasonHue(r)}">${esc(r)} <b>${c}</b></span>`).join('')}</div>
      <button class="btn primary lg" id="rvstart">복습 시작 →</button>
      <small class="muted">정답을 먼저 떠올려 적은 뒤 확인하면 기억에 더 오래 남아요</small>
    </section>`;
    countUp($('[data-count]', rv), n);
    $('#rvstart').addEventListener('click', () => { started = true; drawReview(); });
    return;
  }
  if (qi >= n) {
    const tot = Object.values(done).reduce((a, b) => a + b, 0), mx = Math.max(1, ...Object.values(done));
    setTimeout(() => confetti(), 120);
    rv.innerHTML = `<section class="rv-done"><div class="rv-trophy">🎉</div><h2>오늘 복습 끝!</h2>
      <p class="muted">${tot}개 완료 · 🔥 ${streak()}일째</p>
      <div class="rv-bars">${RATINGS.map(([k, l, c]) => `<div class="${c}"><span>${FACES[k]} ${l}</span><i style="--w:${((done[k] || 0) / mx) * 100}%"></i><b>${done[k] || 0}</b></div>`).join('')}</div>
      ${insightHtml()}
      <p class="muted">${nxt ? `다음 복습은 <b>${esc(nxt)}</b>` : '모든 오답을 마스터했어요!'}</p>
      <div class="row" style="justify-content:center"><a class="btn" href="#/quiz">🎯 AI 맞춤 퀴즈</a><a class="btn primary" href="#/files">내 파일로</a></div></section>`;
    return;
  }
  const m = queue[qi], h = reasonHue(m.reason);
  rv.innerHTML = `
    <div class="rv-top"><button class="lnk" id="rvquit">← 나가기</button>
      <div class="rv-dots" aria-label="진행">${queue.map((_, i) => `<i class="${i < qi ? 'done' : i === qi ? 'cur' : ''}"></i>`).join('')}</div><small>${qi + 1}/${n}</small></div>
    <article class="card big rvcard" style="--rc:hsl(${h} 68% 52%)">
      <div class="rv-tag"><span class="rv-reason">${esc(m.reason || '기타')}</span><small>${(m.stage || 0) + 1}번째 복습</small></div>
      <h2 class="rv-title">${esc(m.label)}</h2>
      ${m.file_name ? `<p class="rv-src">📄 ${esc(m.file_name.replace(/\.(md|txt)$/i, ''))}${m.page ? ` · ${m.page}쪽` : ''}</p>` : ''}
      ${m.memo ? `<p class="rv-memo pre">${esc(m.memo)}</p>` : ''}
      <div class="rv-q">
        <p class="rv-hint">먼저 답을 떠올려 보세요</p>
        <div class="conf" role="group" aria-label="확신도"><small class="muted">내 확신도</small>${[['sure', '확실해요'], ['half', '반반이에요'], ['unsure', '모르겠어요']].map(([k, l]) => `<button class="chip" data-c="${k}">${l}</button>`).join('')}</div>
        <textarea id="recall" rows="3" placeholder="답이나 핵심을 적어 보세요 (선택)"></textarea>
        <div class="row"><button class="btn primary" id="reveal">정답 확인</button>${m.file_id ? `<a class="btn" href="#/f/${m.file_id}?p=${m.page || 1}">원본 열기</a>` : ''}${m.ai ? '' : '<button class="btn" id="mkai">🤖 AI 해설 받기</button>'}</div>
      </div>
      <div id="ans" hidden>${m.ai ? aiHtml(m.ai) : P(m.memo || '저장된 해설이 없어요. 원본에서 확인해 보세요.')}</div>
    </article>
    <p class="muted center" id="ratehint">정답을 확인한 뒤, 얼마나 잘 기억났는지 골라 주세요</p>
    <div class="rates rates4">${RATINGS.map(([k, label, cls], i) => { const p = plan(m, k); return `<button class="rate ${cls}" data-r="${k}" ${revealed ? '' : 'disabled'}><span class="face">${FACES[k]}</span><b>${label}</b><small>${p.graduated ? '마스터 🎓' : inDays(p.days)}</small><kbd>${i + 1}</kbd></button>`; }).join('')}</div>`;
  $('#rvquit').addEventListener('click', () => { location.hash = '#/files'; });
  $('#mkai')?.addEventListener('click', () => explain(m));
  $$('.conf .chip', rv).forEach((b) => b.addEventListener('click', () => { conf = b.dataset.c; $$('.conf .chip', rv).forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#reveal')?.addEventListener('click', async () => {
    const myQi = qi;
    const recall = $('#recall')?.value.trim();
    $('#ans').hidden = false; $('.rv-q')?.classList.add('revealed'); $('#reveal').hidden = true; unlockRates();
    const expected = m.ai?.answer || m.memo;
    if (!recall || !expected) return;
    const fb = document.createElement('p'); fb.className = 'samplenote'; fb.textContent = '🤖 내 답을 채점하는 중…'; $('#ans').prepend(fb);
    try {
      const r = await ai('grade', { label: m.label, expected: String(expected).slice(0, 600), answer: recall.slice(0, 400) });
      fb.textContent = `🤖 ${r.feedback || ''}`;
      if (qi !== myQi) return;
      const btn = RATINGS.some((x) => x[0] === r.suggest) ? $(`[data-r=${r.suggest}]`) : null; if (btn) { btn.classList.add('suggest'); $('small', btn).textContent += ' · 추천'; }
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
let rating = false, conf = null, sessionLog = [], revealed = false;
function unlockRates() { revealed = true; $$('.rate').forEach((b) => { b.disabled = false; }); $('#ratehint')?.remove(); }
async function rate(r) {
  const m = queue[qi]; if (!m || rating) return;
  if (!revealed) return toast('먼저 [정답 확인]을 눌러 주세요');
  rating = true;
  $('.card.big')?.classList.add('leave');
  await new Promise((res) => setTimeout(res, 170));
  const p = plan(m, r);
  const entry = { d: today(), r, s: m.stage || 0, c: conf || null };
  const hh = [...(m.hist || []), entry].slice(-30);
  const patch = p.graduated ? { graduated: true, stage: p.stage, last_result: r, hist: hh } : { stage: p.stage, next_review: p.next_review, last_result: r, hist: hh };
  try { const n = await store.mistakes.update(m.id, patch); mistakes = mistakes.map((x) => (x.id === n.id ? n : x)); queue[qi] = n; } catch (e) { rating = false; return toast('저장 실패: ' + e.message); }
  sessionLog.push({ r, c: conf }); conf = null;
  hap(r === 'again' ? [10, 40, 10] : 18); done[r] = (done[r] || 0) + 1; qi++; bump(); badge(); rating = false; revealed = false; drawReview();
}
addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('tile') && !e.target.classList.contains('skel')) { e.preventDefault(); e.target.click(); return; }
  if (e.target.closest?.('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const go = { g: '#/files', r: '#/review', m: '#/mistakes', e: '#/explore' }[e.key];
  if (go && nav?.childElementCount && !$('#rv .rvcard')) { location.hash = go; return; }
  if (e.key === '/' && $('#q')) { e.preventDefault(); $('#q').focus(); return; }
  if (e.key === '?') { const d = $('#dlg'); d.className = ''; d.innerHTML = `<form class="dlg-body"><h3>⌨️ 단축키</h3><div class="keys"><kbd>G</kbd>내 파일<kbd>R</kbd>오늘 복습<kbd>M</kbd>오답노트<kbd>E</kbd>둘러보기<kbd>/</kbd>검색<kbd>1~4</kbd>복습 평가<kbd>?</kbd>이 도움말</div><div class="row end"><button class="btn primary" data-x>닫기</button></div></form>`; d.showModal(); $('[data-x]', d).onclick = (ev) => { ev.preventDefault(); d.close(); }; }
});
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
  qs = qs.filter((q) => Array.isArray(q.choices) && q.choices.length >= 2).map((q) => ({ ...q, answer: letterOf(q.answer) })).filter((q) => q.answer);
  qs = qs.map(shuffleQ);
  if (!qs.length) return void ($('#qz').innerHTML = '<div class="empty"><div>⚠️</div><p>퀴즈를 만들지 못했어요. 잠시 후 다시 시도해 주세요.</p><a class="btn" href="#/mistakes">돌아가기</a></div>');
  let i = 0, score = 0;
  const draw = () => {
    const box = $('#qz'); if (!box) return;
    if (i >= qs.length) { if (score >= qs.length * 0.8) setTimeout(() => confetti(), 120); bump(); flag('quiz'); (S.quizLog ||= []).push({ d: today(), score, n: qs.length }); S.quizLog = S.quizLog.slice(-20); saveS(); box.innerHTML = `<div class="empty"><div>${score >= qs.length * 0.8 ? '🏆' : '💪'}</div><h2>${score} / ${qs.length} 정답</h2><p class="muted">틀린 문제는 자동으로 오답노트에 담겼어요. 복습 일정에 들어가요.</p><div class="row" style="justify-content:center"><button class="btn" id="again">새 문제로 다시</button><a class="btn primary" href="#/mistakes">오답노트로</a></div></div>`; $('#again').onclick = quizView; return; }
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

function letterOf(a) {
  const t = String(a || '').trim().toUpperCase();
  return (t.match(/^\(?([A-D])\)?$/) || t.match(/\b([A-D])\b/) || [0, ''])[1];
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
    const letter = letterOf(x.answer);
    if (!letter || !Array.isArray(x.choices) || x.choices.length < 2) continue;
    out.push({ question: x.question, choices: x.choices.map((c) => String(c).replace(/^\([A-D]\)\s*|^[A-D][.)]\s+/, '')), answer: letter, explanation: x.explanation || '', target: m.label });
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
  const st = steps(), pf = profileOf(curUser || {});
  const hasSample = files.some((f) => (f.tags || []).includes('예시')) || mistakes.some((m) => m.label?.startsWith('[예시]'));
  view.innerHTML = `
    <section class="hero soft">
      <small class="hello">${esc(pf.emoji)} 안녕하세요, ${esc(pf.name)}님</small>
      <h1>오늘은 어떤 공부를 해 볼까요?</h1>
      <div class="steps">${STEP_LABEL.map((l, i) => `<div class="step ${st[i] ? 'ok' : ''}"><i>${st[i] ? '✓' : i + 1}</i><span>${l}</span></div>`).join('')}</div>
    </section>

    ${heatmap()}
    ${store.mode === 'cloud' ? `
    <section class="card syncdemo">
      <div class="sd-copy">
        <h3>${ico('link', 20)} 기기 간 동기화 — 직접 확인해 보세요</h3>
        <p>한쪽에서 필기하거나 오답을 등록하면 <b>다른 기기에 새로고침 없이 바로</b> 나타나요. 같은 파일을 두 기기에서 열고 함께 써 보세요.</p>
        <div class="row"><button class="btn primary" id="linkbtn">📲 QR로 다른 기기 연결하기</button><span class="devs" id="devlist">${devList()}</span></div>
      </div>
      <svg class="sd-art" viewBox="0 0 300 150" aria-hidden="true"><use href="#syncart"/></svg>
    </section>` : ''}

    <h3 class="sec">한 번에 시작하기</h3>
    <div class="tpls">${TEMPLATES.map((t, i) => `
      <article class="card tpl t${i} ${S.tpl === t.id ? 'active' : ''}">
        <div class="te">${t.emoji}</div>
        <h3>${esc(t.title)}</h3>
        <p class="muted">${esc(t.short)}</p>
        <button class="btn ${S.tpl === t.id ? '' : 'primary'}" data-tpl="${t.id}">${S.tpl === t.id ? '적용됨 ✓' : '이 템플릿으로 시작'}</button>
      </article>`).join('')}
    </div>
    ${hasSample ? '<div class="row" style="margin-top:10px"><button class="btn ghost sm" id="rmsample">🧹 예시 데이터 지우기</button></div>' : ''}

    <h3 class="sec">이렇게 써요</h3>
    <div class="scen">${SCENARIOS.map((s) => `<a class="card sc" href="${s.href}"><span class="te">${s.emoji}</span><div><b>${esc(s.title)}</b><p class="muted">${esc(s.body)}</p></div></a>`).join('')}</div>
    <p class="muted center tip">시험일·목표 점수·복습 주기는 왼쪽 위 <b>프로필</b>에서 바꿀 수 있어요.</p>`;
  $$('[data-tpl]').forEach((b) => (b.onclick = () => applyTemplate(TEMPLATES.find((t) => t.id === b.dataset.tpl))));
  $('#rmsample')?.addEventListener('click', removeSamples);
  $('#linkbtn')?.addEventListener('click', openLinkDialog);
}

async function applyTemplate(t) {
  $$('[data-tpl]').forEach((b) => { b.disabled = true; });
  const tk = toast(`${t.emoji} "${t.title}" 세팅을 만드는 중…`, 0);
  try {
    S.intervals = PRESETS[t.preset].intervals; S.reasons = t.reasons; S.cats = [...new Set([...(S.cats || []), ...t.cats])]; S.tpl = t.id;
    files = await store.files.list(); mistakes = await store.mistakes.list();
    const rows = [];
    for (const n of t.notes) {
      let row = files.find((f) => f.name === n.name && !f.deleted_at);
      if (!row) {
        let file;
        if (n.sample === 'colreg') file = new File([await makeSamplePdf('COLREG Practice (original sample)', ['1. Rule 14: Two power-driven vessels meet head-on with risk of collision.', '   Each vessel shall alter course to ______.', '   (A) port   (B) starboard   (C) stop engines   (D) sound five blasts', '', '2. Rule 15: Vessel A sees vessel B on her starboard side crossing. The give-way vessel is ______.', '   (A) A   (B) B   (C) both   (D) the larger vessel', '', '3. The masthead light shows an unbroken light over an arc of ______ degrees.', '   (A) 112.5   (B) 135   (C) 225   (D) 360', '', '4. Rule 5 requires every vessel to maintain a proper ______ at all times.', '   (A) speed log   (B) look-out   (C) anchor watch   (D) radio watch', '', '5. A sternlight shows an arc of ______ degrees.', '   (A) 112.5   (B) 135   (C) 225   (D) 360', '', 'Answers: 1 B / 2 A / 3 C / 4 B / 5 B'])], n.name, { type: 'application/pdf' });
        else if (n.sample === 'toeic5') file = new File([await makeSamplePdf('TOEIC Part 5 Practice (original sample)', ['1. The manager asked all employees to ______ the report before Friday.', '   (A) submit   (B) submitting   (C) submission   (D) submitted', '', '2. The company will ______ a new energy-saving policy next month.', '   (A) implement   (B) appoint   (C) attend   (D) reserve', '', '3. Ms. Park was ______ for her outstanding contribution to the project.', '   (A) recognize   (B) recognized   (C) recognition   (D) recognizing', '', '4. Please keep your receipt ______ you need to return the item.', '   (A) in case   (B) because of   (C) as well as   (D) whereas', '', '5. The new software is ______ faster than the previous version.', '   (A) significant   (B) significantly   (C) signify   (D) significance', '', 'Answers: 1 A / 2 A / 3 B / 4 A / 5 B'])], n.name, { type: 'application/pdf' });
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
      const mk = await store.mistakes.add({ file_id: m.note == null ? null : rows[m.note].id, file_name: m.note == null ? '예시 문제' : rows[m.note].name, page: 1, label: m.label, reason: m.reason, memo: m.memo, stage: 0, next_review: today(), graduated: false, ai: { ...m.ai, sample: true } });
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

$('#sync')?.addEventListener('click', openLinkDialog);
$('#mprofile')?.addEventListener('click', () => openProfile());
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
route();
