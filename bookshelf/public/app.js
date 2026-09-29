import * as pdfjsLib from './vendor/legacy/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/legacy/pdf.worker.min.mjs', import.meta.url).href;
const $ = (id) => document.getElementById(id);
const ui = {
  file: $('file-input'), list: $('document-list'), libraryStatus: $('library-status'), titleSearch: $('title-search'),
  name: $('document-name'), rename: $('rename-document'), search: $('search-input'), scope: $('search-scope'), searchStatus: $('search-status'),
  results: $('search-results'), input: $('page-input'), total: $('total-pages'), prev: $('prev-page'), next: $('next-page'),
  zoomIn: $('zoom-in'), zoomOut: $('zoom-out'), zoomLabel: $('zoom-label'), stage: $('canvas-stage'),
  page: $('pdf-page'), canvas: $('pdf-canvas'), textLayer: $('text-layer'), empty: $('empty-state'), message: $('viewer-message'),
};
let books = [];
let activeBook = null;
let activeTask = null;
let pdf = null;
let currentPage = 1;
let zoom = 1;
let renderTask = null;
let textLayerTask = null;
let pageRenderId = 0;
let openId = 0;
let searchId = 0;
let searchTimer = null;
let searchHits = [];
const pdfOptions = { isEvalSupported: false, cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,
  cMapPacked: true, standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
  wasmUrl: new URL('./vendor/wasm/', import.meta.url).href };

