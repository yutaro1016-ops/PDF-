import * as pdfjsLib from './vendor/legacy/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/legacy/pdf.worker.min.mjs', import.meta.url).href;

const $ = (id) => document.getElementById(id);
const ui = {
  file: $('file-input'), name: $('document-name'), count: $('page-count'), search: $('search-input'),
  searchStatus: $('search-status'), results: $('search-results'), input: $('page-input'), total: $('total-pages'),
  prev: $('prev-page'), next: $('next-page'), zoomIn: $('zoom-in'), zoomOut: $('zoom-out'), zoomLabel: $('zoom-label'),
  stage: $('canvas-stage'), page: $('pdf-page'), canvas: $('pdf-canvas'), textLayer: $('text-layer'),
  empty: $('empty-state'), message: $('viewer-message'),
};

let documentTask = null;
let pdf = null;
let pageTexts = [];
let unreadablePages = 0;
let currentPage = 1;
let zoom = 1;
let renderTask = null;
let textLayerTask = null;
let pageRenderId = 0;
let loadId = 0;
let searchTimer = null;

function setMessage(message) {
  ui.message.textContent = message;
  ui.message.hidden = !message;
}

function normalize(value) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');
}

function makeIndex(items) {
  const text = items.map((item) => item.str + (item.hasEOL ? ' ' : '')).join('');
  // The index ignores spaces so text split into PDF drawing commands stays searchable.
  const characters = [];
  let normalized = '';
  for (let i = 0; i < text.length;) {
    const point = String.fromCodePoint(text.codePointAt(i));
    const part = normalize(point);
    for (const character of part) {
      characters.push(i);
      normalized += character;
    }
    i += point.length;
  }
  return { text, normalized, characters };
}

function setControls() {
  const ready = Boolean(pdf);
  const total = pdf?.numPages || 0;
  ui.input.disabled = !ready;
  ui.input.max = total || '';
  ui.input.value = ready ? currentPage : '';
  ui.total.textContent = ready ? `/ ${total}` : '/ —';
  ui.prev.disabled = !ready || currentPage <= 1;
  ui.next.disabled = !ready || currentPage >= total;
  ui.zoomIn.disabled = !ready || zoom >= 2.5;
  ui.zoomOut.disabled = !ready || zoom <= 0.5;
  ui.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

async function openFile(file) {
  if (!file) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    setMessage('PDFファイルを選択してください。');
    return;
  }
  const id = ++loadId;
  pageRenderId++;
  clearTimeout(searchTimer);
  if (renderTask) { renderTask.cancel(); renderTask = null; }
  if (textLayerTask) { textLayerTask.cancel(); textLayerTask = null; }
  if (documentTask) { documentTask.destroy(); documentTask = null; }
  pdf = null;
  pageTexts = [];
  unreadablePages = 0;
  currentPage = 1;
  zoom = 1;
  ui.name.textContent = file.name;
  ui.count.textContent = 'ページ数を確認中…';
  ui.empty.hidden = true;
  ui.page.hidden = true;
  ui.textLayer.replaceChildren();
  ui.search.value = '';
  ui.search.disabled = true;
  ui.results.replaceChildren();
  ui.searchStatus.textContent = '読み込み中…';
  setMessage('PDFを読み込んでいます…');
  setControls();

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (id !== loadId) return;
    documentTask = pdfjsLib.getDocument({
      data: bytes,
      isEvalSupported: false,
      cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
      wasmUrl: new URL('./vendor/wasm/', import.meta.url).href,
    });
    const loaded = await documentTask.promise;
    if (id !== loadId) return;
    pdf = loaded;
    ui.count.textContent = `${pdf.numPages}ページ`;
    setControls();
    setMessage('');
    await showPage(1);

    ui.searchStatus.textContent = `検索用テキストを読み込み中… 0 / ${pdf.numPages}ページ`;
    for (let p = 1; p <= pdf.numPages; p++) {
      try {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        if (id !== loadId) return;
        pageTexts[p - 1] = makeIndex(content.items);
      } catch (error) {
        if (id !== loadId) return;
        unreadablePages++;
        pageTexts[p - 1] = null;
        console.warn(`Text extraction failed on page ${p}:`, error);
      }
      if (p === pdf.numPages || p % 5 === 0) {
        ui.searchStatus.textContent = `検索用テキストを読み込み中… ${p} / ${pdf.numPages}ページ`;
      }
      // Let page navigation and mobile browsers respond during longer PDFs.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (id !== loadId) return;
    const indexedPages = pageTexts.filter((page) => page && page.normalized).length;
    ui.search.disabled = indexedPages === 0;
    ui.searchStatus.textContent = indexedPages === 0
      ? '本文の文字を取得できませんでした。ページ表示は利用できます。'
      : `検索語を入力してください${coverageNote()}`;
    if (indexedPages && window.matchMedia('(pointer: fine)').matches) ui.search.focus();
  } catch (error) {
    if (id !== loadId) return;
    const message = error?.name === 'PasswordException'
      ? 'パスワード保護されたPDFは、この版では開けません。'
      : pdf
        ? 'ページ表示で問題が発生しました。別のブラウザーでもお試しください。'
        : 'PDFを開けませんでした。ファイル形式と端末のブラウザーを確認してください。';
    setMessage(message);
    ui.searchStatus.textContent = '検索できません';
    if (!pdf) ui.count.textContent = 'ページ数を取得できませんでした';
    console.error('PDF load failed:', error);
  }
}

function coverageNote() {
  return unreadablePages ? `（${unreadablePages}ページの文字は読み取れませんでした）` : '';
}

