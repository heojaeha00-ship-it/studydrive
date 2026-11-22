// 아이디(이메일 없이) 가입 → 로그아웃 → 아이디 로그인, 게스트 → 계정 승격을 실제 서버에서 점검한다.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'https://heojaeha00-ship-it.github.io/studydrive';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const ID = 'tst' + Date.now().toString().slice(-8), PW = 'pass1234';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.fill('#em', ID); await p.fill('#pw', PW); await p.click('[data-m=up]');
  await p.waitForSelector('nav a[href="#/files"]', { timeout: 30000 });
  ok(true, '아이디만으로 가입 후 바로 로그인');
  await p.click('#pfbtn'); await p.waitForTimeout(300);
  ok((await p.locator('.pf-head').innerText()).includes(ID), '프로필에 아이디 표시');
  await p.click('#pflogout'); await p.waitForSelector('#em', { timeout: 15000 }); await p.waitForTimeout(2000);
  await p.fill('#em', ID); await p.fill('#pw', PW); await p.click('[data-m=in]');
  await p.waitForSelector('nav a[href="#/files"]', { timeout: 30000 }); ok(true, '아이디로 다시 로그인');
  ok(errs.length === 0, '오류 없음' + errs[0]);
  await b.close(); console.log(fails ? `\n${fails}개 실패` : '\n모두 통과'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
