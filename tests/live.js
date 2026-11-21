// 배포된 실제 사이트(Supabase 연결)를 게스트로 점검한다.
// 사용: BASE=https://heojaeha00-ship-it.github.io/studydrive node tests/live.js
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'https://heojaeha00-ship-it.github.io/studydrive';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.waitForSelector('#demo', { timeout: 20000 });
  ok(true, '로그인 화면 + 게스트 버튼');
  await p.click('#demo'); await p.waitForSelector('.hero', { timeout: 30000 });
  ok(await p.locator('#pfbtn').innerText().then((t) => t.includes('게스트')), '가입 없이 게스트 로그인');

  await p.click('[data-tpl=toeic]'); await p.waitForSelector('#rvstart', { timeout: 60000 }); await p.click('#rvstart'); await p.waitForSelector('#rv .big');
  ok(true, '템플릿 원클릭 → 서버에 파일·오답 생성 → 복습 카드');

  // 정답 확인 → AI 채점
  await p.fill('#recall', 'to 뒤에는 동사원형이라서 submit'); await p.click('#reveal');
  await p.waitForFunction(() => document.querySelector('#ans')?.textContent.includes('🤖') && !document.querySelector('#ans').textContent.includes('채점하는 중'), null, { timeout: 40000 }).catch(() => {});
  const gradeText = await p.locator('#ans').innerText();
  ok(/🤖/.test(gradeText) && !/채점하는 중/.test(gradeText), 'AI 채점 응답: ' + gradeText.split('\n').find((l) => l.includes('🤖'))?.slice(0, 60));
  await p.click('[data-r=good]'); await p.waitForTimeout(800);

  // 새로고침해도 서버에서 데이터가 오는지(동기화)
  await p.goto(BASE + '/#/files'); await p.reload({ waitUntil: 'networkidle' }); await p.waitForSelector('.tile.file', { timeout: 30000 });
  const nd = await p.locator('.tile.file').count(); await p.click('[data-tab=memo]'); await p.waitForTimeout(400);
  ok(nd >= 1 && (await p.locator('.tile.file').count()) >= 2, `새로고침 후에도 서버의 자료 ${nd}개·메모 ${await p.locator('.tile.file').count()}개 표시`); await p.click('[data-tab=doc]');

  // PDF 열기 + AI 질문
  await p.click('.file:has-text("TOEIC") h3'); await p.waitForSelector('.vpage canvas.base', { timeout: 30000 }); await p.waitForTimeout(1200);
  ok(true, '서버 저장소의 PDF 열람');
  await p.click('[data-a=ask]'); await p.click('[data-q="이 쪽 요약"]');
  await p.waitForFunction(() => { const m = document.querySelector('.msg.a'); return m && !m.textContent.includes('생각 중'); }, null, { timeout: 60000 }).catch(() => {});
  const ans = await p.locator('.msg.a').first().innerText();
  ok(!ans.includes('⚠️') && !ans.includes('생각 중'), 'AI 질문 응답: ' + ans.slice(0, 60).replace(/\n/g, ' '));

  ok(errs.length === 0, '자바스크립트 오류 없음' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); console.log(fails ? `\n${fails}개 실패` : '\n모두 통과'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
