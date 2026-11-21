/* Project reference boards with local cache and optional private GitHub sync. */
globalThis.IdeaModel = (() => {
  const imageType=/^image\/(png|jpeg|gif|webp|avif)$/i;
  const MAX_IMAGE=20*1024*1024;
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  function url(value){try{const u=new URL(String(value).trim());return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u:null;}catch{return null;}}
  function media(value){
    const u=url(value);if(!u)return null;
    const host=u.hostname.toLowerCase().replace(/^www\./,''),parts=u.pathname.split('/').filter(Boolean);
    let id;
    if(host==='youtu.be')id=parts[0];
    if(['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host))id=u.pathname==='/watch'?u.searchParams.get('v'):['embed','shorts','live'].includes(parts[0])?parts[1]:null;
    if(id&&/^[A-Za-z0-9_-]{11}$/.test(id)){
      const embed=new URL('https://www.youtube-nocookie.com/embed/'+id),raw=u.searchParams.get('start')||u.searchParams.get('t')||'';
      const units=raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
      const seconds=/^\d+$/.test(raw)?Number(raw):units?Number(units[1]||0)*3600+Number(units[2]||0)*60+Number(units[3]||0):0;
      if(seconds>0)embed.searchParams.set('start',String(Math.min(seconds,604800)));
      return {kind:'embed',provider:'YouTube',url:u.href,embed:embed.href};
    }
    if(['vimeo.com','player.vimeo.com'].includes(host)){
      const match=u.pathname.match(/^\/(?:video\/)?(\d+)(?:\/([A-Za-z0-9]+))?\/?$/);
      if(match){const embed=new URL('https://player.vimeo.com/video/'+match[1]),hash=u.searchParams.get('h')||match[2];if(hash&&/^[A-Za-z0-9]+$/.test(hash))embed.searchParams.set('h',hash);return {kind:'embed',provider:'Vimeo',url:u.href,embed:embed.href};}
    }
    if(/\.(mp4|webm|ogv|ogg)$/i.test(u.pathname))return {kind:'video',provider:'영상',url:u.href};
    if(/\.(png|jpe?g|gif|webp|avif)$/i.test(u.pathname))return {kind:'image',provider:'이미지',url:u.href};
    return {kind:'link',provider:u.hostname,url:u.href};
  }
  function cleanItem(item){
    if(!item||!['image','embed','video','link','note'].includes(item.kind))throw Error('지원하지 않는 카드 형식입니다.');
    const finite=(v,fallback)=>Number.isFinite(v)?v:fallback;
    const clean={id:String(item.id||crypto.randomUUID()),kind:item.kind,title:String(item.title||'제목 없음').slice(0,200),text:String(item.text||'').slice(0,20000),x:clamp(finite(item.x,0),-100000,100000),y:clamp(finite(item.y,0),-100000,100000),width:clamp(finite(item.width,320),180,1200),ratio:clamp(finite(item.ratio,16/9),0.1,10)};
    if(item.kind==='note')return clean;
    if(item.kind==='image'&&item.asset&&/^[a-f0-9]{40}$/.test(item.asset.sha)&&imageType.test(item.asset.type))clean.asset={sha:item.asset.sha,type:item.asset.type};
    if(item.kind==='image'&&item.blob){if(!imageType.test(item.blob.type)||item.blob.size>MAX_IMAGE)throw Error('이미지는 PNG/JPG/GIF/WebP/AVIF, 20MB 이하만 지원합니다.');clean.blob=item.blob;return clean;}
    if(clean.asset&&!item.url)return clean;
    const source=media(item.url);if(!source)throw Error('올바른 http 또는 https 주소를 입력해 주세요.');
    if(item.kind==='image'){clean.url=source.url;return clean;}
    // Rebuild embed addresses from an allowlisted provider; never trust saved iframe HTML/URLs.
    return {...clean,...source};
  }
  function point(clientX,clientY,bounds,view){return {x:(clientX-bounds.left-view.x)/view.zoom,y:(clientY-bounds.top-view.y)/view.zoom};}
  function zoomAt(view,next,anchor){const zoom=clamp(next,0.2,2);return {zoom,x:anchor.x-(anchor.x-view.x)*zoom/view.zoom,y:anchor.y-(anchor.y-view.y)*zoom/view.zoom};}
  function history(){const past=[],future=[];const copy=items=>items.map(i=>({...i}));return {
    push(items){past.push(copy(items));if(past.length>40)past.shift();future.length=0;},
    undo(items){if(!past.length)return null;future.push(copy(items));return past.pop();},
    redo(items){if(!future.length)return null;past.push(copy(items));return future.pop();},
    get canUndo(){return !!past.length;},get canRedo(){return !!future.length;}
  };}
  function store(factory=globalThis.indexedDB){
    let opened;
    function db(){return opened||(opened=new Promise((resolve,reject)=>{if(!factory){reject(Error('이 브라우저에서 보드 저장소를 열 수 없어요.'));return;}const r=factory.open('dowon-reference-boards',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('boards'))r.result.createObjectStore('boards',{keyPath:'projectId'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('다른 탭을 닫고 다시 시도해 주세요.'));}));}
    async function transaction(mode,action){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('boards',mode),r=action(tx.objectStore('boards'));tx.oncomplete=()=>resolve(r.result);tx.onabort=()=>reject(tx.error||Error('저장하지 못했어요.'));tx.onerror=()=>reject(tx.error);});}
    return {get:id=>transaction('readonly',s=>s.get(id)),all:()=>transaction('readonly',s=>s.getAll()),put:record=>transaction('readwrite',s=>s.put(record))};
  }
  async function cardBoardId(projectId,milestoneId){
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([projectId,milestoneId])));
    return 'milestone:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  }
  return {cardBoardId,imageType,MAX_IMAGE,clamp,url,media,cleanItem,point,zoomAt,history,store};
})();

