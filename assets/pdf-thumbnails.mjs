// Private documents are fetched through the existing authenticated API. Only
// small rendered previews are kept in memory; no PDF bytes go to a third party.
export function createThumbnailStore({render,revoke=url=>URL.revokeObjectURL(url),maxEntries=40,maxConcurrent=2}){
  const entries=new Map(),queue=[];let active=0,disposed=false;
  function trim(){
    for(const [key,entry] of entries){
      if(entries.size<=maxEntries)break;
      if(!entry.settled)continue;
      if(entry.result?.url)revoke(entry.result.url);entries.delete(key);
    }
  }
  function pump(){
    while(!disposed&&active<maxConcurrent&&queue.length){
      const {key,entry,input}=queue.shift();active++;
      Promise.resolve().then(()=>render(input)).then(result=>{
        if(disposed&&result.url)revoke(result.url);
        entry.result=result;entry.settled=true;entry.resolve(result);
      },error=>{
        if(error?.name==='AbortError'&&entries.get(key)===entry)entries.delete(key);
        const result={error:error?.name==='PasswordException'?'Password protected PDF':'Preview unavailable'};
        entry.result=result;entry.settled=true;entry.resolve(result);
      }).finally(()=>{active--;trim();pump();});
    }
  }
  return {
    get(key,input){
      if(disposed)return Promise.resolve({error:'Preview unavailable'});
      const old=entries.get(key);if(old){entries.delete(key);entries.set(key,old);return old.promise;}
      const entry={};entry.promise=new Promise(resolve=>entry.resolve=resolve);entries.set(key,entry);queue.push({key,entry,input});pump();return entry.promise;
    },
    retryFailures(){for(const [key,entry] of entries)if(entry.settled&&entry.result?.error)entries.delete(key);},
    dispose(){disposed=true;for(const entry of entries.values())if(entry.result?.url)revoke(entry.result.url);for(const {entry} of queue)entry.resolve({error:'Preview unavailable'});queue.length=0;entries.clear();}
  };
}

let enginePromise;
const vendor=new URL('./vendor/pdfjs-6.5.438/',import.meta.url);
async function renderFirstPage({id,signal}){
  enginePromise??=import(new URL('build/pdf.min.mjs',vendor).href).catch(error=>{enginePromise=null;throw error;});
  const pdfjs=await enginePromise;
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('build/pdf.worker.min.mjs',vendor).href;
  const response=await fetch('https://api.3dowon.com/api/library/'+encodeURIComponent(id)+'/file',{credentials:'include',signal,cache:'no-store'});
  if(!response.ok)throw Error('PDF fetch failed');
  const data=new Uint8Array(await response.arrayBuffer());
  const task=pdfjs.getDocument({data,cMapUrl:new URL('cmaps/',vendor).href,cMapPacked:true,standardFontDataUrl:new URL('standard_fonts/',vendor).href,wasmUrl:new URL('wasm/',vendor).href,iccUrl:new URL('iccs/',vendor).href,isEvalSupported:false,enableXfa:false,disableWorkerRendering:true,enableHWA:false});
  let canvas;
  const abort=()=>{void task.destroy();};signal?.addEventListener('abort',abort,{once:true});
  try{
    signal?.throwIfAborted();
    const pdf=await task.promise,page=await pdf.getPage(1),original=page.getViewport({scale:1});
    const viewport=page.getViewport({scale:560/Math.max(original.width,original.height)});
    canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(viewport.width));canvas.height=Math.max(1,Math.ceil(viewport.height));
    await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Empty preview')),'image/webp',.88));
    signal?.throwIfAborted();return {url:URL.createObjectURL(blob)};
  }finally{signal?.removeEventListener('abort',abort);if(canvas){canvas.width=0;canvas.height=0;}await task.destroy();}
}

export function attachPdfThumbnails(root){
  let generation=0,disposed=false;const controllers=new Set();
  const store=createThumbnailStore({render:async input=>{
    if(location.hash!=='#pdf')throw new DOMException('Page inactive','AbortError');
    const controller=new AbortController();controllers.add(controller);
    try{return await renderFirstPage({...input,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])});}
    finally{controllers.delete(controller);}
  }});
  async function show(slot){
    if(slot.dataset.loading==='true')return;slot.dataset.loading='true';
    const token=generation,key=JSON.stringify([slot.dataset.pdfPreview,slot.dataset.revision]);
    const result=await store.get(key,{id:slot.dataset.pdfPreview});
    if(disposed||!slot.isConnected||token!==generation)return;
    slot.replaceChildren();slot.classList.remove('has-preview','preview-unavailable');
    if(result.url){const img=document.createElement('img');img.src=result.url;img.alt='First page preview';img.decoding='async';slot.append(img);slot.classList.add('has-preview');}
    else{slot.textContent=result.error+' · Open PDF';slot.classList.add('preview-unavailable');}
  }
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);void show(entry.target);}
  },{rootMargin:'120px'}):null;
  function refresh(){
    generation++;observer?.disconnect();if(disposed||location.hash!=='#pdf')return;
    for(const slot of root.querySelectorAll('[data-pdf-preview]')){delete slot.dataset.loading;if(observer)observer.observe(slot);else void show(slot);}
  }
  const mutations=new MutationObserver(refresh);mutations.observe(root,{childList:true});
  const retry=()=>{store.retryFailures();refresh();};
  document.getElementById('pdfRefresh')?.addEventListener('click',retry);
  window.addEventListener('hashchange',refresh);
  window.addEventListener('pagehide',event=>{
    if(event.persisted)return;
    disposed=true;generation++;observer?.disconnect();mutations.disconnect();for(const controller of controllers)controller.abort();store.dispose();
  });
  refresh();
}

if(typeof document!=='undefined'&&document.documentElement.dataset.readonly!=='true'){
  const root=document.getElementById('pdfList');if(root)attachPdfThumbnails(root);
}