function normalize(value) { return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ''); }
function setMessage(message) { ui.message.textContent = message; ui.message.hidden = !message; }
function updateScopeOptions() {
  const selected = ui.scope.value;
  ui.scope.replaceChildren(new Option('すべての本', ''));
  for (const book of books) ui.scope.add(new Option(book.title, book.id));
  ui.scope.value = books.some((book) => book.id === selected) ? selected : '';
  ui.search.placeholder = ui.scope.value ? 'この本から検索' : 'すべてのPDFから検索';
}
async function api(path, options) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作を完了できませんでした。');
  return result;
}
function updateList() {
  const filter = normalize(ui.titleSearch.value.trim());
  ui.list.replaceChildren();
  const visible = books.filter((book) => normalize(book.title).includes(filter) || normalize(book.fileName).includes(filter));
  ui.libraryStatus.textContent = `${books.length}件のPDFを保存中${filter ? `・${visible.length}件表示` : ''}`;
  for (const book of visible) {
    const row = document.createElement('div'); row.className = 'document-row';
    const select = document.createElement('button'); select.type = 'button';
    select.className = 'document-select' + (activeBook?.id === book.id ? ' active' : '');
    const title = document.createElement('span'); title.className = 'document-item-name'; title.textContent = book.title;
    const detail = document.createElement('span'); detail.className = 'document-item-detail';
    detail.textContent = book.status !== 'ready' ? '保存未完了・削除できます'
      : `${book.pageCount || '—'}ページ${book.indexedPages < book.pageCount ? '・文字の取得は未完了' : ''}`;
    select.append(title, detail); select.addEventListener('click', () => openBook(book));
    row.append(select);
    if (book.status === 'ready' && book.indexedPages < book.pageCount) {
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'document-retry';
      retry.textContent = '文字を再取得'; retry.setAttribute('aria-label', `${book.title}の文字を再取得`);
      retry.addEventListener('click', () => reindexBook(book)); row.append(retry);
    }
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'document-remove';
    remove.textContent = '×'; remove.setAttribute('aria-label', `${book.title}を削除`);
    remove.addEventListener('click', () => removeBook(book)); row.append(remove);
    ui.list.append(row);
  }
  if (!visible.length && books.length) {
    const empty = document.createElement('p'); empty.className = 'list-empty'; empty.textContent = '一致するタイトルはありません'; ui.list.append(empty);
  }
}
function setControls() {
  const total = pdf?.numPages || 0;
  ui.input.disabled = !pdf; ui.input.max = total || ''; ui.input.value = pdf ? currentPage : '';
  ui.total.textContent = pdf ? `/ ${total}` : '/ —';
  ui.prev.disabled = !pdf || currentPage <= 1; ui.next.disabled = !pdf || currentPage >= total;
  ui.zoomIn.disabled = !pdf || zoom >= 2.5; ui.zoomOut.disabled = !pdf || zoom <= 0.5;
  ui.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  ui.rename.disabled = !activeBook;
}
function stopRendering() {
  pageRenderId++;
  if (renderTask) { renderTask.cancel(); renderTask = null; }
  if (textLayerTask) { textLayerTask.cancel(); textLayerTask = null; }
  ui.textLayer.replaceChildren();
}
function clearViewer() {
  openId++; stopRendering(); activeTask?.destroy().catch(() => {}); activeTask = null;
  pdf = null; activeBook = null; currentPage = 1; zoom = 1;
  ui.page.hidden = true; ui.empty.hidden = false; ui.name.textContent = '資料を選択してください';
  setMessage(''); setControls(); updateList();
}
async function openBook(book, targetPage = 1) {
  if (!books.includes(book) || book.status !== 'ready') return;
  const id = ++openId;
  stopRendering(); activeTask?.destroy().catch(() => {}); activeTask = null;
  pdf = null; activeBook = book; currentPage = 1; zoom = 1;
  ui.page.hidden = true; ui.empty.hidden = true; ui.name.textContent = book.title;
  setMessage('PDFを開いています…'); setControls(); updateList();
  try {
    const response = await fetch(`/api/library/${encodeURIComponent(book.id)}/file`);
    if (!response.ok) throw new Error('PDFを開けませんでした。');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (id !== openId) return;
    const task = pdfjsLib.getDocument({ ...pdfOptions, data: bytes }); activeTask = task;
    const loaded = await task.promise;
    if (id !== openId) return;
    pdf = loaded; ui.empty.hidden = true; setMessage('');
    await showPage(targetPage);
  } catch (error) {
    if (id !== openId) return;
    setMessage(error.message || 'PDFを開けませんでした。');
  }
}
async function showPage(number) {
  if (!pdf) return;
  const next = Number(number);
  if (!Number.isInteger(next) || next < 1 || next > pdf.numPages) { ui.input.value = currentPage; return; }
  currentPage = next; const renderId = ++pageRenderId; const activePdf = pdf;
  setControls(); updateResultSelection();
  if (textLayerTask) { textLayerTask.cancel(); textLayerTask = null; }
  ui.textLayer.replaceChildren();
  if (renderTask) { renderTask.cancel(); try { await renderTask.promise; } catch (_) {} }
  try {
    const page = await activePdf.getPage(next);
    if (renderId !== pageRenderId || activePdf !== pdf) return;
    const viewport = page.getViewport({ scale: zoom });
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const context = ui.canvas.getContext('2d', { alpha: false });
    ui.canvas.width = Math.floor(viewport.width * pixelRatio); ui.canvas.height = Math.floor(viewport.height * pixelRatio);
    ui.canvas.style.width = `${viewport.width}px`; ui.canvas.style.height = `${viewport.height}px`;
    ui.page.style.width = `${viewport.width}px`; ui.page.style.height = `${viewport.height}px`;
    ui.page.style.setProperty('--total-scale-factor', zoom); ui.page.hidden = false;
    ui.stage.scrollTop = 0; ui.stage.scrollLeft = 0;
    const task = page.render({ canvasContext: context, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
    renderTask = task;
    try {
      await task.promise;
      if (renderId !== pageRenderId || activePdf !== pdf) return;
      const content = await readTextContent(page);
      if (renderId !== pageRenderId || activePdf !== pdf) return;
      const layer = new pdfjsLib.TextLayer({ textContentSource: content, container: ui.textLayer, viewport });
      textLayerTask = layer; await layer.render();
    } finally { if (renderTask === task) renderTask = null; if (renderId === pageRenderId) textLayerTask = null; }
  } catch (error) {
    if (error?.name !== 'RenderingCancelledException' && error?.name !== 'AbortException') console.error('Render failed:', error);
  }
}
async function readTextContent(page) {
  const reader = page.streamTextContent().getReader();
  const content = { items: [], styles: Object.create(null), lang: null };
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      content.lang ??= value.lang; Object.assign(content.styles, value.styles); content.items.push(...value.items);
    }
  } finally { reader.releaseLock(); }
  return content;
}
function makeIndex(items) {
  const text = items.map((item) => item.str + (item.hasEOL ? ' ' : '')).join('');
  const characters = []; let normalized = '';
  for (let i = 0; i < text.length;) {
    const point = String.fromCodePoint(text.codePointAt(i));
    for (const character of normalize(point)) { characters.push(i); normalized += character; }
    i += point.length;
  }
  return { text, normalized, characters };
}
async function indexBook(book, loaded) {
  if (!loaded || !books.includes(book)) return;
  let failures = 0;
  for (let p = 1; p <= loaded.numPages; p++) {
    if (!books.includes(book)) return;
    try {
      const page = await loaded.getPage(p);
      const content = await readTextContent(page);
      const index = makeIndex(content.items);
      if (index.text.length > 200000 || index.normalized.length > 200000) throw new Error('Text too long');
      const result = await api(`/api/library/${encodeURIComponent(book.id)}/pages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages: [{ number: p, text: index.text, normalized: index.normalized }] }),
      });
      book.indexedPages = result.indexedPages;
    } catch (error) { failures++; console.warn(`Index page ${p} failed:`, error); }
    if (p === loaded.numPages || p % 5 === 0) {
      updateList();
      ui.libraryStatus.textContent = `${book.title}：文字を取得中 ${p} / ${loaded.numPages}ページ`;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  updateList();
  ui.libraryStatus.textContent = failures ? `${book.title}：${failures}ページの文字を取得できませんでした` : `${books.length}件のPDFを保存中`;
  if (ui.search.value.trim()) searchTerm();
}
async function reindexBook(book) {
  try {
    ui.libraryStatus.textContent = `${book.title}の文字を再取得中…`;
    const response = await fetch(`/api/library/${encodeURIComponent(book.id)}/file`);
    if (!response.ok) throw new Error('PDFを取得できませんでした。');
    const task = pdfjsLib.getDocument({ ...pdfOptions, data: new Uint8Array(await response.arrayBuffer()) });
    try { await indexBook(book, await task.promise); } finally { await task.destroy(); }
  } catch (error) { ui.libraryStatus.textContent = error.message; }
}
async function addFiles(files) {
  const accepted = Array.from(files).filter((file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf');
  if (!accepted.length) { setMessage('PDFファイルを選択してください。'); return; }
  for (const file of accepted) {
    let newId = null; let saved = false;
    try {
      ui.libraryStatus.textContent = `${file.name}を保存中…`;
      if (file.size > 50 * 1024 * 1024) throw new Error('50MB以下のPDFを選択してください。');
      const task = pdfjsLib.getDocument({ ...pdfOptions, data: new Uint8Array(await file.arrayBuffer()) });
      try {
        const loaded = await task.promise;
        const title = file.name.replace(/\.pdf$/i, '').trim() || file.name;
        const created = await api('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, fileName: file.name, size: file.size }) });
        newId = created.id;
        await api(`/api/library/${encodeURIComponent(newId)}/file`, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'X-Page-Count': String(loaded.numPages) }, body: file });
        saved = true;
        const book = { id: newId, title, fileName: file.name, fileSize: file.size, pageCount: loaded.numPages,
          indexedPages: 0, status: 'ready', createdAt: new Date().toISOString() };
        books.unshift(book); updateList(); updateScopeOptions();
        if (!activeBook) openBook(book);
        await indexBook(book, loaded);
      } finally { await task.destroy(); }
    } catch (error) {
      if (newId && !saved) {
        try { await api(`/api/library/${encodeURIComponent(newId)}`, { method: 'DELETE' }); } catch (_) {}
      }
      ui.libraryStatus.textContent = `${file.name}：${error.message || '保存できませんでした。'}`;
      console.error('Upload failed:', error);
    }
  }
}
async function removeBook(book) {
  if (!window.confirm(`「${book.title}」を本棚から削除しますか？`)) return;
  try {
    await api(`/api/library/${encodeURIComponent(book.id)}`, { method: 'DELETE' });
    books = books.filter((item) => item.id !== book.id);
    if (activeBook?.id === book.id) clearViewer();
    updateList(); updateScopeOptions(); if (ui.search.value.trim()) searchTerm();
  } catch (error) { ui.libraryStatus.textContent = error.message; }
}
async function renameBook() {
  if (!activeBook) return;
  const book = activeBook;
  const proposed = window.prompt('新しいタイトル', book.title)?.trim();
  if (!proposed || proposed === book.title) return;
  try {
    const result = await api(`/api/library/${encodeURIComponent(book.id)}`, { method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: proposed }) });
    book.title = result.title; ui.name.textContent = book.title; updateList(); updateScopeOptions();
    if (ui.search.value.trim()) searchTerm();
  } catch (error) { ui.libraryStatus.textContent = error.message; }
}
function addSnippet(container, page, start, length) {
  const source = page.text; const begin = Math.max(0, page.characters[start] - 35);
  const endIndex = page.characters[Math.min(start + length - 1, page.characters.length - 1)] + 1;
  const end = Math.min(source.length, endIndex + 55);
  container.append(document.createTextNode((begin ? '…' : '') + source.slice(begin, page.characters[start]).replace(/\s+/g, ' ')));
  const mark = document.createElement('mark'); mark.textContent = source.slice(page.characters[start], endIndex).replace(/\s+/g, ' ');
  container.append(mark, document.createTextNode(source.slice(endIndex, end).replace(/\s+/g, ' ') + (end < source.length ? '…' : '')));
}
function updateResultSelection() {
  ui.results.querySelectorAll('.result').forEach((button) =>
    button.classList.toggle('active', button.dataset.book === activeBook?.id && Number(button.dataset.page) === currentPage));
}
async function searchTerm() {
  const id = ++searchId;
  const query = normalize(ui.search.value.trim()).slice(0, 100);
  if (!query) { ui.results.replaceChildren(); ui.searchStatus.textContent = '用語を入力してください'; return; }
  ui.searchStatus.textContent = '用語を検索中…';
  try {
    const params = new URLSearchParams({ q: query });
    if (ui.scope.value) params.set('book', ui.scope.value);
    const response = await api(`/api/search?${params}`);
    if (id !== searchId) return;
    searchHits = response.results; ui.results.replaceChildren();
    let total = 0;
    for (const hit of searchHits) {
      const book = books.find((candidate) => candidate.id === hit.bookId); if (!book) continue;
      const page = makeIndex([{ str: hit.text, hasEOL: false }]);
      let count = 0, position = 0, first = -1;
      while ((position = page.normalized.indexOf(query, position)) !== -1) { if (first < 0) first = position; count++; position += query.length; }
      if (!count) continue;
      total += count;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'result';
      button.dataset.book = book.id; button.dataset.page = String(hit.pageNumber);
      const filename = document.createElement('span'); filename.className = 'result-filename'; filename.textContent = book.title;
      const heading = document.createElement('span'); heading.className = 'result-title';
      const label = document.createElement('span'); label.textContent = `${hit.pageNumber}ページ`;
      const amount = document.createElement('span'); amount.className = 'result-count'; amount.textContent = `${count}件`;
      heading.append(label, amount);
      const snippet = document.createElement('span'); snippet.className = 'result-snippet'; addSnippet(snippet, page, first, query.length);
      button.append(filename, heading, snippet);
      button.addEventListener('click', () => activeBook?.id === book.id && pdf ? showPage(hit.pageNumber) : openBook(book, hit.pageNumber));
      ui.results.append(button);
    }
    updateResultSelection();
    ui.searchStatus.textContent = searchHits.length ? `${searchHits.length}ページに${total}件${response.truncated ? '（先頭40ページを表示）' : ''}` : '一致する用語はありません';
  } catch (error) { if (id === searchId) ui.searchStatus.textContent = error.message; }
}
async function loadLibrary() {
  try {
    const result = await api('/api/library'); books = result.books; updateList(); updateScopeOptions();
    if (books.length) { ui.empty.querySelector('h2').textContent = '本棚からPDFを選択';
      ui.empty.querySelector('p').textContent = '左の一覧から資料を選ぶか、新しいPDFを追加してください。'; }
  } catch (error) {
    ui.libraryStatus.replaceChildren(document.createTextNode(error.message + ' '));
    const link = document.createElement('a'); link.href = '/signin-with-chatgpt?return_to=%2F'; link.textContent = 'ログインする';
    ui.libraryStatus.append(link);
  }
}
ui.file.addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = ''; });
ui.titleSearch.addEventListener('input', updateList);
ui.rename.addEventListener('click', renameBook);
ui.search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(searchTerm, 250); });
ui.scope.addEventListener('change', () => {
  ui.search.placeholder = ui.scope.value ? 'この本から検索' : 'すべてのPDFから検索';
  searchTerm();
});
ui.prev.addEventListener('click', () => showPage(currentPage - 1));
ui.next.addEventListener('click', () => showPage(currentPage + 1));
ui.input.addEventListener('change', () => showPage(ui.input.value));
ui.input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { ui.input.blur(); showPage(ui.input.value); } });
ui.zoomIn.addEventListener('click', () => { zoom = Math.min(2.5, Math.round((zoom + .25) * 100) / 100); showPage(currentPage); });
ui.zoomOut.addEventListener('click', () => { zoom = Math.max(.5, Math.round((zoom - .25) * 100) / 100); showPage(currentPage); });
for (const name of ['dragenter', 'dragover']) ui.stage.addEventListener(name, (event) => { event.preventDefault(); ui.stage.classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) ui.stage.addEventListener(name, (event) => { event.preventDefault(); ui.stage.classList.remove('dragging'); });
ui.stage.addEventListener('drop', (event) => addFiles(event.dataTransfer?.files || []));
setControls(); loadLibrary();
