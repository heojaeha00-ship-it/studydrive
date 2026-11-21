import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('dist/pdf.worker.min.mjs', document.baseURI).href;

export async function openDoc(blob) {
  const data = await blob.arrayBuffer();
  return pdfjs.getDocument({ data }).promise;
}

export async function pageText(doc, n) {
  const pg = await doc.getPage(n);
  const tc = await pg.getTextContent();
  return tc.items.map((i) => i.str).join(' ');
}

function toJpegB64(canvas, maxW) {
  let c = canvas;
  if (canvas.width > maxW) {
    c = document.createElement('canvas');
    c.width = maxW;
    c.height = Math.round((canvas.height * maxW) / canvas.width);
    c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  }
  return c.toDataURL('image/jpeg', 0.75).split(',')[1];
}
export { toJpegB64 };

// Render one page/image of a blob to a base64 JPEG (for AI vision input)
export async function pageImage(blob, type, page = 1, maxW = 1200) {
  if (type === 'image') {
    const url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    return toJpegB64(c, maxW);
  }
  const doc = await openDoc(blob);
  const pg = await doc.getPage(Math.min(page, doc.numPages));
  const v0 = pg.getViewport({ scale: 1 });
  const vp = pg.getViewport({ scale: maxW / v0.width });
  const c = document.createElement('canvas');
  c.width = vp.width; c.height = vp.height;
  await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return toJpegB64(c, maxW);
}
