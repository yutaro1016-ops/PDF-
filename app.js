import * as pdfjsLib from './vendor/legacy/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/legacy/pdf.worker.min.mjs', import.meta.url).href;

const $ = (id) => document.getElementById(id);
const ui = {
  file: $('file-input'), name: $('document-name'), count: $('page-count'), listBlock: $('document-list-block'),
  list: $('document-list'), clear: $('clear-documents'), search: $('search-input'),
  searchStatus: $('search-status'), results: $('search-results'), input: $('page-input'), total: $('total-pages'),
  prev: $('prev-page'), next: $('next-page'), zoomIn: $('zoom-in'), zoomOut: $('zoom-out'), zoomLabel: $('zoom-label'),
  stage: $('canvas-stage'), page: $('pdf-page'), canvas: $('pdf-canvas'), textLayer: $('text-layer'),
  empty: $('empty-state'), message: $('viewer-message'),
};

let documents = [];
let activeDoc = null;
let currentPage = 1;
let zoom = 1;
let renderTask = null;
let textLayerTask = null;
let pageRenderId = 0;
let collectionId = 0;
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

async function readTextContent(page) {
  // Safari can render a page while getTextContent() fails to iterate its stream.
  const reader = page.streamTextContent().getReader();
  const content = { items: [], styles: Object.create(null), lang: null };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      content.lang ??= value.lang;
      Object.assign(content.styles, value.styles);
      content.items.push(...value.items);
    }
  } finally {
    reader.releaseLock();
  }
  return content;
}

function isCurrent(doc, generation) {
  return generation === collectionId && documents.includes(doc);
}

function indexedCount(doc) {
  return doc.pageTexts.filter((page) => page?.normalized).length;
}

function coverageNote() {
  const unreadable = documents.reduce((sum, doc) => sum + doc.unreadablePages, 0);
  return unreadable ? `（${unreadable}ページの文字は読み取れませんでした）` : '';
}

function updateSearchStatus() {
  const processing = documents.find((doc) => doc.status === 'loading' || doc.status === 'indexing');
  const indexed = documents.reduce((sum, doc) => sum + indexedCount(doc), 0);
  ui.search.disabled = indexed === 0;
  if (processing) {
    ui.searchStatus.textContent = `検索用テキストを読み込み中… ${processing.name} ${processing.indexed} / ${processing.pdf?.numPages || '—'}ページ`;
  } else if (!documents.length) {
    ui.searchStatus.textContent = 'PDFを開くと検索できます';
  } else if (!indexed) {
    ui.searchStatus.textContent = '本文の文字を取得できませんでした。ページ表示は利用できます。';
  } else if (ui.search.value.trim()) {
    search();
  } else {
    ui.searchStatus.textContent = `検索語を入力してください${coverageNote()}`;
  }
}

function updateDocumentList() {
  ui.listBlock.hidden = documents.length === 0;
  ui.list.replaceChildren();
  for (const doc of documents) {
    const row = document.createElement('div');
    row.className = 'document-row';
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'document-select' + (doc === activeDoc ? ' active' : '');
    select.setAttribute('aria-current', doc === activeDoc ? 'true' : 'false');
    const name = document.createElement('span');
    name.className = 'document-item-name';
    name.textContent = doc.name;
    const detail = document.createElement('span');
    detail.className = 'document-item-detail';
    detail.textContent = doc.status === 'error' ? '開けませんでした'
      : doc.pdf ? `${doc.pdf.numPages}ページ${doc.status === 'indexing' ? '・文字を読取中' : ''}`
        : '読み込み中';
    select.append(name, detail);
    select.addEventListener('click', () => selectDocument(doc));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'document-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `${doc.name}を削除`);
    remove.addEventListener('click', () => removeDocument(doc));
    row.append(select, remove);
    ui.list.append(row);
  }
}

