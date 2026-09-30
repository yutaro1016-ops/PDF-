import * as pdfjsLib from './vendor/legacy/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/legacy/pdf.worker.min.mjs', import.meta.url).href;
const $ = (id) => document.getElementById(id);
const ui = {
  file: $('file-input'), list: $('document-list'), libraryStatus: $('library-status'), titleSearch: $('title-search'),
  name: $('document-name'), rename: $('rename-document'), search: $('search-input'), scope: $('search-scope'),
  scopeSummary: $('scope-summary'), scopeBooks: $('scope-books'), scopeAll: $('scope-all'), scopeNone: $('scope-none'), searchStatus: $('search-status'),
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
let selectedBookIds = null; // null means all books
const PART_BYTES = 8 * 1024 * 1024;
const MAX_PDF_BYTES = 1024 * 1024 * 1024;
const pdfOptions = { isEvalSupported: false, cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,
  cMapPacked: true, standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
  wasmUrl: new URL('./vendor/wasm/', import.meta.url).href };

function normalize(value) { return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ''); }
function setMessage(message) { ui.message.textContent = message; ui.message.hidden = !message; }
function updateScopeOptions() {
  if (selectedBookIds) {
    selectedBookIds = new Set([...selectedBookIds].filter((id) => books.some((book) => book.id === id)));
    if (selectedBookIds.size === books.length) selectedBookIds = null;
  }
  ui.scopeBooks.replaceChildren();
  for (const book of books) {
    const label = document.createElement('label'); label.className = 'scope-book';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = book.id;
    checkbox.checked = selectedBookIds === null || selectedBookIds.has(book.id);
    const title = document.createElement('span'); title.textContent = book.title;
    label.append(checkbox, title); ui.scopeBooks.append(label);
  }
  const count = selectedBookIds?.size ?? books.length;
  ui.scopeSummary.textContent = count === books.length ? 'すべての本' : count ? `${count}冊を選択中` : '対象を選択してください';
  ui.search.placeholder = count === books.length ? 'すべてのPDFから検索' : '選択した本から検索';
}
async function api(path, options) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作を完了できませんでした。');
  return result;
}
let shelves = [], currentShelf = 'all', selected = new Set(), anchorIndex = -1, visibleLimit = 80;
const shelfUi = { nav:$('shelf-navigation'), name:$('current-shelf-name'), count:$('shelf-count'), edit:$('edit-shelf'), view:$('view-mode'), sort:$('sort-mode'), batch:$('batch-bar'), selected:$('selected-count'), more:$('show-more'), toast:$('shelf-toast') };
const palette = ['#2f6078','#527a67','#a5644b','#746394','#aa7c37','#486b9b','#77594b','#597782','#8a5e73','#34495c'];
function bookColor(book) { if (book.bookColor) return book.bookColor; let hash = 0; for (const c of book.id) hash = (hash * 31 + c.charCodeAt(0)) | 0; return palette[Math.abs(hash) % palette.length]; }
function listForShelf() {
 const filter = normalize(ui.titleSearch.value.trim());
 const subset = books.filter(book => (currentShelf === 'all' || (currentShelf === 'uncategorized' ? !book.shelfId : book.shelfId === currentShelf)) && (normalize(book.title).includes(filter) || normalize(book.fileName).includes(filter)));
 const mode = shelfUi.sort.value;
 if (mode === 'manual') subset.sort((a,b) => (a.bookOrder ?? 0) - (b.bookOrder ?? 0) || a.createdAt.localeCompare(b.createdAt));
 if (mode === 'title') subset.sort((a,b) => a.title.localeCompare(b.title,'ja'));
 if (mode === 'created') subset.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
 if (mode === 'updated') subset.sort((a,b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
 if (mode === 'recent') subset.sort((a,b) => (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || ''));
 if(currentShelf==='all') { const order=new Map(shelves.map((s,i)=>[s.id,i+1]));subset.sort((a,b)=>(order.get(a.shelfId)||0)-(order.get(b.shelfId)||0)); }
 return subset;
}
function updateList() {
 const visible = listForShelf(); ui.list.replaceChildren();
 ui.libraryStatus.textContent = `${books.length}件のPDFを保存中`; shelfUi.count.textContent = `${visible.length}冊`;
 shelfUi.name.textContent = currentShelf === 'all' ? 'すべての本' : currentShelf === 'uncategorized' ? '未分類' : shelves.find(s => s.id === currentShelf)?.name || '本棚';
 shelfUi.edit.hidden = currentShelf === 'all' || currentShelf === 'uncategorized';
 const activeShelf=shelves.find(s=>s.id===currentShelf); const panel=document.querySelector('.shelf-panel'); panel.dataset.design=activeShelf?.design||'simple';panel.style.setProperty('--shelf-bg',activeShelf?.color||'#f5f8f9');panel.style.setProperty('--shelf-board',activeShelf?.boardColor||'#a7b8c1');shelfUi.name.style.color=activeShelf?.textColor||'#172d43';
 ui.list.dataset.mode = shelfUi.view.value;
 shelfUi.more.hidden = visible.length <= visibleLimit;
 let previousShelf;
 for (const [index,book] of visible.slice(0,visibleLimit).entries()) {
  if(currentShelf==='all' && book.shelfId!==previousShelf) { const heading=document.createElement('h3');heading.className='shelf-group';heading.textContent=shelves.find(s=>s.id===book.shelfId)?.name||'未分類';ui.list.append(heading);previousShelf=book.shelfId; }
  const row = document.createElement('div'); row.className = 'book-card' + (selected.has(book.id) ? ' selected' : ''); row.draggable = true; row.dataset.id = book.id; row.title = book.title;
  row.style.setProperty('--book-color',bookColor(book)); row.style.setProperty('--book-text',book.textColor || '#fff');
  const checkbox = document.createElement('input'); checkbox.type='checkbox'; checkbox.checked=selected.has(book.id); checkbox.setAttribute('aria-label',book.title+'を選択');
  checkbox.addEventListener('click', event => { event.stopPropagation(); selectBook(book,index,event); });
  const cover = document.createElement('div'); cover.className = 'book-cover';
  if (book.coverImage && !['first-page','none'].includes(book.coverImage)) { const image=document.createElement('img'); image.src=book.coverImage; image.loading='lazy'; image.alt=''; cover.append(image); }
  else if ((!book.coverImage || book.coverImage === 'first-page') && shelfUi.view.value === 'cover') { if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();makeThumbnail(book,cover);}}, {rootMargin:'100px'});observer.observe(cover);}else setTimeout(()=>makeThumbnail(book,cover),0); }
  const icon = document.createElement('span'); icon.className='book-icon'; icon.textContent=book.bookIcon === 'medical' ? '✚' : book.bookIcon === 'star' ? '★' : book.bookIcon === 'bookmark' ? '▮' : 'PDF';
  const title=document.createElement('span'); title.className='book-title'; title.textContent=book.title;
  const tags=document.createElement('span'); tags.className='book-tags'; tags.textContent=book.status!=='ready'?'保存未完了':book.pageCount && book.indexedPages<book.pageCount?'文字の取得は未完了':parseTags(book).join(' · ');
  const menu=document.createElement('button'); menu.type='button'; menu.className='book-menu'; menu.textContent='⋯'; menu.setAttribute('aria-label',book.title+'の操作'); menu.addEventListener('click',event=>{event.stopPropagation();bookMenu(book);});
  row.dataset.design=book.bookDesign||'simple';row.append(checkbox,cover,icon,title,tags,menu);
  row.addEventListener('click',event=>selectBook(book,index,event)); row.addEventListener('dblclick',()=>openBook(book));
  row.addEventListener('contextmenu',event=>{event.preventDefault();bookMenu(book);});
  let press, touchDrag=false, dragTimer;
  row.addEventListener('touchstart',()=>{press=setTimeout(()=>{if(!touchDrag)bookMenu(book);},850);dragTimer=setTimeout(()=>{touchDrag=true;row.classList.add('dragging-book');},400);},{passive:true});
  row.addEventListener('touchmove',event=>{clearTimeout(press);if(touchDrag){event.preventDefault();document.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target'));document.elementFromPoint(event.touches[0].clientX,event.touches[0].clientY)?.closest('.shelf-nav-item,.book-card')?.classList.add('drop-target');}else clearTimeout(dragTimer);},{passive:false});
  row.addEventListener('touchend',event=>{clearTimeout(press);clearTimeout(dragTimer);if(touchDrag){const touch=event.changedTouches[0],target=document.elementFromPoint(touch.clientX,touch.clientY)?.closest('.shelf-nav-item,.book-card');if(target?.classList.contains('shelf-nav-item')){const id=target.dataset.shelf;if(id&&id!=='all')moveBook(book.id,id==='uncategorized'?null:id);}else if(target?.classList.contains('book-card')&&target.dataset.id!==book.id){const destination=books.find(b=>b.id===target.dataset.id);moveBook(book.id,destination.shelfId,listForShelf().indexOf(destination));}event.preventDefault();}touchDrag=false;row.classList.remove('dragging-book');document.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target'));});
  row.addEventListener('dragstart',event=>{event.dataTransfer.setData('text/plain',book.id);event.dataTransfer.effectAllowed='move';row.classList.add('dragging-book');});
  row.addEventListener('dragend',()=>row.classList.remove('dragging-book'));
  row.addEventListener('dragover',event=>{event.preventDefault();row.classList.add('drop-target');});
  row.addEventListener('dragleave',()=>row.classList.remove('drop-target'));
  row.addEventListener('drop',async event=>{event.preventDefault();row.classList.remove('drop-target');const id=event.dataTransfer.getData('text/plain');if(id && id!==book.id) await moveBook(id,book.shelfId,index);});
  ui.list.append(row);
 }
 if (!visible.length) { const empty=document.createElement('p'); empty.className='list-empty';empty.textContent=books.length ? 'この本棚に該当するPDFはありません' : 'PDFを追加してください';ui.list.append(empty); }
 shelfUi.selected.textContent=`${selected.size}冊を選択中`; shelfUi.batch.hidden=!selected.size;
}
function parseTags(book) { try { return JSON.parse(book.tags || '[]'); } catch { return []; } }
const thumbnailCache=new Map(),thumbnailPending=new Map();
let thumbnailActive=0;const thumbnailQueue=[];
function thumbnailSlot(book){return new Promise(resolve=>{thumbnailQueue.push({size:book.fileSize||0,resolve});pumpThumbnails();});}
function pumpThumbnails(){thumbnailQueue.sort((a,b)=>a.size-b.size);while(thumbnailActive<2&&thumbnailQueue.length){thumbnailActive++;thumbnailQueue.shift().resolve();}}
function releaseThumbnail(){thumbnailActive--;pumpThumbnails();}
function thumbnailStatus(container,text){const status=document.createElement('span');status.className='thumbnail-status';status.textContent=text;container.replaceChildren(status);}
async function makeThumbnail(book,container) {
 thumbnailStatus(container,'表紙を取得中…');
 if(!thumbnailPending.has(book.id)){const job=generateThumbnail(book);thumbnailPending.set(book.id,job);job.finally(()=>thumbnailPending.delete(book.id));}
 const image=await thumbnailPending.get(book.id);
 if(!container.isConnected)return;
 if(image){container.replaceChildren(image.cloneNode());return;}
 const retry=document.createElement('button');retry.type='button';retry.className='thumbnail-retry';retry.textContent='表紙を再取得';retry.setAttribute('aria-label',book.title+'の表紙を再取得');retry.addEventListener('click',event=>{event.stopPropagation();makeThumbnail(book,container);});container.replaceChildren(retry);
}
async function generateThumbnail(book) {
 if(thumbnailCache.has(book.id))return thumbnailCache.get(book.id);
 if(book.status!=='ready')return null;
 await thumbnailSlot(book);
 let task=null,timer=null;const controller=new AbortController();
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();task?.destroy().catch(()=>{});reject(new Error('表紙取得が時間切れになりました。'));},30000);});
 try {
  const work=(async()=>{
   const path=`/api/library/${encodeURIComponent(book.id)}/thumbnail`;
   const cached=await fetch(path,{signal:controller.signal});
   if(cached.ok){const blob=await cached.blob();return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});}
   if(cached.status!==404)throw new Error('保存済み表紙を取得できませんでした。');
   task=pdfjsLib.getDocument({...pdfOptions,url:`/api/library/${encodeURIComponent(book.id)}/file`,disableStream:true,disableAutoFetch:true,rangeChunkSize:256*1024});
   const doc=await task.promise,page=await doc.getPage(1),size=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(140/size.width,180/size.height)});
   const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
   await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
   const data=canvas.toDataURL('image/jpeg',.7);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.7));
   if(blob&&blob.size<=65536&&!controller.signal.aborted)await fetch(path,{method:'PUT',headers:{'Content-Type':'image/jpeg'},body:blob,signal:controller.signal}).catch(()=>{});
   return data;
  })();
  const data=await Promise.race([work,timeout]);const image=document.createElement('img');image.src=data;image.alt='PDFの1ページ目';
  thumbnailCache.set(book.id,image);if(thumbnailCache.size>200)thumbnailCache.delete(thumbnailCache.keys().next().value);return image;
 }catch(error){console.warn('Thumbnail failed:',error);return null;}
 finally{clearTimeout(timer);controller.abort();if(task)await task.destroy().catch(()=>{});releaseThumbnail();}
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
    const task = pdfjsLib.getDocument({ ...pdfOptions, url: `/api/library/${encodeURIComponent(book.id)}/file`,
      disableStream: true, disableAutoFetch: true, rangeChunkSize: 1024 * 1024 }); activeTask = task;
    const loaded = await task.promise;
    if (id !== openId) return;
    pdf = loaded; ui.empty.hidden = true; setMessage('');
    book.lastOpenedAt = new Date().toISOString(); api(`/api/library/${encodeURIComponent(book.id)}`, { method:'PATCH', headers:{'Content-Type':'application/json'},body:JSON.stringify({lastOpenedAt:true}) }).catch(console.warn);
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
  const pageInfo = await api(`/api/library/${encodeURIComponent(book.id)}/pages`, { method: 'PATCH',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageCount: loaded.numPages }) });
  book.pageCount = pageInfo.pageCount; updateList();
  let failures = 0;
  for (let p = 1; p <= loaded.numPages; p++) {
    if (!books.includes(book)) return;
    try {
      const page = await loaded.getPage(p);
      const content = await readTextContent(page);
      const index = makeIndex(content.items);
      page.cleanup();
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
    const task = pdfjsLib.getDocument({ ...pdfOptions, url: `/api/library/${encodeURIComponent(book.id)}/file`,
      disableStream: true, disableAutoFetch: true, rangeChunkSize: 1024 * 1024 });
    try { await indexBook(book, await task.promise); } finally { await task.destroy(); }
  } catch (error) { ui.libraryStatus.textContent = error.message; }
}
async function uploadFile(id, file) {
  const path = `/api/library/${encodeURIComponent(id)}`;
  if (file.size <= PART_BYTES) {
    await api(`${path}/file`, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file });
    return;
  }
  await api(`${path}/multipart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const total = Math.ceil(file.size / PART_BYTES);
  const parts = [];
  for (let number = 1; number <= total; number++) {
    const chunk = file.slice((number - 1) * PART_BYTES, Math.min(number * PART_BYTES, file.size));
    let uploaded;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        uploaded = await api(`${path}/multipart/${number}`, { method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' }, body: chunk });
        break;
      } catch (error) { if (attempt === 2) throw error; }
    }
    parts.push(uploaded);
    ui.libraryStatus.textContent = `${file.name}を保存中… ${Math.round(number / total * 100)}%`;
  }
  await api(`${path}/multipart`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts }) });
}
async function addFiles(files) {
  const accepted = Array.from(files).filter((file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf');
  if (!accepted.length) { setMessage('PDFファイルを選択してください。'); return; }
  for (const file of accepted) {
    let newId = null; let saved = false;
    try {
      ui.libraryStatus.textContent = `${file.name}を保存中…`;
      if (file.size > MAX_PDF_BYTES) throw new Error('1GB以下のPDFを選択してください。');
      const title = file.name.replace(/\.pdf$/i, '').trim() || file.name;
      const created = await api('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, fileName: file.name, size: file.size, shelfId: currentShelf === 'all' || currentShelf === 'uncategorized' ? null : currentShelf }) });
      newId = created.id;
      await uploadFile(newId, file);
      saved = true;
      const book = { id: newId, title, fileName: file.name, fileSize: file.size, pageCount: 0,
        indexedPages: 0, status: 'ready', createdAt: new Date().toISOString(), shelfId: currentShelf === 'all' || currentShelf === 'uncategorized' ? null : currentShelf, bookOrder: Date.now(), tags: '[]' };
      books.unshift(book); updateList(); updateScopeOptions();
      if (!activeBook) openBook(book);
      try {
        ui.libraryStatus.textContent = `${file.name}を保存しました。文字を取得中…`;
        const task = pdfjsLib.getDocument({ ...pdfOptions, url: `/api/library/${encodeURIComponent(newId)}/file`,
          disableStream: true, disableAutoFetch: true, rangeChunkSize: 1024 * 1024 });
        try { await indexBook(book, await task.promise); } finally { await task.destroy(); }
      } catch (error) {
        ui.libraryStatus.textContent = `${file.name}は保存しました。文字の取得は「文字を再取得」からやり直せます。`;
        console.warn('Index failed:', error);
      }
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
  if (selectedBookIds?.size === 0) { ui.results.replaceChildren(); ui.searchStatus.textContent = '検索対象の本を選択してください'; return; }
  ui.searchStatus.textContent = '用語を検索中…';
  try {
    const params = new URLSearchParams({ q: query });
    if (selectedBookIds) for (const bookId of selectedBookIds) params.append('book', bookId);
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
    const [result, shelfResult] = await Promise.all([api('/api/library'),api('/api/shelves')]); books = result.books; shelves = shelfResult.shelves; renderNavigation(); updateList(); updateScopeOptions();
    if (books.length) { ui.empty.querySelector('h2').textContent = '本棚からPDFを選択';
      ui.empty.querySelector('p').textContent = '左の一覧から資料を選ぶか、新しいPDFを追加してください。'; }
  } catch (error) {
    ui.libraryStatus.replaceChildren(document.createTextNode(error.message + ' '));
    const link = document.createElement('a'); link.href = '/signin-with-chatgpt?return_to=%2F'; link.textContent = 'ログインする';
    ui.libraryStatus.append(link);
  }
}
function toast(message, undo) {
 shelfUi.toast.replaceChildren(document.createTextNode(message));
 if (undo) { const button=document.createElement('button');button.textContent='元に戻す';button.addEventListener('click',async()=>{await undo();shelfUi.toast.hidden=true;});shelfUi.toast.append(button); }
 shelfUi.toast.hidden=false; clearTimeout(toast.timer);toast.timer=setTimeout(()=>shelfUi.toast.hidden=true,9000);
}
function selectBook(book,index,event) {
 const visible=listForShelf();
 if(event.shiftKey && anchorIndex>=0) {const low=Math.min(index,anchorIndex),high=Math.max(index,anchorIndex);for(let n=low;n<=high;n++)selected.add(visible[n].id);}
 else if(event.ctrlKey || event.metaKey || event.target.type==='checkbox') { selected.has(book.id) ? selected.delete(book.id) : selected.add(book.id); anchorIndex=index; }
 else { selected.clear();selected.add(book.id);anchorIndex=index; }
 updateList();
}
function renderNavigation() {
 shelfUi.nav.replaceChildren();
 const entries=[{id:'all',name:'すべての本'},{id:'uncategorized',name:'未分類'},...shelves.sort((a,b)=>a.shelfOrder-b.shelfOrder)];
 for(const shelf of entries) {
  const button=document.createElement('button');button.type='button';button.className='shelf-nav-item'+(currentShelf===shelf.id?' active':'');button.dataset.shelf=shelf.id;button.textContent=`${shelf.name}  ${books.filter(b=>shelf.id==='all'||(shelf.id==='uncategorized'?!b.shelfId:b.shelfId===shelf.id)).length}`;
  button.addEventListener('click',()=>{currentShelf=shelf.id;visibleLimit=80;selected.clear();renderNavigation();updateList();});
  button.addEventListener('dragover',event=>{event.preventDefault();button.classList.add('drop-target');});button.addEventListener('dragleave',()=>button.classList.remove('drop-target'));
  button.addEventListener('drop',async event=>{event.preventDefault();button.classList.remove('drop-target');const id=event.dataTransfer.getData('text/plain');if(id && shelf.id!=='all')await moveBook(id,shelf.id==='uncategorized'?null:shelf.id);});
  if(shelf.id!=='all' && shelf.id!=='uncategorized') {
   button.draggable=true;button.addEventListener('dragstart',event=>{event.dataTransfer.setData('application/x-shelf',shelf.id);});
   button.addEventListener('drop',async event=>{const moving=event.dataTransfer.getData('application/x-shelf');if(moving && moving!==shelf.id){event.stopPropagation();const order=[...shelves].sort((a,b)=>a.shelfOrder-b.shelfOrder).filter(item=>item.id!==moving);order.splice(order.findIndex(item=>item.id===shelf.id),0,shelves.find(item=>item.id===moving));for(let i=0;i<order.length;i++)await updateShelf(order[i].id,{shelfOrder:i+1});}});
  }
  shelfUi.nav.append(button);
 }
}
async function updateBook(book, changes) {
 await api(`/api/library/${book.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes)});
 Object.assign(book,changes); if(changes.tags)book.tags=JSON.stringify(changes.tags);updateList();updateScopeOptions();
}
async function updateShelf(id,changes) {
 await api(`/api/shelves/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes)});
 Object.assign(shelves.find(s=>s.id===id),changes);renderNavigation();updateList();
}
async function normalizeShelfOrder(){const ordered=[...shelves].sort((a,b)=>a.shelfOrder-b.shelfOrder);for(let i=0;i<ordered.length;i++)await updateShelf(ordered[i].id,{shelfOrder:i+1});}
async function moveBook(id,target,index) {
 const book=books.find(b=>b.id===id);if(!book)return;
 const previous={shelfId:book.shelfId??null,bookOrder:book.bookOrder??0};
 try {
  if(Number.isInteger(index) && target === (book.shelfId??null)) {
   const items=books.filter(b=>(b.shelfId??null)===target && b.id!==id).sort((a,b)=>(a.bookOrder??0)-(b.bookOrder??0)||a.createdAt.localeCompare(b.createdAt));
   items.splice(Math.max(0,Math.min(index,items.length)),0,book);
   await api('/api/library/order',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({shelfId:target,ids:items.map(b=>b.id)})});
   items.forEach((item,i)=>item.bookOrder=i+1);shelfUi.sort.value='manual';updateList();toast('順序を変更しました。');return;
  }
  await updateBook(book,{shelfId:target,bookOrder:Date.now()});renderNavigation();
  toast('本を移動しました。',()=>updateBook(book,previous).then(renderNavigation));
 }catch(error){toast(error.message);}
}
async function editBook(book) {
 const title=prompt('PDFのタイトル',book.title);if(title!==null && title.trim() && title.trim()!==book.title)await updateBook(book,{title:title.trim()});
}
const shelfDialog=$('shelf-design-dialog'),bookDialog=$('book-design-dialog');
const shelfDesigns=[['simple','シンプル'],['modern','モダン'],['wood','木目調'],['darkwood','ダークウッド'],['lightwood','ライトウッド'],['white','白'],['black','黒'],['gray','グレー']];
const bookDesigns=[['simple','シンプル'],['modern','モダン'],['classic','クラシック'],['minimal','ミニマル']];
const colorPresets=[['#a55050','赤'],['#2f6078','青'],['#527a67','緑'],['#c9a343','黄'],['#c06e3a','オレンジ'],['#746394','紫'],['#77594b','茶'],['#ffffff','白'],['#222222','黒'],['#597782','グレー']];
let editingBook=null,editingShelf=null,coverData=null;
function choices(container, options, selected) {
 container.replaceChildren();for(const [value,label] of options){const button=document.createElement('button');button.type='button';button.dataset.value=value;button.className='choice'+(value===selected?' active':'');button.textContent=label;if(container.id==='book-color-options')button.style.setProperty('--swatch',value);if(container.id==='shelf-design-options')button.dataset.style=value;button.setAttribute('aria-pressed',String(value===selected));button.addEventListener('click',()=>{container.querySelectorAll('button').forEach(el=>{el.classList.remove('active');el.setAttribute('aria-pressed','false');});button.classList.add('active');button.setAttribute('aria-pressed','true');});container.append(button);}
}
function picked(container) {return container.querySelector('.active')?.dataset.value;}
function automaticTextColor(color){const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.35?'#172d43':'#ffffff';}
function designBook(book) {
 editingBook=book;coverData=book.coverImage||null;
 $('book-design-subtitle').textContent=book.title;
 const form=$('book-design-form');form.elements.bookColor.value=book.bookColor||bookColor(book);form.elements.textColor.value=book.textColor||automaticTextColor(form.elements.bookColor.value);form.elements.bookIcon.value=book.bookIcon||'pdf';form.elements.coverType.value=!book.coverImage||book.coverImage==='first-page'?'first-page':book.coverImage==='none'?'none':'image';
 choices($('book-design-options'),bookDesigns,book.bookDesign||'simple');
 choices($('book-color-options'),colorPresets,book.bookColor||bookColor(book));
 $('cover-upload-label').hidden=form.elements.coverType.value!=='image';form.elements.coverFile.value='';bookDialog.showModal();
}
function designShelf(shelf) {
 editingShelf=shelf;const form=$('shelf-design-form');form.elements.color.value=shelf.color||'#e9edf0';form.elements.boardColor.value=shelf.boardColor||'#a8b7bd';form.elements.textColor.value=shelf.textColor||'#172d43';choices($('shelf-design-options'),shelfDesigns,shelf.design||'simple');shelfDialog.showModal();
}
$('book-color-options').addEventListener('click',event=>{const color=event.target.closest('button')?.dataset.value;if(color){const form=$('book-design-form');form.elements.bookColor.value=color;form.elements.textColor.value=automaticTextColor(color);}});
$('book-design-form').elements.bookColor.addEventListener('input',event=>{const color=event.target.value;const options=$('book-color-options');options.querySelectorAll('button').forEach(el=>{el.classList.remove('active');el.setAttribute('aria-pressed','false');});$('book-design-form').elements.textColor.value=automaticTextColor(color);});
$('book-design-form').elements.coverType.addEventListener('change',event=>{$('cover-upload-label').hidden=event.target.value!=='image';});
$('book-design-form').elements.coverFile.addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;if(file.size>120000){toast('表紙画像は120KB以下にしてください。');event.target.value='';return;}coverData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});});
for(const dialog of [bookDialog,shelfDialog])dialog.querySelector('.dialog-cancel').addEventListener('click',()=>dialog.close());
$('book-design-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.target;const coverType=form.elements.coverType.value;if(coverType==='image'&&!coverData?.startsWith('data:image/')){toast('表紙画像を選択してください。');return;}try{await updateBook(editingBook,{bookColor:form.elements.bookColor.value,textColor:form.elements.textColor.value,bookDesign:picked($('book-design-options')),bookIcon:form.elements.bookIcon.value,coverImage:coverType==='none'?'none':coverType==='first-page'?'first-page':coverData});bookDialog.close();toast('本のデザインを保存しました。');}catch(error){toast(error.message);}});
$('shelf-design-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.target;try{await updateShelf(editingShelf.id,{design:picked($('shelf-design-options')),color:form.elements.color.value,boardColor:form.elements.boardColor.value,textColor:form.elements.textColor.value});shelfDialog.close();toast('本棚のデザインを保存しました。');}catch(error){toast(error.message);}});
async function bookMenu(book) {
 const choice=prompt(`「${book.title}」\n1 PDFを開く　2 詳細　3 本文検索　4 本棚移動　5 デザイン・色　6 名前変更　7 タグ　8 表紙画像を選択　9 削除　10 上へ　11 下へ　12 文字を再取得`,'1');
 try {
  if(choice==='1')openBook(book);
  if(choice==='2')alert(`${book.title}\n${book.fileName}\n${book.fileSize} bytes\n${book.pageCount||'—'}ページ\nタグ: ${parseTags(book).join(', ')}`);
  if(choice==='3'){selectedBookIds=new Set([book.id]);updateScopeOptions();ui.search.focus();searchTerm();}
  if(choice==='4'){const target=prompt('移動先：未分類は 0、その他は本棚名', '0');if(target!==null){const shelf=shelves.find(s=>s.name===target);if(target==='0'||shelf)await moveBook(book.id,shelf?.id||null);else toast('本棚が見つかりません。');}}
  if(choice==='5')await designBook(book);
  if(choice==='6')await editBook(book);
  if(choice==='7'){const tags=prompt('タグをカンマで区切って入力',parseTags(book).join(', '));if(tags!==null)await updateBook(book,{tags:tags.split(',').map(x=>x.trim()).filter(Boolean).slice(0,20)});}
  if(choice==='8'){const picker=document.createElement('input');picker.type='file';picker.accept='image/png,image/jpeg,image/webp';picker.onchange=()=>{const file=picker.files?.[0];if(!file||file.size>120000){toast('画像は120KB以下にしてください。');return;}const reader=new FileReader();reader.onload=()=>updateBook(book,{coverImage:reader.result}).catch(error=>toast(error.message));reader.readAsDataURL(file);};picker.click();}
  if(choice==='9')await removeBook(book);
  if(choice==='12')await reindexBook(book);
  if(choice==='10'||choice==='11'){const peers=listForShelf(),pos=peers.indexOf(book),other=peers[pos+(choice==='10'?-1:1)];if(other){const old=book.bookOrder??0;await updateBook(book,{bookOrder:other.bookOrder??0});await updateBook(other,{bookOrder:old});shelfUi.sort.value='manual';updateList();}}
 }catch(error){toast(error.message);}
}
function editShelf(){const shelf=shelves.find(s=>s.id===currentShelf);if(shelf)designShelf(shelf);}
$('rename-shelf').addEventListener('click',async()=>{const name=prompt('本棚名',editingShelf.name);if(name?.trim()){try{await updateShelf(editingShelf.id,{name:name.trim()});shelfDialog.close();}catch(error){toast(error.message);}}});
async function shiftShelf(direction){const ordered=[...shelves].sort((a,b)=>a.shelfOrder-b.shelfOrder),index=ordered.findIndex(item=>item.id===editingShelf.id),other=ordered[index+direction];if(!other)return;ordered.splice(index,1);ordered.splice(index+direction,0,editingShelf);try{for(let i=0;i<ordered.length;i++)await updateShelf(ordered[i].id,{shelfOrder:i+1});shelfDialog.close();}catch(error){toast(error.message);}}
$('shelf-up').addEventListener('click',()=>shiftShelf(-1));$('shelf-down').addEventListener('click',()=>shiftShelf(1));
$('delete-shelf').addEventListener('click',async()=>{const shelf=editingShelf,count=books.filter(b=>b.shelfId===shelf.id).length;if(!confirm(`「${shelf.name}」を削除しますか？中の${count}冊のPDFは削除せず「未分類」に移します。`))return;try{await api(`/api/shelves/${shelf.id}`,{method:'DELETE'});books.filter(b=>b.shelfId===shelf.id).forEach(b=>b.shelfId=null);shelves=shelves.filter(s=>s.id!==shelf.id);currentShelf='uncategorized';shelfDialog.close();renderNavigation();updateList();toast(`${count}冊を未分類へ移しました。`);}catch(error){toast(error.message);}});
const workspace=document.querySelector('.workspace');
const layoutKey='pdf-page-finder-layout-v1';
let paneLayout={left:240,middle:420,collapsed:{left:false,middle:false,right:false}};
try{const saved=JSON.parse(localStorage.getItem(layoutKey)||'null');if(saved && Number.isFinite(saved.left) && Number.isFinite(saved.middle))paneLayout={left:Math.max(190,Math.min(600,saved.left)),middle:Math.max(260,Math.min(1000,saved.middle)),collapsed:{...paneLayout.collapsed,...saved.collapsed}};}catch{}
function applyPaneLayout(){
 const available=Math.max(740,workspace.clientWidth||window.innerWidth);paneLayout.left=Math.min(paneLayout.left,Math.max(190,available-536));paneLayout.middle=Math.min(paneLayout.middle,Math.max(260,available-(paneLayout.collapsed.left?46:paneLayout.left)-276));
 workspace.style.setProperty('--left-width',paneLayout.collapsed.left?'46px':paneLayout.left+'px');
 workspace.style.setProperty('--middle-width',paneLayout.collapsed.middle?'46px':paneLayout.middle+'px');
 workspace.style.setProperty('--right-width',paneLayout.collapsed.right?'46px':'minmax(260px,1fr)');
 for(const pane of ['left','middle','right']){workspace.dataset[pane]=paneLayout.collapsed[pane]?'collapsed':'open';const button=document.querySelector(`.pane-toggle[data-pane="${pane}"]`);button.setAttribute('aria-expanded',String(!paneLayout.collapsed[pane]));button.setAttribute('aria-label',`${{left:'本棚・検索',middle:'保管画面',right:'PDFビューア'}[pane]}を${paneLayout.collapsed[pane]?'開く':'閉じる'}`);button.textContent=paneLayout.collapsed[pane]?'▸':pane==='right'?'▸':'◂';}
 localStorage.setItem(layoutKey,JSON.stringify(paneLayout));
}
document.querySelectorAll('.pane-toggle').forEach(button=>button.addEventListener('click',()=>{const pane=button.dataset.pane;paneLayout.collapsed[pane]=!paneLayout.collapsed[pane];applyPaneLayout();}));
for(const separator of document.querySelectorAll('.pane-resizer')){
 const key=separator.dataset.resize;
 separator.addEventListener('pointerdown',event=>{if(window.innerWidth<=750)return;event.preventDefault();separator.setPointerCapture(event.pointerId);separator.classList.add('resizing');});
 separator.addEventListener('pointermove',event=>{if(!separator.hasPointerCapture(event.pointerId))return;const rect=workspace.getBoundingClientRect();if(key==='left'){paneLayout.collapsed.left=false;paneLayout.left=Math.max(190,Math.min(600,event.clientX-rect.left));}else{paneLayout.collapsed.middle=false;paneLayout.middle=Math.max(260,Math.min(1000,event.clientX-rect.left-paneLayout.left-8));}applyPaneLayout();});
 separator.addEventListener('pointerup',event=>{separator.classList.remove('resizing');if(separator.hasPointerCapture(event.pointerId))separator.releasePointerCapture(event.pointerId);});
 separator.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();paneLayout.collapsed[key]=false;paneLayout[key]=Math.max(key==='left'?190:260,Math.min(key==='left'?600:1000,paneLayout[key]+(event.key==='ArrowRight'?20:-20)));applyPaneLayout();});
}
applyPaneLayout();window.addEventListener('resize',applyPaneLayout);
const bulkDialog=$('bulk-settings-dialog'),bulkForm=$('bulk-settings-form');
function bulkTargets(){const target=bulkForm.elements.target.value;return books.filter(book=>target==='all'||(target==='selected'?selected.has(book.id):(currentShelf==='all'||(currentShelf==='uncategorized'?!book.shelfId:book.shelfId===currentShelf))));}
function refreshBulkCount(){$('bulk-target-count').textContent=bulkTargets().length+'冊に適用します。変更しない項目はそのまま保存されます。';}
$('bulk-settings').addEventListener('click',()=>{bulkForm.reset();bulkForm.elements.target.value=selected.size?'selected':'shelf';bulkForm.elements.customColor.hidden=true;$('bulk-settings-status').textContent='';refreshBulkCount();bulkDialog.showModal();});
bulkForm.elements.target.addEventListener('change',refreshBulkCount);
bulkForm.elements.color.addEventListener('change',event=>{bulkForm.elements.customColor.hidden=event.target.value!=='custom';});
$('bulk-cancel').addEventListener('click',()=>bulkDialog.close());
bulkForm.addEventListener('submit',async event=>{event.preventDefault();const targets=bulkTargets(),changes={};if(!targets.length){$('bulk-settings-status').textContent='変更する本を選択してください。';return;}
 if(bulkForm.elements.cover.value!=='keep')changes.coverImage=bulkForm.elements.cover.value;
 if(bulkForm.elements.color.value==='custom'){changes.bookColor=bulkForm.elements.customColor.value;changes.textColor=automaticTextColor(changes.bookColor);}
 if(bulkForm.elements.design.value!=='keep')changes.bookDesign=bulkForm.elements.design.value;
 if(bulkForm.elements.icon.value!=='keep')changes.bookIcon=bulkForm.elements.icon.value;
 if(!Object.keys(changes).length){$('bulk-settings-status').textContent='変更する設定を選択してください。';return;}
 const submit=bulkForm.querySelector('[type=submit]');submit.disabled=true;let applied=0;
 try{for(let i=0;i<targets.length;i+=100){const batch=targets.slice(i,i+100);await api('/api/library/batch',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:batch.map(book=>book.id),...changes})});batch.forEach(book=>Object.assign(book,changes));applied+=batch.length;$('bulk-settings-status').textContent=applied+'冊を保存しました。';}bulkDialog.close();updateList();toast(applied+'冊の設定を変更しました。');}
 catch(error){updateList();$('bulk-settings-status').textContent=applied+'冊を保存済みです。残りは再実行できます。 '+error.message;}finally{submit.disabled=false;}
});
$('add-shelf').addEventListener('click',async()=>{const name=prompt('新しい本棚の名前');if(!name?.trim())return;try{const result=await api('/api/shelves',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})});const data=await api('/api/shelves');shelves=data.shelves;currentShelf=result.id;renderNavigation();updateList();}catch(error){toast(error.message);}});
shelfUi.edit.addEventListener('click',editShelf);
shelfUi.view.addEventListener('change',updateList);shelfUi.sort.addEventListener('change',updateList);
shelfUi.more.addEventListener('click',()=>{visibleLimit+=80;updateList();});
$('clear-selection').addEventListener('click',()=>{selected.clear();updateList();});
$('batch-search').addEventListener('click',()=>{selectedBookIds=new Set(selected);updateScopeOptions();ui.search.focus();searchTerm();});
$('search-shelf').addEventListener('click',()=>{selectedBookIds=currentShelf==='all'?null:new Set(listForShelf().map(b=>b.id));updateScopeOptions();ui.search.focus();searchTerm();});
$('batch-move').addEventListener('click',async()=>{const name=prompt('移動先：未分類は 0、その他は本棚名','0');if(name===null)return;const shelf=shelves.find(s=>s.name===name);if(name!=='0'&&!shelf)return toast('本棚が見つかりません。');const ids=[...selected],previous=ids.map(id=>({id,shelfId:books.find(b=>b.id===id)?.shelfId??null}));try{await api('/api/library/batch',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,shelfId:shelf?.id??null})});ids.forEach(id=>books.find(b=>b.id===id).shelfId=shelf?.id??null);selected.clear();renderNavigation();updateList();toast(`${ids.length}冊を移動しました。`,async()=>{for(const item of previous)await updateBook(books.find(b=>b.id===item.id),{shelfId:item.shelfId});renderNavigation();});}catch(error){toast(error.message);}});
$('batch-tags').addEventListener('click',async()=>{const raw=prompt('選択した本に設定するタグ（カンマ区切り）');if(raw===null)return;const tags=raw.split(',').map(x=>x.trim()).filter(Boolean).slice(0,20);try{await api('/api/library/batch',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[...selected],tags})});books.filter(b=>selected.has(b.id)).forEach(b=>b.tags=JSON.stringify(tags));updateList();}catch(error){toast(error.message);}});
$('batch-delete').addEventListener('click',async()=>{const ids=[...selected];if(!confirm(`${ids.length}冊のPDFと検索データを完全に削除しますか？この操作は取り消せません。`))return;for(const id of ids){try{await api(`/api/library/${id}`,{method:'DELETE'});books=books.filter(b=>b.id!==id);if(activeBook?.id===id)clearViewer();}catch(error){toast(`${id}: ${error.message}`);}}selected.clear();renderNavigation();updateList();updateScopeOptions();});
ui.file.addEventListener('change', (event) => { addFiles(event.target.files); event.target.value = ''; });
ui.titleSearch.addEventListener('input', updateList);
ui.rename.addEventListener('click', renameBook);
ui.search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(searchTerm, 250); });
ui.scopeBooks.addEventListener('change', (event) => {
  if (!event.target.matches('input[type="checkbox"]')) return;
  selectedBookIds ??= new Set(books.map((book) => book.id));
  if (event.target.checked) selectedBookIds.add(event.target.value);
  else selectedBookIds.delete(event.target.value);
  updateScopeOptions(); searchTerm();
});
ui.scopeAll.addEventListener('click', () => { selectedBookIds = null; updateScopeOptions(); searchTerm(); });
ui.scopeNone.addEventListener('click', () => { selectedBookIds = new Set(); updateScopeOptions(); searchTerm(); });
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
