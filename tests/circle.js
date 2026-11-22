// 해기사 템플릿 + "X(빗금) 표시로 오답 자동 등록"을 로컬 모드에서 점검한다.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/'); if (process.env.LIVE) { await p.waitForSelector('#demo', { timeout: 30000 }); await p.click('#demo'); } await p.waitForSelector('.hero', { timeout: 30000 });
  ok(await p.locator('[data-tpl=sea]').count() === 1, '해기사 템플릿이 둘러보기에 있음');
  await p.click('[data-tpl=sea]'); await p.waitForTimeout(process.env.LIVE ? 9000 : 2000);
  await p.goto(BASE + '/#/files'); await p.reload(); await p.waitForSelector('.tile.file');
  await p.click('.tile.file:has-text("COLREG")'); await p.waitForSelector('.vpage canvas.base'); await p.waitForTimeout(1500);
  await p.click('[data-tool=wrong]');
  const r = await p.locator('.vpage').first().boundingBox();
  const x0 = r.x + r.width * 0.15, y0 = r.y + r.height * 0.15;
  // X 표시: 두 획(대각선 2개)
  await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x0 + 50, y0 + 50, { steps: 8 }); await p.mouse.up();
  await p.mouse.move(x0 + 50, y0); await p.mouse.down(); await p.mouse.move(x0, y0 + 50, { steps: 8 }); await p.mouse.up();
  await p.waitForSelector('.toast', { timeout: 5000 }).catch(() => {});
  ok(/오답노트에 자동 저장/.test(await p.locator('#toasts').innerText().catch(() => '')) && (await p.locator('dialog[open]').count()) === 0, 'X 표시만 하면 창 없이 오답노트에 자동 저장');
  await p.waitForTimeout(700);
  await p.screenshot({ path: '/tmp/c-dialog.png' });
  await p.goto(BASE + '/#/mistakes'); await p.waitForSelector('#mlist', { state: 'attached' });
  console.log((await p.locator('#mlist').innerText()).slice(0, 300));
  ok((await p.locator('#mlist .m').count()) === 4, '오답노트에 1개 추가(예시 3 + 새 1, X 두 획 중복 없음): ' + (await p.locator('#mlist .m').count()));
  ok(errs.length === 0, '자바스크립트 오류 없음' + (errs[0] || ''));
  await b.close(); console.log(fails ? `\n${fails}개 실패` : '\n모두 통과'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
