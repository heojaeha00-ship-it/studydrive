// 로컬 모드(Supabase 설정 없음) 기준 end-to-end 점검.
// 사용: (config.js 를 비워 둔 복사본을 서버로 띄운 뒤)  BASE=http://localhost:8765 node tests/e2e.js
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/'); await p.waitForSelector('.hero');
  ok(p.url().endsWith('#/explore'), '첫 방문은 둘러보기로 이동');

  await p.click('[data-tpl=toeic]'); await p.waitForSelector('#rvstart'); await p.click('#rvstart'); await p.waitForSelector('#rv .big');
  ok((await p.locator('.rate').count()) === 4, '복습 카드에 4단계 평가 버튼');
  await p.click('.conf .chip >> nth=0'); await p.click('#reveal');
  ok(await p.locator('#ans').isVisible(), '정답 확인 시 해설 표시');
  await p.click('[data-r=good]'); await p.waitForTimeout(400);

  await p.goto(BASE + '/#/files'); await p.reload(); await p.waitForSelector('.file');
  ok((await p.locator('.file:has-text("Part5")').count()) === 1, '템플릿이 실제 PDF 샘플을 만듦');
  await p.click('.file:has-text("Part5") h3'); await p.waitForSelector('.vpage canvas.base'); await p.waitForTimeout(900);
  const dark = await p.evaluate(() => { const c = document.querySelector('.vpage canvas.base'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 200) if (d[i] < 200) n++; return n; });
  ok(dark > 50, 'PDF 렌더링');
  await p.click('[data-tool=hl]'); const bx = await p.locator('.vpage').first().boundingBox();
  await p.mouse.move(bx.x + 60, bx.y + 150); await p.mouse.down(); await p.mouse.move(bx.x + 300, bx.y + 150, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(900);
  await p.reload(); await p.waitForSelector('.vpage canvas.base'); await p.waitForTimeout(1200);
  const ink = await p.evaluate(() => { const c = document.querySelector('.vpage .ov'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  ok(ink > 0, '필기가 새로고침 후에도 유지');

  await p.goto(BASE + '/#/files'); await p.waitForSelector('#newnote'); await p.click('#newnote');
  ok((await p.locator('input[name=pages]').count()) === 0, '새 노트에 쪽수 입력 없음');
  await p.selectOption('select[name=paper]', 'lined'); await p.click('dialog .btn.primary'); await p.waitForSelector('.vpage canvas.base');
  const n0 = await p.locator('.vpage').count();
  await p.evaluate(() => { const s = document.querySelector('.vscroll'); s.scrollTop = s.scrollHeight; }); await p.waitForTimeout(1500);
  ok((await p.locator('.vpage').count()) === n0 + 1, '맨 아래로 내리면 새 페이지 자동 추가');

  await p.goto(BASE + '/#/mistakes'); await p.reload(); await p.waitForSelector('#mlist .m');
  const m0 = await p.locator('#mlist .m').count(); ok(m0 === 3, '예시 오답 3개');
  await p.goto(BASE + '/#/quiz'); await p.waitForSelector('.choice', { timeout: 15000 });
  let wrongDone = false;
  for (let i = 0; i < 5 && (await p.locator('.choice').count()); i++) {
    const right = await p.evaluate(() => null);
    await p.locator('.choice').first().click(); await p.waitForSelector('#nx'); if (await p.locator('.choice.wrong').count()) wrongDone = true; await p.click('#nx'); await p.waitForTimeout(150);
  }
  await p.goto(BASE + '/#/mistakes'); await p.reload(); await p.waitForSelector('#mlist .m');
  const m1 = await p.locator('#mlist .m').count();
  ok(!wrongDone || m1 > m0, '퀴즈에서 틀린 문제가 오답노트에 자동 등록');
  ok(errs.length === 0, '자바스크립트 오류 없음' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); console.log(fails ? `\n${fails}개 실패` : '\n모두 통과'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
