import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export const PAPERS = { blank: '백지', lined: '줄노트', grid: '모눈', dot: '점노트', cornell: '코넬' };
export const paperKey = (tags = []) => Object.keys(PAPERS).find((k) => tags.includes(PAPERS[k])) || 'blank';

const W = 595.28, H = 841.89; // A4
const G = rgb(0.78, 0.8, 0.85);

function drawPaper(page, paper) {
  const line = (x1, y1, x2, y2, t = 0.5, color = G) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: t, color });
  if (paper === 'lined') for (let y = H - 70; y > 40; y -= 26) line(36, y, W - 36, y);
  if (paper === 'grid') {
    for (let x = 36; x <= W - 36; x += 20) line(x, 36, x, H - 36, 0.4);
    for (let y = 36; y <= H - 36; y += 20) line(36, y, W - 36, y, 0.4);
  }
  if (paper === 'dot') for (let x = 36; x <= W - 36; x += 20) for (let y = 36; y <= H - 36; y += 20) page.drawCircle({ x, y, size: 0.7, color: rgb(0.55, 0.58, 0.65) });
  if (paper === 'cornell') {
    line(36, H - 90, W - 36, H - 90, 1, rgb(0.45, 0.5, 0.6)); // 제목 줄
    line(150, H - 90, 150, 170, 1, rgb(0.45, 0.5, 0.6)); // 키워드 열
    line(36, 170, W - 36, 170, 1, rgb(0.45, 0.5, 0.6)); // 요약 칸
  }
}

export async function makeNotePdf({ paper = 'blank', pages = 10 }) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) drawPaper(doc.addPage([W, H]), paper);
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

export async function addPages(blob, paper, n = 1) {
  const doc = await PDFDocument.load(await blob.arrayBuffer());
  for (let i = 0; i < n; i++) drawPaper(doc.addPage([W, H]), paper);
  return { blob: new Blob([await doc.save()], { type: 'application/pdf' }), count: doc.getPageCount() };
}

// 영어 샘플 문제 PDF (표준 폰트 사용: 영문만) — 뷰어·필기·AI 해설 체험용
export async function makeSamplePdf(title, lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([W, H]);
  page.drawText(title, { x: 50, y: H - 70, size: 16, font: bold, color: rgb(0.1, 0.12, 0.2) });
  let y = H - 120;
  for (const l of lines) { if (l) page.drawText(l, { x: 50, y, size: 12, font, color: rgb(0.1, 0.12, 0.2) }); y -= l ? 22 : 14; }
  return new Blob([await doc.save()], { type: 'application/pdf' });
}
