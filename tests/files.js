// 파일 정리(폴더·드래그·휴지통·메모 분리)를 로컬 모드에서 점검한다.
// 사용: (config.js 를 비운 복사본을 서버로 띄운 뒤)  BASE=http://localhost:8765 node tests/files.js
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8765';
const OUT = process.env.OUT || '/tmp/';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

async function drag(p, from, to, hold = 0) {
  const a = await from.boundingBox(), b = await to.boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down();
  await p.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 3 });
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  if (hold) await p.waitForTimeout(hold);
  await p.mouse.up(); await p.waitForTimeout(500);
}
async function newNote(p, name) {
  await p.click('#newnote'); await p.fill('input[name=title]', name); await p.click('dialog .btn.primary');
  await p.waitForSelector('.vpage canvas.base'); await p.click('[data-a=back]'); await p.waitForSelector('#grid');
  await p.click('[data-tab=note]'); await p.waitForTimeout(300);
}

(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/'); await p.waitForSelector('.hero');
  await p.click('[data-tpl=toeic]'); await p.waitForTimeout(1500);
  await p.goto(BASE + '/#/files'); await p.reload(); await p.waitForSelector('#grid .tile.file');

  // 1) 메모(.md)는 따로 보관
  const docNames = await p.locator('.tile.file .tname').allInnerTexts();
  ok(docNames.every((n) => !/체크리스트|학습 계획/.test(n)), '자료 탭에는 .md 메모가 보이지 않음');
  await p.click('[data-tab=memo]'); await p.waitForTimeout(300);
  ok((await p.locator('.tile.file').count()) >= 2, '메모 탭에 .md 메모가 따로 모임 (' + (await p.locator('.tile.file').count()) + '개)');
  await p.click('[data-tab=note]');

  // 2) 노트 3개 + 폴더 만들기
  await newNote(p, '노트A'); await newNote(p, '노트B'); await newNote(p, '노트C');
  ok((await p.locator('.tile.file').count()) === 3, '노트 3개 생성');
  await p.click('#newfolder'); await p.fill('dialog input[name=v]', '정리함'); await p.click('dialog .btn.primary'); await p.waitForTimeout(400);
  ok((await p.locator('.tile.folder .tname', { hasText: '정리함' }).count()) === 1, '폴더 만들기');
  await p.screenshot({ path: OUT + 'f1-icons.png' });

  // 3) 끌어서 폴더로 이동
  await drag(p, p.locator('.tile.file:has-text("노트A")'), p.locator('.tile.folder:has-text("정리함")'));
  ok((await p.locator('.tile.file:has-text("노트A")').count()) === 0, '노트A를 폴더 위로 끌어다 놓으면 이동됨');
  ok(/1개 항목/.test(await p.locator('.tile.folder:has-text("정리함")').innerText()), '폴더에 1개 항목 표시');

  // 4) 폴더 안으로 들어가기 / 이동 경로
  await p.click('.tile.folder:has-text("정리함") .ticon'); await p.waitForTimeout(300);
  ok((await p.locator('.tile.file:has-text("노트A")').count()) === 1 && (await p.locator('.crumb').count()) === 2, '폴더 안에서 노트A가 보이고 경로(빵부스러기) 표시');
  await p.click('.crumb[data-fid=""]'); await p.waitForTimeout(300);

  // 5) 파일을 다른 파일 위에 1초 이상 겹치면 폴더 생성
  const nf0 = await p.locator('.tile.folder').count();
  await drag(p, p.locator('.tile.file:has-text("노트C")'), p.locator('.tile.file:has-text("노트B")'), 1300);
  await p.waitForSelector('dialog[open] input[name=v]', { timeout: 5000 }).catch(() => {});
  await p.fill('dialog input[name=v]', '합친 폴더').catch(() => {}); await p.click('dialog .btn.primary').catch(() => {}); await p.waitForTimeout(500);
  ok((await p.locator('.tile.folder').count()) === nf0 + 1 && (await p.locator('.tile.folder:has-text("합친 폴더")').count()) === 1, '1초 겹쳐 두면 폴더가 만들어짐(홈 화면 방식)');
  ok(/2개 항목/.test(await p.locator('.tile.folder:has-text("합친 폴더")').innerText()), '만들어진 폴더에 2개 항목');

  // 6) 휴지통: 끌어서 삭제 → 복원
  await p.click('.tile.folder:has-text("정리함") .ticon'); await p.waitForSelector('.tile.file:has-text("노트A")');
  await p.locator('.tile.file:has-text("노트A")').hover();
  const a = await p.locator('.tile.file:has-text("노트A")').boundingBox();
  await p.mouse.move(a.x + 40, a.y + 40); await p.mouse.down(); await p.mouse.move(a.x + 60, a.y + 60, { steps: 4 });
  await p.waitForSelector('.trashzone'); const tz = await p.locator('.trashzone').boundingBox();
  await p.mouse.move(tz.x + tz.width / 2, tz.y + tz.height / 2, { steps: 10 }); await p.screenshot({ path: OUT + 'f2-dragging.png' }); await p.mouse.up(); await p.waitForTimeout(600);
  ok((await p.locator('.tile.file:has-text("노트A")').count()) === 0, '파일을 휴지통 영역으로 끌어다 놓으면 삭제됨');
  await p.click('[data-tab=trash]'); await p.waitForTimeout(400);
  ok((await p.locator('.tile.file:has-text("노트A")').count()) === 1, '휴지통 탭에 보관됨');
  ok(/7일/.test(await p.locator('#trashbar').innerText()) && /자동으로 완전히 삭제/.test(await p.locator('#trashbar').innerText()), '휴지통 안에 7일 자동 삭제 설명(작은 글씨)');
  ok(/7일 뒤 삭제/.test(await p.locator('.tile.file:has-text("노트A")').innerText()), '남은 기간(7일 뒤 삭제) 표시');
  await p.screenshot({ path: OUT + 'f3-trash.png' });
  await p.click('.tile.file:has-text("노트A")'); await p.click('.sheet-i[data-do=restore]'); await p.waitForTimeout(500);
  ok((await p.locator('.tile.file:has-text("노트A")').count()) === 0, '복원하면 휴지통에서 사라짐');

  // 7) 7일 지난 파일은 자동 삭제
  await p.evaluate(() => new Promise((res) => { const r = indexedDB.open('studydrive'); r.onsuccess = () => { const d = r.result, t = d.transaction('files', 'readwrite'), s = t.objectStore('files'); s.getAll().onsuccess = (e) => { const f = e.target.result.find((x) => x.name.startsWith('노트B')); if (f) { f.deleted_at = new Date(Date.now() - 8 * 864e5).toISOString(); s.put(f); } }; t.oncomplete = res; }; }));
  await p.reload(); await p.waitForSelector('#grid'); await p.click('[data-tab=trash]'); await p.waitForTimeout(500);
  ok((await p.locator('.tile.file:has-text("노트B")').count()) === 0, '휴지통에 8일 된 파일은 접속할 때 자동으로 완전 삭제됨');

  // 8) 여러 개 선택 → 이동 / 복사
  await newNote(p, '노트D'); await p.click('#selmode'); await p.waitForTimeout(200);
  await p.locator('.tile.file').first().click(); await p.waitForTimeout(200);
  ok(await p.locator('#selbar').isVisible(), '선택하면 이동·복사·삭제 막대가 나타남');
  await p.click('[data-sb=copy]'); await p.waitForSelector('.pf'); await p.click('.pf[data-f=""]'); await p.waitForTimeout(600);
  ok((await p.locator('.tile.file:has-text("사본")').count()) === 1, '복사본 만들기');
  await p.screenshot({ path: OUT + 'f4-select.png' });
  ok(errs.length === 0, '자바스크립트 오류 없음' + (errs.length ? ': ' + errs[0] : ''));
  await b.close(); console.log(fails ? `\n${fails}개 실패` : '\n모두 통과'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
