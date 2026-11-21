// 두 기기(PC + 폰)를 같은 계정으로 동시에 접속해 "실시간 동기화"를 실제로 측정한다.
// 사용: BASE=https://heojaeha00-ship-it.github.io/studydrive node tests/sync.js
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'https://heojaeha00-ship-it.github.io/studydrive';
const EMAIL = process.env.EMAIL || 'demo@studydrive.app', PW = process.env.PW || 'Study2026!';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const NAME = '동기화 시험 ' + Date.now().toString().slice(-5);

async function login(ctx) {
  const p = await ctx.newPage(); p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto(BASE + '/', { waitUntil: 'networkidle' });
  await p.fill('#em', EMAIL); await p.fill('#pw', PW); await p.click('[data-m=in]');
  await p.waitForSelector('nav a[href="#/files"]', { timeout: 30000 });
  return p;
}
const ink = (p, sel = '.vpage .ov') => p.evaluate((s) => { const c = document.querySelector(s); if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; }, sel);

(async () => {
  const b = await chromium.launch();
  const pc = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const ph = await b.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
  const A = await login(pc); const B = await login(ph);
  await A.goto(BASE + '/#/files'); await B.goto(BASE + '/#/files');
  await A.waitForSelector('#newnote'); await B.waitForSelector('#grid'); await B.click('[data-tab=note]');

  // 1) 연결된 기기 표시(접속 상태 공유)
  await A.waitForFunction(() => /기기 2대/.test(document.querySelector('#sync')?.textContent || ''), null, { timeout: 25000 }).catch(() => {});
  const chip = await A.locator('#sync').innerText();
  ok(/기기 2대/.test(chip), '연결된 기기 실시간 표시(PC 화면): ' + chip.replace(/\n/g, ' '));

  // 2) 파일 생성 → 다른 기기 목록에 새로고침 없이 나타남
  const t0 = Date.now();
  await A.waitForTimeout(2500); await A.click('#newnote'); await A.fill('input[name=title]', NAME); await A.click('dialog .btn.primary');
  await A.waitForSelector('.vpage canvas.base', { timeout: 30000 });
  await B.waitForSelector(`.tile.file:has-text("${NAME}")`, { timeout: 20000 }).catch(() => {});
  const seen = await B.locator(`.tile.file:has-text("${NAME}")`).count();
  ok(seen === 1, `PC에서 만든 노트가 폰 목록에 새로고침 없이 나타남 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);

  // 3) 폰에서 같은 노트를 열고, PC에서 필기 → 폰에 실시간 표시
  await B.click(`.tile.file:has-text("${NAME}") .ticon`); await B.waitForSelector('.vpage canvas.base', { timeout: 30000 }); await B.waitForTimeout(800);
  await A.waitForTimeout(800); await A.click('[data-tool=pen]');
  const bx = await A.locator('.vpage').first().boundingBox();
  const before = await ink(B);
  const t1 = Date.now();
  await A.mouse.move(bx.x + 120, bx.y + 160); await A.mouse.down(); await A.mouse.move(bx.x + 420, bx.y + 240, { steps: 14 }); await A.mouse.up();
  let lat = null;
  for (let i = 0; i < 120; i++) { if ((await ink(B)) > before) { lat = (Date.now() - t1) / 1000; break; } await B.waitForTimeout(100); }
  ok(lat !== null, `PC의 필기가 폰 화면에 실시간 반영됨 (${lat === null ? '실패' : lat.toFixed(1) + '초'})`);
  await B.screenshot({ path: '/tmp/sync-phone.png' }).catch(() => {});
  // 3-2) 동시 공동 편집: 폰도 같은 쪽에 필기 → PC에 나타나고, 서로의 획이 사라지지 않음
  const inkA0 = await ink(A), inkB0 = await ink(B);
  const pb = await B.locator('.vpage').first().boundingBox();
  await B.touchscreen.tap(pb.x + 40, pb.y + 40).catch(() => {});
  await B.click('[data-tool=pen]').catch(() => {});
  const tB = Date.now();
  await Promise.all([
    (async () => { await A.mouse.move(bx.x + 100, bx.y + 330); await A.mouse.down(); await A.mouse.move(bx.x + 300, bx.y + 380, { steps: 10 }); await A.mouse.up(); })(),
    (async () => { await B.mouse.move(pb.x + 40, pb.y + 120); await B.mouse.down(); await B.mouse.move(pb.x + 250, pb.y + 170, { steps: 10 }); await B.mouse.up(); })(),
  ]);
  await A.waitForTimeout(2500);
  const inkA1 = await ink(A), inkB1 = await ink(B);
  ok(inkA1 > inkA0 && inkB1 > inkB0, `두 기기가 동시에 필기해도 양쪽 화면에 모두 반영 (PC ${inkA0}→${inkA1}, 폰 ${inkB0}→${inkB1}, ${((Date.now() - tB) / 1000).toFixed(1)}초)`);
  await A.reload(); await A.waitForSelector('.vpage canvas.base'); await A.waitForTimeout(2500);
  ok((await ink(A)) >= inkA1 * 0.9, '새로고침해도 두 기기의 필기가 모두 남아 있음');

  // 4) 폰에서 오답 등록 → PC 쪽 오답 개수 배지 갱신(새로고침 없이)
  await A.goto(BASE + '/#/mistakes'); await A.waitForSelector('#mlist', { state: 'attached', timeout: 20000 });
  const n0 = await A.locator('#mlist .m').count();
  await B.click('[data-a=mistake]'); await B.fill('input[name=label]', '동기화 시험 오답'); await B.uncheck('input[name=ai]'); await B.click('dialog .btn.primary');
  const t2 = Date.now();
  await A.waitForFunction((n) => document.querySelectorAll('#mlist .m').length > n, n0, { timeout: 20000 }).catch(() => {});
  ok((await A.locator('#mlist .m').count()) === n0 + 1, `폰에서 등록한 오답이 PC 오답노트에 새로고침 없이 나타남 (${((Date.now() - t2) / 1000).toFixed(1)}초)`);

  // 정리: 시험 데이터 삭제
  await A.goto(BASE + '/#/mistakes'); await A.waitForSelector('#mlist', { state: 'attached' });
  A.on('dialog', (d) => d.accept());
  const mm = A.locator('#mlist .m:has-text("동기화 시험 오답") [data-act=del]'); if (await mm.count()) await mm.first().click();
  await A.goto(BASE + '/#/files'); await A.waitForSelector('#grid');
  // 노트는 휴지통으로 보낸 뒤 완전 삭제
  await A.click('[data-tab=note]'); await A.waitForTimeout(300);
  const tile = A.locator(`.tile.file:has-text("${NAME}")`);
  if (await tile.count()) { await tile.first().locator('[data-act=menu]').click({ force: true }); await A.click('.sheet-i[data-do=trash]'); await A.waitForTimeout(500);
    await A.click('[data-tab=trash]'); await A.waitForTimeout(400); await A.click(`.tile.file:has-text("${NAME}")`); await A.click('.sheet-i[data-do=purge]'); await A.waitForTimeout(800); }
  await b.close(); console.log(fails ? `\n${fails}개 실패` : '\n모두 통과'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