function setControls() {
  const pdf = activeDoc?.pdf;
  const total = pdf?.numPages || 0;
  ui.input.disabled = !pdf;
  ui.input.max = total || '';
  ui.input.value = pdf ? currentPage : '';
  ui.total.textContent = pdf ? `/ ${total}` : '/ —';
  ui.prev.disabled = !pdf || currentPage <= 1;
  ui.next.disabled = !pdf || currentPage >= total;
  ui.zoomIn.disabled = !pdf || zoom >= 2.5;
  ui.zoomOut.disabled = !pdf || zoom <= 0.5;
  ui.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function stopRendering() {
  pageRenderId++;
  if (renderTask) { renderTask.cancel(); renderTask = null; }
  if (textLayerTask) { textLayerTask.cancel(); textLayerTask = null; }
  ui.textLayer.replaceChildren();
}

function selectDocument(doc, render = true) {
  if (!documents.includes(doc)) return;
  if (doc !== activeDoc) {
    stopRendering();
    activeDoc = doc;
    currentPage = 1;
    zoom = 1;
    ui.page.hidden = true;
  }
  ui.name.textContent = doc.name;
  ui.count.textContent = doc.pdf ? `${doc.pdf.numPages}ページ`
    : doc.status === 'error' ? 'ページ数を取得できませんでした' : 'ページ数を確認中…';
  ui.empty.hidden = true;
  setMessage(doc.status === 'error' ? 'PDFを開けませんでした。ファイル形式と端末のブラウザーを確認してください。'
    : doc.pdf ? '' : 'PDFを読み込んでいます…');
  setControls();
  updateDocumentList();
  if (render && doc.pdf && ui.page.hidden) showPage(1, doc);
  updateResultSelection();
}

function resetViewer() {
  activeDoc = null;
  currentPage = 1;
  zoom = 1;
  ui.name.textContent = 'PDFを選択してください';
  ui.count.textContent = '複数のPDFをまとめて選択できます';
  ui.page.hidden = true;
  ui.empty.hidden = false;
  setMessage('');
  setControls();
  updateDocumentList();
  updateSearchStatus();
}

function removeDocument(doc) {
  const index = documents.indexOf(doc);
  if (index === -1) return;
  documents.splice(index, 1);
  if (doc === activeDoc) {
    stopRendering();
    activeDoc = null;
  }
  doc.task?.destroy().catch(() => {});
  if (!activeDoc) {
    if (documents.length) selectDocument(documents[Math.min(index, documents.length - 1)]);
    else resetViewer();
  } else updateDocumentList();
  search();
  updateSearchStatus();
}

function clearDocuments() {
  collectionId++;
  stopRendering();
  const old = documents;
  documents = [];
  for (const doc of old) doc.task?.destroy().catch(() => {});
  ui.search.value = '';
  ui.results.replaceChildren();
  resetViewer();
}

async function addFiles(files) {
  const accepted = Array.from(files).filter((file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf');
  if (!accepted.length) {
    setMessage('PDFファイルを選択してください。');
    return;
  }
  const generation = collectionId;
  const added = accepted.map((file) => {
    const doc = { name: file.name, pdf: null, task: null, pageTexts: [], unreadablePages: 0, indexed: 0, status: 'loading' };
    documents.push(doc);
    return { file, doc };
  });
  if (!activeDoc) selectDocument(added[0].doc);
  updateDocumentList();
  updateSearchStatus();
  // Process documents in sequence to keep mobile memory and UI responsive.
  for (const { file, doc } of added) {
    if (!isCurrent(doc, generation)) continue;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isCurrent(doc, generation)) continue;
      doc.task = pdfjsLib.getDocument({
        data: bytes, isEvalSupported: false,
        cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href, cMapPacked: true,
        standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
        wasmUrl: new URL('./vendor/wasm/', import.meta.url).href,
      });
      doc.pdf = await doc.task.promise;
      if (!isCurrent(doc, generation)) continue;
      doc.status = 'indexing';
      updateDocumentList();
      if (activeDoc === doc) selectDocument(doc);
      for (let p = 1; p <= doc.pdf.numPages; p++) {
        if (!isCurrent(doc, generation)) break;
        try {
          const page = await doc.pdf.getPage(p);
          const content = await readTextContent(page);
          if (!isCurrent(doc, generation)) break;
          doc.pageTexts[p - 1] = makeIndex(content.items);
        } catch (error) {
          if (!isCurrent(doc, generation)) break;
          doc.unreadablePages++;
          doc.pageTexts[p - 1] = null;
          console.warn(`Text extraction failed in ${doc.name}, page ${p}:`, error);
        }
        doc.indexed = p;
        if (p === doc.pdf.numPages || p % 5 === 0) {
          updateSearchStatus();
          if (ui.search.value.trim()) search();
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (!isCurrent(doc, generation)) continue;
      doc.status = 'ready';
      updateDocumentList();
      updateSearchStatus();
      if (ui.search.value.trim()) search();
    } catch (error) {
      if (!isCurrent(doc, generation)) continue;
      doc.status = 'error';
      if (activeDoc === doc) selectDocument(doc);
      updateDocumentList();
      updateSearchStatus();
      console.error('PDF load failed:', error);
    }
  }
  if (generation === collectionId && !ui.search.disabled && window.matchMedia('(pointer: fine)').matches) ui.search.focus();
}

async function showPage(number, doc = activeDoc) {
  if (!doc?.pdf || !documents.includes(doc)) return;
  const next = Number(number);
  if (!Number.isInteger(next) || next < 1 || next > doc.pdf.numPages) {
    ui.input.value = currentPage;
    return;
  }
  if (doc !== activeDoc) selectDocument(doc, false);
  currentPage = next;
  const renderId = ++pageRenderId;
  setControls();
  updateResultSelection();
  if (textLayerTask) { textLayerTask.cancel(); textLayerTask = null; }
  ui.textLayer.replaceChildren();
  if (renderTask) {
    renderTask.cancel();
    try { await renderTask.promise; } catch (_) { /* cancelled render */ }
  }
  const page = await doc.pdf.getPage(next);
  if (doc !== activeDoc || renderId !== pageRenderId) return;
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
    if (doc !== activeDoc || renderId !== pageRenderId) return;
    const content = await readTextContent(page);
    if (doc !== activeDoc || renderId !== pageRenderId) return;
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

function updateResultSelection() {
  ui.results.querySelectorAll('.result').forEach((el) =>
    el.classList.toggle('active', el.doc === activeDoc && Number(el.dataset.page) === currentPage));
}

function search() {
  ui.results.replaceChildren();
  const query = normalize(ui.search.value.trim());
  if (!query) { updateSearchStatus(); return; }
  let matchingPages = 0;
  let matchingDocuments = 0;
  let totalMatches = 0;
  const fragment = document.createDocumentFragment();
  for (const doc of documents) {
    let foundInDocument = false;
    doc.pageTexts.forEach((page, index) => {
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
      foundInDocument = true;
      matchingPages++;
      totalMatches += count;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'result' + (activeDoc === doc && currentPage === index + 1 ? ' active' : '');
      button.dataset.page = String(index + 1);
      button.doc = doc;
      const title = document.createElement('span');
      title.className = 'result-title';
      const pageLabel = document.createElement('span');
      pageLabel.textContent = `${index + 1}ページ`;
      const countLabel = document.createElement('span');
      countLabel.className = 'result-count';
      countLabel.textContent = `${count}件`;
      title.append(pageLabel, countLabel);
      const filename = document.createElement('span');
      filename.className = 'result-filename';
      filename.textContent = doc.name;
      const snippet = document.createElement('span');
      snippet.className = 'result-snippet';
      addSnippet(snippet, page, first, query.length);
      button.append(filename, title, snippet);
      button.addEventListener('click', () => showPage(index + 1, doc));
      fragment.append(button);
    });
    if (foundInDocument) matchingDocuments++;
  }
  ui.results.append(fragment);
  ui.searchStatus.textContent = matchingPages
    ? `${matchingDocuments}件のPDF・${matchingPages}ページに ${totalMatches}件見つかりました${coverageNote()}`
    : `一致する文字はありません${coverageNote()}`;
}

ui.file.addEventListener('change', (event) => {
  addFiles(event.target.files);
  event.target.value = '';
});
ui.clear.addEventListener('click', clearDocuments);
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
ui.stage.addEventListener('drop', (event) => addFiles(event.dataTransfer?.files || []));
setControls();