async function showPage(number) {
  if (!pdf) return;
  const next = Number(number);
  if (!Number.isInteger(next) || next < 1 || next > pdf.numPages) {
    ui.input.value = currentPage;
    return;
  }
  currentPage = next;
  const renderId = ++pageRenderId;
  setControls();
  ui.results.querySelectorAll('.result').forEach((el) => el.classList.toggle('active', Number(el.dataset.page) === next));
  if (textLayerTask) { textLayerTask.cancel(); textLayerTask = null; }
  ui.textLayer.replaceChildren();
  if (renderTask) {
    renderTask.cancel();
    try { await renderTask.promise; } catch (_) { /* cancelled render */ }
  }
  const activePdf = pdf;
  const page = await activePdf.getPage(next);
  if (activePdf !== pdf || renderId !== pageRenderId) return;
  const viewport = page.getViewport({ scale: zoom });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const context = ui.canvas.getContext('2d', { alpha: false });
  ui.canvas.width = Math.floor(viewport.width * pixelRatio);
  ui.canvas.height = Math.floor(viewport.height * pixelRatio);
  ui.canvas.style.width = `${viewport.width}px`;
  ui.canvas.style.height = `${viewport.height}px`;
  ui.page.style.width = `${viewport.width}px`;
  ui.page.style.height = `${viewport.height}px`;
  ui.page.style.setProperty('--total-scale-factor', zoom);
  ui.page.hidden = false;
  ui.stage.scrollTop = 0;
  ui.stage.scrollLeft = 0;
  const task = page.render({ canvasContext: context, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
  renderTask = task;
  try {
    await task.promise;
    if (activePdf !== pdf || renderId !== pageRenderId) return;
    const content = await page.getTextContent();
    if (activePdf !== pdf || renderId !== pageRenderId) return;
    const layer = new pdfjsLib.TextLayer({ textContentSource: content, container: ui.textLayer, viewport });
    textLayerTask = layer;
    await layer.render();
  } catch (error) {
    if (error?.name !== 'RenderingCancelledException' && error?.name !== 'AbortException')
      console.error('PDF render failed:', error);
  } finally {
    if (renderTask === task) renderTask = null;
    if (renderId === pageRenderId) textLayerTask = null;
  }
}

function addSnippet(container, page, start, length) {
  const source = page.text;
  const begin = Math.max(0, page.characters[start] - 35);
  const endIndex = page.characters[Math.min(start + length - 1, page.characters.length - 1)] + 1;
  const end = Math.min(source.length, endIndex + 55);
  const before = source.slice(begin, page.characters[start]).replace(/\s+/g, ' ');
  const match = source.slice(page.characters[start], endIndex).replace(/\s+/g, ' ');
  const after = source.slice(endIndex, end).replace(/\s+/g, ' ');
  container.append(document.createTextNode((begin ? '…' : '') + before));
  const highlight = document.createElement('mark');
  highlight.textContent = match;
  container.append(highlight, document.createTextNode(after + (end < source.length ? '…' : '')));
}

function search() {
  ui.results.replaceChildren();
  const query = normalize(ui.search.value.trim());
  if (!query) { ui.searchStatus.textContent = `検索語を入力してください${coverageNote()}`; return; }
  let matchingPages = 0;
  let totalMatches = 0;
  const fragment = document.createDocumentFragment();
  pageTexts.forEach((page, index) => {
    if (!page) return;
    let position = 0;
    let count = 0;
    let first = -1;
    while ((position = page.normalized.indexOf(query, position)) !== -1) {
      if (first === -1) first = position;
      count++;
      position += Math.max(query.length, 1);
    }
    if (!count) return;
    matchingPages++;
    totalMatches += count;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result' + (currentPage === index + 1 ? ' active' : '');
    button.dataset.page = String(index + 1);
    const title = document.createElement('span');
    title.className = 'result-title';
    const pageLabel = document.createElement('span');
    pageLabel.textContent = `${index + 1}ページ`;
    const countLabel = document.createElement('span');
    countLabel.className = 'result-count';
    countLabel.textContent = `${count}件`;
    title.append(pageLabel, countLabel);
    const snippet = document.createElement('span');
    snippet.className = 'result-snippet';
    addSnippet(snippet, page, first, query.length);
    button.append(title, snippet);
    button.addEventListener('click', () => showPage(index + 1));
    fragment.append(button);
  });
  ui.results.append(fragment);
  ui.searchStatus.textContent = matchingPages
    ? `${matchingPages}ページに ${totalMatches}件見つかりました${coverageNote()}`
    : `一致する文字はありません${coverageNote()}`;
}

ui.file.addEventListener('change', (event) => {
  openFile(event.target.files?.[0]);
  event.target.value = '';
});
ui.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 160);
});
ui.prev.addEventListener('click', () => showPage(currentPage - 1));
ui.next.addEventListener('click', () => showPage(currentPage + 1));
ui.input.addEventListener('change', () => showPage(ui.input.value));
ui.input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { ui.input.blur(); showPage(ui.input.value); } });
ui.zoomIn.addEventListener('click', () => { zoom = Math.min(2.5, Math.round((zoom + 0.25) * 100) / 100); showPage(currentPage); });
ui.zoomOut.addEventListener('click', () => { zoom = Math.max(0.5, Math.round((zoom - 0.25) * 100) / 100); showPage(currentPage); });

for (const eventName of ['dragenter', 'dragover']) {
  ui.stage.addEventListener(eventName, (event) => { event.preventDefault(); ui.stage.classList.add('dragging'); });
}
for (const eventName of ['dragleave', 'drop']) {
  ui.stage.addEventListener(eventName, (event) => { event.preventDefault(); ui.stage.classList.remove('dragging'); });
}
ui.stage.addEventListener('drop', (event) => openFile(event.dataTransfer?.files?.[0]));
setControls();