globalThis.IdeasBoard = {
  attach({getProjects,createProject,isActive,readonly=false,storage=IdeaModel.store()}){
    if(globalThis.IdeaCloud&&!readonly)storage=IdeaCloud.create(storage);
    const $=id=>document.getElementById(id),viewport=$('ideasViewport'),world=$('ideasWorld'),selector=$('ideasProject');
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const uid=()=>crypto.randomUUID(),records=new Map(),histories=new Map(),objectUrls=new Map(),failures=new Set();
    let scope=null,normalProject=null,scopeToken=0;
    let current=null,selected=null,loading=true,initialized=false,drag=null,space=false,saveQueue=Promise.resolve(),loadToken=0,modalKind=null,editing=null,lastPoint=null,viewTimer=null,renderPending=false;
    const empty=project=>({projectId:project.id,name:project.name,items:[],view:{x:40,y:40,zoom:1},updatedAt:new Date().toISOString()});
    const activeRecord=()=>{const r=records.get(current);return r?._stub?undefined:r;},history=()=>histories.get(current);
    const message=(text,error=false)=>{$('ideasStatus').textContent=text;$('ideasStatus').classList.toggle('ideas-error',error);};
    function controls(){const ready=!!activeRecord()&&!loading&&!readonly,item=activeRecord()?.items.find(i=>i.id===selected);for(const name of ['ideasImage','ideasLink','ideasNote','ideasImport','ideasRetry'])$(name).disabled=!ready;$('ideasUndo').disabled=!ready||!history()?.canUndo;$('ideasRedo').disabled=!ready||!history()?.canRedo;$('ideasDelete').disabled=!ready||!selected;$('ideasEdit').disabled=!ready||!item||(item.kind!=='note'&&!item.url);$('ideasEdit').textContent=item?.kind==='note'?'메모 입력':'링크 수정';$('ideasExport').disabled=!activeRecord()||loading;$('ideasNewProject').disabled=readonly||!!scope;for(const name of ['ideasZoomIn','ideasZoomOut','ideasFit'])$(name).disabled=!activeRecord()||loading;}
    function queueSave(record){
      if(readonly)return Promise.resolve();
      record.updatedAt=new Date().toISOString();const snapshot={...record,view:{...record.view},items:record.items.map(i=>({...i}))};
      if(current===record.projectId)message('저장 중…');
      saveQueue=saveQueue.catch(()=>{}).then(()=>storage.put(snapshot)).then(()=>{failures.delete(record.projectId);if(current===record.projectId)message(storage.isCloud?storage.message(current):'● 이 브라우저에 자동 저장됨');},()=>{failures.add(record.projectId);if(current===record.projectId)message('저장 실패 · 보드 백업으로 보관하거나 다시 저장해 주세요.',true);});
      return saveQueue;
    }
    function applyView(){const r=activeRecord();if(!r)return;world.style.transform=`translate(${r.view.x}px,${r.view.y}px) scale(${r.view.zoom})`;viewport.style.backgroundPosition=`${r.view.x}px ${r.view.y}px`;viewport.style.backgroundSize=`${24*r.view.zoom}px ${24*r.view.zoom}px`;$('ideasZoom').textContent=Math.round(r.view.zoom*100)+'%';}
    function saveView(){clearTimeout(viewTimer);const record=activeRecord();if(record)viewTimer=setTimeout(()=>queueSave(record),250);}
    function select(id){selected=id;for(const el of world.querySelectorAll('.idea-card')){const active=el.dataset.ideaId===id;el.classList.toggle('is-selected',active);el.setAttribute('aria-selected',String(active));}controls();}
    function imageSrc(item){if(!item.blob)return item.url;if(!objectUrls.has(item.id))objectUrls.set(item.id,URL.createObjectURL(item.blob));return objectUrls.get(item.id);}
    function sizeNote(note){note.style.height='auto';note.style.height=Math.min(1200,Math.max(160,note.scrollHeight))+'px';}
    const editingNote=()=>world.contains(document.activeElement)&&document.activeElement.matches('textarea.idea-note');
    function focusNote(id){const card=[...world.children].find(el=>el.dataset.ideaId===id),note=card?.querySelector('textarea.idea-note');if(note){select(id);note.focus({preventScroll:true});}}
    function render(){
      const focused=editingNote()?document.activeElement:null;
      if(focused?.dataset.composing==='true'){renderPending=true;return;}renderPending=false;
      const caret=focused?{id:focused.closest('[data-idea-id]').dataset.ideaId,start:focused.selectionStart,end:focused.selectionEnd}:null;
      const record=activeRecord();
      for(const url of objectUrls.values())URL.revokeObjectURL(url);objectUrls.clear();
      world.replaceChildren();
      $('ideasEmpty').hidden=!!record?.items.length||loading;
      $('ideasEmptyTitle').textContent=record?'복사한 이미지를 여기에 붙여넣으세요':'프로젝트를 선택해 보드를 시작하세요';
      $('ideasCount').textContent=record?`${record.items.length}개 자료`:'';
      if(!record){controls();return;}
      if(!record.items.some(i=>i.id===selected))selected=null;
      for(const item of record.items){
        const el=document.createElement('article');el.className='idea-card';el.dataset.ideaId=item.id;el.dataset.kind=item.kind;el.tabIndex=0;el.setAttribute('role','group');el.setAttribute('aria-label',item.title);el.style.left=item.x+'px';el.style.top=item.y+'px';el.style.width=item.width+'px';
        const source=item.url?IdeaModel.media(item.url):null;
        let body='';
        if(item.kind==='image')body=`<img src="${esc(imageSrc(item))}" alt="${esc(item.title)}" draggable="false" style="aspect-ratio:${item.ratio}" loading="lazy">`;
        else if(item.kind==='embed')body=`<iframe src="${esc(source.embed)}" title="${esc(item.title)}" loading="lazy" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
        else if(item.kind==='video')body=`<video src="${esc(item.url)}" controls preload="metadata" playsinline></video>`;
        else if(item.kind==='note')body=`<textarea class="idea-note" aria-label="메모 내용" placeholder="여기에 입력하세요" maxlength="20000" spellcheck="false"${readonly?' readonly':''}>${esc(item.text)}</textarea>`;
        else body=`<a class="idea-link-preview" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><span>↗</span><strong>${esc(source.provider)}</strong><small>${esc(item.url)}</small></a>`;
        el.innerHTML=`<div class="idea-card-body">${body}</div><button type="button" class="idea-move" data-idea-move aria-label="카드 이동. 드래그하거나 방향키로 이동" title="드래그하여 이동">⠿</button>${item.url?`<a class="idea-original" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" aria-label="원본 열기" title="원본 열기">↗</a>`:''}<button class="idea-resize" data-idea-resize aria-label="크기 조절. 방향키로 조절">◢</button>`;
        el.querySelector('img')?.addEventListener('error',()=>{const info=document.createElement('p');info.className='idea-media-error';info.textContent='이미지를 불러올 수 없어요. 원본 링크를 확인해 주세요.';el.querySelector('.idea-card-body').replaceChildren(info);});
        el.querySelector('[data-idea-move]').disabled=readonly;el.querySelector('[data-idea-resize]').disabled=readonly;
        world.append(el);
        const note=el.querySelector('textarea.idea-note');
        if(note){
          note.value=item.text;
          let checkpoint=false;
          note.addEventListener('focus',()=>{checkpoint=false;select(item.id);});
          note.addEventListener('input',()=>{
            if(readonly)return;
            const currentItem=record.items.find(i=>i.id===item.id);if(!currentItem||currentItem.text===note.value)return;
            if(!checkpoint){histories.get(record.projectId)?.push(record.items);checkpoint=true;}
            currentItem.text=note.value;sizeNote(note);queueSave(record);controls();
          });
          note.addEventListener('compositionstart',()=>{note.dataset.composing='true';});
          note.addEventListener('compositionend',()=>{note.dataset.composing='false';setTimeout(()=>{if(renderPending)render();},0);});
          sizeNote(note);
        }
      }
      applyView();select(selected);
      if(caret){const note=[...world.children].find(el=>el.dataset.ideaId===caret.id)?.querySelector('textarea.idea-note');if(note){note.focus({preventScroll:true});note.setSelectionRange(caret.start,caret.end);}}
    }
    function options(){
      const projects=scope?[scope]:getProjects(),extra=scope?[]:[...records.values()].filter(r=>!r.projectId.startsWith('milestone:')&&!projects.some(p=>p.id===r.projectId)),list=[...projects.map(p=>({...p,name:p.name+(storage.isCloud&&extra.some(r=>r.name===p.name)?' (이 기기 프로젝트)':'')})),...extra.map(r=>({id:r.projectId,name:r.name+(storage.isCloud?(projects.some(p=>p.name===r.name)?' (GitHub)':''):' (보관됨)')}))];
      selector.innerHTML=list.length?list.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''):'<option value="">프로젝트 없음</option>';
      selector.value=current||list[0]?.id||'';
      return list;
    }
    async function switchProject(projectId){
      cancelDrag();const token=++loadToken;drag=null;space=false;viewport.classList.remove('is-panning');selected=null;lastPoint=null;current=projectId||null;loading=true;render();
      try{
        await saveQueue;
        if(projectId&&(storage.isCloud||!records.has(projectId))){const saved=await storage.get(projectId),project=scope?.id===projectId?scope:getProjects().find(p=>p.id===projectId);if(saved){saved.items=saved.items.map(IdeaModel.cleanItem);saved.view=validView(saved.view);records.set(projectId,saved);}else if(project)records.set(projectId,empty(project));else if(records.get(projectId)?._stub)throw Error('보드를 불러오지 못했어요.');}
        if(token!==loadToken)return;
        if(scope?.id===current&&records.has(current))records.get(current).name=scope.name;
        if(current&&!histories.has(current))histories.set(current,IdeaModel.history());
        if(!scope)try{localStorage.setItem('dowon-ideas:project',current||'');}catch{}
        message(failures.has(current)?'이 보드에 저장하지 못한 변경이 있어요. 다시 저장하거나 백업해 주세요.':storage.isCloud?storage.message(current):'● 이 브라우저에 자동 저장 · 프로젝트별 보드',failures.has(current));
      }catch{message('보드를 불러오지 못했어요. 페이지를 새로고침해 다시 시도해 주세요.',true);}
      finally{if(token===loadToken){loading=false;options();render();}}
    }
    function validView(value){return {x:Number.isFinite(value?.x)?value.x:40,y:Number.isFinite(value?.y)?value.y:40,zoom:IdeaModel.clamp(Number.isFinite(value?.zoom)?value.zoom:1,0.2,2)};}
    function refreshProjects(){
      if(scope){options();return;}
      const projects=getProjects(),r=records.get(current);
      // A fresh device's empty placeholder disappears when the shared catalog arrives.
      if(initialized&&current&&!projects.some(p=>p.id===current)&&r&&!r._stub&&!r._cloudRevision&&!r.items.length){records.delete(current);histories.delete(current);current=null;}
      for(const p of projects){const record=records.get(p.id);if(record)record.name=p.name;}
      const list=options();if(initialized&&!current&&list.length)switchProject(list[0].id);
    }
    function mutate(record,change){if(readonly)return;let h=histories.get(record.projectId);if(!h){h=IdeaModel.history();histories.set(record.projectId,h);}h.push(record.items);change(record.items);queueSave(record);if(record.projectId===current)render();}
    function insertionPoint(){const r=activeRecord(),bounds=viewport.getBoundingClientRect();return lastPoint||IdeaModel.point(bounds.left+bounds.width/2,bounds.top+bounds.height/2,bounds,r.view);}
    function addItems(record,items,point){
      if(!items.length)return;
      const prepared=items.map((item,i)=>IdeaModel.cleanItem({...item,id:uid(),x:point.x-160+i*32,y:point.y-70+i*32}));mutate(record,list=>list.push(...prepared));
      if(current===record.projectId&&!editingNote())select(record.items.at(-1).id);
    }
    async function imageCard(file){
      if(!IdeaModel.imageType.test(file.type)||file.size>IdeaModel.MAX_IMAGE)throw Error('PNG/JPG/GIF/WebP/AVIF 이미지를 사용해 주세요. 파일당 최대 20MB입니다.');
      const src=URL.createObjectURL(file);
      try{const size=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>reject(Error('읽을 수 없는 이미지입니다.'));img.src=src;});const ratio=size.width/size.height;return {kind:'image',blob:file,title:file.name&&file.name!=='image.png'?file.name:'붙여넣은 이미지',ratio,width:IdeaModel.clamp(Math.min(360,400*ratio),180,600)};}finally{URL.revokeObjectURL(src);}
    }
    async function ingest({files=[],text='',html=''},point){
      const record=activeRecord();if(!record||loading||readonly)return;
      point=point||insertionPoint();message('자료를 추가하고 있어요…');
      try{
        let items=[];
        if(files.length){const results=await Promise.allSettled(files.map(imageCard));items=results.filter(r=>r.status==='fulfilled').map(r=>r.value);const failed=results.filter(r=>r.status==='rejected');if(failed.length&&current===record.projectId)message(failed[0].reason.message,true);if(items.length)addItems(record,items,point);if(failed.length){await saveQueue;if(current===record.projectId)message(`${items.length}개 추가 · ${failed.length}개 제외: ${failed[0].reason.message}`,true);}return;}
        if(html){const doc=new DOMParser().parseFromString(html,'text/html'),src=doc.querySelector('img')?.getAttribute('src');if(IdeaModel.url(src))items=[{kind:'image',url:src,title:doc.querySelector('img').getAttribute('alt')||'이미지 레퍼런스',width:320,ratio:16/9}];}
        if(!items.length&&text.trim()){
          const lines=text.trim().split(/\r?\n/).filter(Boolean),links=lines.map(IdeaModel.media);
          items=links.every(Boolean)?links.map(m=>({...m,title:m.provider+' 레퍼런스',width:['embed','video'].includes(m.kind)?400:320,ratio:16/9})):[{kind:'note',title:'아이디어 메모',text:text.trim(),width:300}];
        }
        addItems(record,items,point);
      }catch(error){if(current===record.projectId)message(error.message,true);}
    }
    function transfer(data){const files=[...(data?.files||[])];if(!files.length)for(const item of data?.items||[])if(item.kind==='file'){const file=item.getAsFile();if(file)files.push(file);}return {files,text:data?.getData('text/plain')||data?.getData('text/uri-list')?.split('\n').find(s=>s&&!s.startsWith('#'))||'',html:data?.getData('text/html')||''};}
    const typing=target=>!!target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
    document.addEventListener('paste',e=>{if(!isActive()||readonly||loading||!current||typing(e.target)||$('ideasModal').open)return;const data=transfer(e.clipboardData);if(!data.files.length&&!data.text&&!data.html)return;e.preventDefault();ingest(data);});
    viewport.addEventListener('dragover',e=>{if(readonly||!activeRecord())return;e.preventDefault();viewport.classList.add('is-drop');});
    viewport.addEventListener('dragleave',e=>{if(!viewport.contains(e.relatedTarget))viewport.classList.remove('is-drop');});
    viewport.addEventListener('drop',e=>{e.preventDefault();viewport.classList.remove('is-drop');if(readonly||loading||!activeRecord())return;ingest(transfer(e.dataTransfer),IdeaModel.point(e.clientX,e.clientY,viewport.getBoundingClientRect(),activeRecord().view));});
    function openModal(kind,item=null){if(readonly)return;modalKind=kind;editing=item?.id||null;$('ideasModalTitle').textContent={project:'프로젝트 추가',link:'영상·링크 추가',note:'메모 추가',edit:'카드 수정'}[kind];$('ideasName').closest('label').hidden=kind!=='project';$('ideasName').value=kind==='project'?'':item?.title||'';$('ideasText').value=item?.kind==='note'?item.text:item?.url||'';$('ideasTextLabel').hidden=kind==='project'||(kind==='edit'&&item?.kind==='image'&&!!item.blob);$('ideasTextCaption').textContent=kind==='note'||item?.kind==='note'?'메모':'영상 또는 이미지 URL';$('ideasModalError').textContent='';$('ideasModal').showModal();(kind==='project'?$('ideasName'):$('ideasText')).focus();}
    function editSelected(){const item=activeRecord()?.items.find(i=>i.id===selected);if(item?.kind==='note')focusNote(item.id);else if(item?.url)openModal('edit',item);}
    $('ideasForm').onsubmit=e=>{e.preventDefault();const title=$('ideasName').value.trim(),text=$('ideasText').value.trim();try{
      if(modalKind==='project'){if(!title)throw Error('프로젝트 이름을 입력해 주세요.');const project=createProject(title);$('ideasModal').close();refreshProjects();switchProject(project.id);return;}
      const record=activeRecord();if(!record)throw Error('프로젝트를 선택해 주세요.');
      if(modalKind==='edit'){const item=record.items.find(i=>i.id===editing);if(!item)throw Error('카드를 찾을 수 없어요.');let next={...item,title:title||item.title};if(item.kind==='note')next.text=text;else if(!item.blob){const m=IdeaModel.media(text);if(!m)throw Error('올바른 URL을 입력해 주세요.');next={...next,...m};}next=IdeaModel.cleanItem(next);mutate(record,items=>{items[items.findIndex(i=>i.id===editing)]=next;});}
      else if(modalKind==='note')addItems(record,[{kind:'note',title:title||'아이디어 메모',text,width:300}],insertionPoint());
      else {const m=IdeaModel.media(text);if(!m)throw Error('http 또는 https로 시작하는 URL을 입력해 주세요.');addItems(record,[{...m,title:title||m.provider+' 레퍼런스',width:['embed','video'].includes(m.kind)?400:320}],insertionPoint());}
      $('ideasModal').close();viewport.focus();
    }catch(error){$('ideasModalError').textContent=error.message;}};
    $('ideasCancel').onclick=()=>$('ideasModal').close();$('ideasNewProject').onclick=()=>openModal('project');$('ideasLink').onclick=()=>openModal('link');$('ideasNote').onclick=()=>{const r=activeRecord();if(!r||readonly||loading)return;addItems(r,[{kind:'note',title:'메모',text:'',width:300}],insertionPoint());focusNote(r.items.at(-1).id);};$('ideasEdit').onclick=editSelected;
    $('ideasImage').onclick=()=>$('ideasFiles').click();$('ideasFiles').onchange=()=>{ingest({files:[...$('ideasFiles').files]});$('ideasFiles').value='';};
    selector.onchange=()=>switchProject(selector.value);
    function remove(){const r=activeRecord();if(!readonly&&r?.items.some(i=>i.id===selected))mutate(r,items=>items.splice(items.findIndex(i=>i.id===selected),1));}
    function undoRedo(kind){if(readonly||loading)return;cancelDrag();const r=activeRecord(),next=r&&history()?.[kind](r.items);if(next){r.items=next;queueSave(r);render();}}
    $('ideasDelete').onclick=remove;$('ideasUndo').onclick=()=>undoRedo('undo');$('ideasRedo').onclick=()=>undoRedo('redo');$('ideasRetry').onclick=async()=>{if(activeRecord()){await queueSave(activeRecord());if(storage.isCloud){await storage.retry(current);await syncCloud();}}};
    function zoom(next,anchor){const r=activeRecord();if(!r)return;const bounds=viewport.getBoundingClientRect();r.view=IdeaModel.zoomAt(r.view,next,anchor||{x:bounds.width/2,y:bounds.height/2});applyView();saveView();}
    $('ideasZoomIn').onclick=()=>zoom(activeRecord().view.zoom*1.2);$('ideasZoomOut').onclick=()=>zoom(activeRecord().view.zoom/1.2);
    $('ideasFit').onclick=()=>{const r=activeRecord();if(!r)return;const bounds=viewport.getBoundingClientRect();if(!r.items.length)r.view={x:40,y:40,zoom:1};else{const left=Math.min(...r.items.map(i=>i.x)),top=Math.min(...r.items.map(i=>i.y)),right=Math.max(...r.items.map(i=>i.x+i.width)),bottom=Math.max(...r.items.map(i=>i.y+(world.querySelector(`[data-idea-id="${CSS.escape(i.id)}"]`)?.offsetHeight||300)));const z=IdeaModel.clamp(Math.min((bounds.width-80)/(right-left),(bounds.height-80)/(bottom-top),1),.2,2);r.view={zoom:z,x:(bounds.width-(right-left)*z)/2-left*z,y:(bounds.height-(bottom-top)*z)/2-top*z};}applyView();saveView();};
    viewport.addEventListener('wheel',e=>{if(!activeRecord()||(typing(e.target)&&!e.ctrlKey&&!e.metaKey))return;e.preventDefault();const r=activeRecord(),bounds=viewport.getBoundingClientRect();if(e.ctrlKey||e.metaKey)zoom(r.view.zoom*Math.exp(-e.deltaY*.002),{x:e.clientX-bounds.left,y:e.clientY-bounds.top});else{r.view.x-=e.deltaX;r.view.y-=e.deltaY;applyView();saveView();}},{passive:false});
    viewport.addEventListener('pointerdown',e=>{
      if(!activeRecord()||loading||![0,1].includes(e.button)||e.target.closest('iframe,video,a,input,textarea'))return;
      const card=e.target.closest('[data-idea-id]'),resize=e.target.closest('[data-idea-resize]'),move=e.target.closest('[data-idea-move]');
      if(e.target.closest('button')&&!resize&&!move)return;
      if(readonly&&card&&!space)return;
      e.preventDefault();viewport.focus();const r=activeRecord();
      if(!card||space||e.button===1){select(null);drag={type:'pan',x:e.clientX,y:e.clientY,before:{...r.view},id:e.pointerId};viewport.classList.add('is-panning');}
      else {select(card.dataset.ideaId);const item=r.items.find(i=>i.id===selected);drag={type:resize?'resize':'move',x:e.clientX,y:e.clientY,before:{...item},item,id:e.pointerId,moved:false};}
      viewport.setPointerCapture?.(e.pointerId);
    });
    viewport.addEventListener('pointermove',e=>{
      const r=activeRecord();if(!r)return;
      lastPoint=IdeaModel.point(e.clientX,e.clientY,viewport.getBoundingClientRect(),r.view);
      if(!drag||drag.id!==e.pointerId)return;
      const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      if(drag.type==='pan'){r.view.x=drag.before.x+dx;r.view.y=drag.before.y+dy;applyView();return;}
      if(Math.hypot(dx,dy)<4&&!drag.moved)return;drag.moved=true;
      const el=[...world.children].find(el=>el.dataset.ideaId===drag.item.id);
      const preview=drag.after={...drag.before};
      if(drag.type==='move'){preview.x=IdeaModel.clamp(drag.before.x+dx/r.view.zoom,-100000,100000);preview.y=IdeaModel.clamp(drag.before.y+dy/r.view.zoom,-100000,100000);el.style.left=preview.x+'px';el.style.top=preview.y+'px';}
      else {preview.width=IdeaModel.clamp(drag.before.width+dx/r.view.zoom,180,1200);el.style.width=preview.width+'px';const note=el.querySelector('textarea.idea-note');if(note)sizeNote(note);}
    });
    viewport.addEventListener('pointerleave',()=>{if(!drag)lastPoint=null;});
    viewport.addEventListener('pointerup',e=>{if(!drag||drag.id!==e.pointerId)return;const d=drag;drag=null;viewport.classList.remove('is-panning');if(viewport.hasPointerCapture?.(e.pointerId))viewport.releasePointerCapture(e.pointerId);if(d.type==='pan'){saveView();return;}if(d.moved){const r=activeRecord();history().push(r.items);Object.assign(d.item,d.after);queueSave(r);controls();}});
    function cancelDrag(){if(!drag)return;const d=drag;drag=null;viewport.classList.remove('is-panning');if(d.type==='pan')activeRecord().view=d.before;render();}
    viewport.addEventListener('pointercancel',cancelDrag);viewport.addEventListener('lostpointercapture',()=>{if(drag)cancelDrag();});
    world.addEventListener('click',e=>{const card=e.target.closest('[data-idea-id]');if(card)select(card.dataset.ideaId);});
    world.addEventListener('dblclick',e=>{const card=e.target.closest('[data-idea-id]');if(card&&!e.target.closest('a,video,iframe,button,input,textarea')){select(card.dataset.ideaId);editSelected();}});
    document.addEventListener('keydown',e=>{
      if(!isActive()||typing(e.target)||$('ideasModal').open||loading)return;
      if(e.code==='Space'){if(!e.target.closest('button')){e.preventDefault();space=true;}return;}
      if(e.key==='Escape'){cancelDrag();select(null);return;}
      if(readonly)return;
      const key=e.key.toLowerCase();if((e.ctrlKey||e.metaKey)&&['z','y'].includes(key)){e.preventDefault();undoRedo(key==='y'||e.shiftKey?'redo':'undo');return;}
      if((e.key==='Delete'||e.key==='Backspace')&&selected){e.preventDefault();remove();return;}
      const card=e.target.closest('[data-idea-id]');if(card&&e.key==='Enter'){e.preventDefault();select(card.dataset.ideaId);editSelected();return;}
      if(selected&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const step=e.shiftKey?20:5;mutate(activeRecord(),items=>{const item=items.find(i=>i.id===selected);if(e.target.closest('[data-idea-resize]'))item.width=IdeaModel.clamp(item.width+(e.key==='ArrowLeft'||e.key==='ArrowUp'?-step:step),180,1200);else if(e.key.includes('Left')||e.key.includes('Right'))item.x+=e.key==='ArrowLeft'?-step:step;else item.y+=e.key==='ArrowUp'?-step:step;});viewport.focus();}
    });
    document.addEventListener('keyup',e=>{if(e.code==='Space')space=false;});window.addEventListener('blur',()=>{space=false;cancelDrag();});
    function dataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
    $('ideasExport').onclick=async()=>{const r=activeRecord();if(!r)return;try{const items=await Promise.all(r.items.map(async i=>{const {blob,...item}=i;return blob?{...item,data:await dataUrl(blob)}:item;}));const blob=new Blob([JSON.stringify({version:1,name:r.name,items},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(r.name||'레퍼런스').replace(/[<>:"/\\|?*]/g,'-')+'-보드.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('이미지를 포함한 보드 백업을 내려받았어요.');}catch{message('백업에 실패했어요. 다시 시도해 주세요.',true);}};
    $('ideasImport').onclick=()=>$('ideasBackupFile').click();
    $('ideasBackupFile').onchange=async()=>{const file=$('ideasBackupFile').files[0],r=activeRecord();$('ideasBackupFile').value='';if(!file||!r||readonly)return;try{if(file.size>100*1024*1024)throw Error('백업 파일은 100MB 이하만 불러올 수 있어요.');const data=JSON.parse(await file.text());if(data.version!==1||!Array.isArray(data.items)||data.items.length>1000)throw Error('올바른 보드 백업 파일이 아닙니다.');const items=data.items.map(item=>{let blob;if(item.data){const match=String(item.data).match(/^data:(image\/(?:png|jpeg|gif|webp|avif));base64,([A-Za-z0-9+/=]+)$/);if(!match)throw Error('지원하지 않는 이미지 데이터입니다.');const binary=atob(match[2]);blob=new Blob([Uint8Array.from(binary,c=>c.charCodeAt(0))],{type:match[1]});}return IdeaModel.cleanItem({...item,id:uid(),blob});});mutate(r,list=>list.push(...items));if(current===r.projectId)$('ideasFit').click();}catch(error){message('불러오기 실패: '+error.message,true);}};
    let syncing=false;
    function cloudStatus(){
      if(!storage.isCloud)return;
      if($('ideasConnect'))$('ideasConnect').hidden=storage.connected;
      if($('ideasResolve'))$('ideasResolve').hidden=!storage.hasConflict(current);
      if(!loading&&!failures.has(current))message(storage.message(current),storage.hasConflict(current));
    }
    const signature=r=>JSON.stringify(r&&{name:r.name,items:r.items.map(({blob,asset,...item})=>item),view:r.view});
    async function syncCloud(){
      if(!storage.isCloud||!initialized||syncing||loading||drag||$('ideasModal').open||editingNote())return;
      syncing=true;
      try{
        await saveQueue;const id=current,before=activeRecord(),stamp=before?.updatedAt,view=JSON.stringify(before?.view);
        const stored=await storage.all();for(const r of stored)if(!records.has(r.projectId))records.set(r.projectId,r);
        const next=id?await storage.get(id):null;
        if(id===current&&next&&!drag&&!$('ideasModal').open&&!editingNote()&&activeRecord()?.updatedAt===stamp&&JSON.stringify(activeRecord()?.view)===view){
          const changed=signature(next)!==signature(activeRecord())||next.items.some(item=>{const old=activeRecord()?.items.find(i=>i.id===item.id);return old?.blob&&item.blob!==old.blob&&item.asset?.sha!==old.asset?.sha;});records.set(id,next);
          if(changed){histories.set(id,IdeaModel.history());render();}
        }
        options();cloudStatus();
      }catch(error){message(error.message,true);}finally{syncing=false;}
    }
    if(storage.isCloud){
      storage.subscribe(cloudStatus);
      $('ideasConnect').onclick=()=>storage.connect();$('ideasRefresh').onclick=syncCloud;
      $('ideasResolve').onclick=async()=>{if(loading||syncing||drag)return;loading=true;controls();try{await saveQueue;const next=await storage.resolve(current);records.set(current,next);for(const r of await storage.all())records.set(r.projectId,r);histories.set(current,IdeaModel.history());options();}catch(error){message(error.message,true);}finally{loading=false;render();cloudStatus();}};
      window.addEventListener('online',()=>syncCloud());window.addEventListener('focus',()=>{if(isActive())syncCloud();});
      setInterval(()=>{if(isActive()&&document.visibilityState!=='hidden')syncCloud();},30000);
    }else for(const id of ['ideasConnect','ideasRefresh','ideasResolve'])if($(id))$(id).hidden=true;
    const ready=(async()=>{try{if(readonly){loading=false;message('공유 문서에는 개인 레퍼런스 보드가 포함되지 않습니다.');controls();return;}const stored=await storage.all();for(const r of stored){r.items=r.items.map(IdeaModel.cleanItem);r.view=validView(r.view);records.set(r.projectId,r);}let remembered;try{remembered=localStorage.getItem('dowon-ideas:project');}catch{}initialized=true;const list=options();await switchProject(list.some(p=>p.id===remembered)&&(!storage.isCloud||records.has(remembered)||!stored.length)?remembered:stored.find(r=>!r.projectId.startsWith('milestone:')&&(r.items.length||r._stub))?.projectId||list[0]?.id);cloudStatus();}catch{loading=false;message('보드 저장소를 열 수 없어요. 브라우저 저장 권한을 확인하고 새로고침해 주세요.',true);controls();}})();
    async function openBoard(descriptor){
      const token=++scopeToken;
      loading=true;controls();
      await ready;if(token!==scopeToken||readonly)return;
      if(descriptor){
        if(!scope)normalProject=current;
        scope=descriptor;
        const record=records.get(descriptor.id);if(record)record.name=descriptor.name;
        await switchProject(descriptor.id);
      }else if(scope){
        scope=null;const list=options();await switchProject(list.some(p=>p.id===normalProject)?normalProject:list[0]?.id);
      }else{loading=false;controls();}
    }
    controls();return {ready,openBoard,refreshProjects,ingest,flush:async()=>{await saveQueue;if(storage.isCloud)await storage.flush();},syncCloud};
  }
};
