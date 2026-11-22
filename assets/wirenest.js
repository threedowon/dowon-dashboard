(() => {
  'use strict';
  const $=id=>document.getElementById(id), base='https://api.3dowon.com', limit=25*1024*1024;
  const readonly=document.documentElement.dataset.readonly==='true';
  const local=['localhost','127.0.0.1'].includes(location.hostname);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const size=n=>n<1024*1024?Math.max(1,Math.round(n/1024))+' KB':(n/1024/1024).toFixed(1)+' MB';
  const date=value=>new Date(value).toLocaleString('sv-SE',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  let documents=[],jobs=[],ready=false,busy=false,selectedId=null,sortKey='filename',ascending=true;
  let previewKey=null,previewRequest=null;const previewCache=new Map();
  function message(text,error=false){$('wnStatus').textContent=text;$('wnStatus').classList.toggle('library-error',error);}
  function controls(){
    $('wnUpload').disabled=busy||!ready||readonly;
    $('wnRefresh').disabled=busy||readonly||local;
    $('wnConnect').disabled=busy||readonly||local;
    $('wnConnect').hidden=ready||readonly||local;
    if($('wnDeleteBackup'))$('wnDeleteBackup').disabled=busy||readonly||!documents.some(d=>d.id===selectedId);
  }
  async function request(path,options={}){
    const response=await fetch(base+'/api/wirenest'+path,{credentials:'include',...options});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'백업 요청에 실패했습니다. 다시 시도해주세요.');}
    return response;
  }
  function render(){
    const query=$('wnSearch').value.trim().toLocaleLowerCase();
    const shown=documents.filter(d=>d.filename.toLocaleLowerCase().includes(query)).sort((a,b)=>{
      const order=sortKey==='size'?a.size-b.size:sortKey==='createdAt'?new Date(a.createdAt)-new Date(b.createdAt):a.filename.localeCompare(b.filename,undefined,{numeric:true});return ascending?order:-order;
    });
    if(!shown.some(d=>d.id===selectedId))selectedId=shown[0]?.id||null;
    $('wnCount').textContent=ready?(query?shown.length+' / '+documents.length:documents.length)+' backups.':'';
    const disabled=busy?' disabled':'';
    $('wnList').innerHTML=jobs.map(job=>'<article class="wn-job'+(job.error?' is-error':'')+'"><div><h2>'+esc(job.file.name)+'</h2><p class="small">'+esc(job.error||'Uploading backup…')+'</p></div>'+(job.error?'<div class="tools"><button class="btn" data-retry="'+job.id+'"'+disabled+'>Retry</button><button class="btn" data-dismiss="'+job.id+'"'+disabled+'>Dismiss</button></div>':'<progress aria-label="Uploading backup"></progress>')+'</article>').join('')+
      shown.map(d=>'<div role="row" class="wn-backup-row '+(d.id===selectedId?'is-selected':'')+'"><div role="cell"><button class="wn-name" data-preview="'+esc(d.id)+'" aria-pressed="'+(d.id===selectedId)+'" title="Preview '+esc(d.filename)+'"'+disabled+'><span>'+esc(d.filename)+'</span></button></div><div role="cell" class="wn-date">'+esc(date(d.createdAt))+'</div><div role="cell">'+esc(size(d.size))+'</div><div role="cell" class="wn-actions"><button class="btn" data-open="'+esc(d.id)+'"'+disabled+'>Open</button><button class="btn" data-download="'+esc(d.id)+'"'+disabled+'>Download</button></div></div>').join('');
    if(!jobs.length&&!shown.length)$('wnList').innerHTML='<div class="empty">'+(readonly?'공유 문서에는 비공개 백업이 포함되지 않습니다.':!ready?'GitHub 연결 후 업로드한 백업을 볼 수 있습니다.':documents.length?'검색한 이름의 백업이 없습니다.':'아직 업로드한 백업이 없습니다.<br>새 작업을 시작하거나 저장해 둔 .wnest 파일을 올려주세요.')+'</div>';
    controls();showPreview(shown.find(d=>d.id===selectedId));
  }
  async function showPreview(doc){
    if(!globalThis.WireNestPreview||!$('wnPreview'))return;
    const key=doc?JSON.stringify([doc.id,doc.revision||doc.createdAt]):null;
    if(key===previewKey)return;previewKey=key;previewRequest?.abort();
    $('wnPreviewTitle').textContent=doc?'Preview: '+doc.filename:'Preview';$('wnPreviewInfo').textContent='';
    if(!doc||readonly||!ready){$('wnPreview').textContent='Select a backup to preview its wiring.';return;}
    $('wnPreview').textContent='Loading preview…';const controller=new AbortController();previewRequest=controller;
    try{
      let result=previewCache.get(key);
      if(!result){const response=await request('/'+encodeURIComponent(doc.id)+'/file',{signal:controller.signal}),blob=await response.blob();
        if(blob.size>limit)throw Error('Open this large project in WireNest to view.');
        const project=JSON.parse(await blob.text());result=globalThis.WireNestPreview.svg(project);
        previewCache.set(key,result);if(previewCache.size>10)previewCache.delete(previewCache.keys().next().value);
      }
      if(controller.signal.aborted||previewKey!==key)return;
      $('wnPreview').innerHTML=result.markup||'<span>No geometry to preview.</span>';$('wnPreviewInfo').textContent=result.summary;
    }catch(error){if(controller.signal.aborted||previewKey!==key)return;$('wnPreview').textContent='Preview unavailable. You can still open or download this backup.';}
  }
  async function load(){
    if(busy||readonly||local)return;
    busy=true;controls();message('백업 목록을 불러오는 중…');
    try{documents=(await(await request('')).json()).documents;ready=true;message('비공개 GitHub 저장소 · 직접 업로드한 백업만 표시됩니다.');}
    catch(error){ready=false;message(error.message,true);}
    finally{busy=false;render();}
  }
  async function upload(selected){
    if(busy||!ready||readonly)return;
    busy=true;message('백업을 업로드하는 중…');render();let saved=0;
    try{
      for(const job of selected){
        job.error='';render();
        try{
          if(!job.file.name.toLowerCase().endsWith('.wnest')||!job.file.size||job.file.size>limit)throw Error('25MB 이하의 .wnest 파일을 선택해주세요.');
          const form=new FormData();form.set('file',job.file);form.set('title',job.file.name.slice(0,200));form.set('tags','[]');
          const result=await(await request('',{method:'POST',body:form})).json();
          documents.unshift(result.document);jobs=jobs.filter(j=>j!==job);saved++;
        }catch(error){job.error=error.message;}
      }
      const failed=jobs.filter(j=>j.error).length;
      message(saved+'개 백업 저장 완료'+(failed?' · '+failed+'개 실패. 아래에서 다시 시도할 수 있습니다.':''),!!failed);
    }finally{busy=false;render();}
  }
  function addFiles(files){
    if(busy||!ready||readonly)return;
    const selected=Array.from(files,file=>({id:crypto.randomUUID(),file,error:''}));
    if(!selected.length)return;
    jobs.push(...selected);$('wnSearch').value='';upload(selected);
  }
  function openBackup(doc){
    const origin='https://threedowon.github.io',nonce=crypto.randomUUID();
    const editor=window.open(origin+'/WireNest/#dashboard-session='+nonce,'_blank');
    if(!editor){message('팝업을 허용한 뒤 다시 열어주세요.',true);return;}
    let text=null,loaded=false,saving=false,closed=false;const started=Date.now(),doneRequests=new Map();
    const send=data=>editor.postMessage({channel:'wirenest-dashboard',nonce,...data},origin);
    const cleanup=()=>{closed=true;window.removeEventListener('message',receive);clearInterval(timer);};
    const receive=async event=>{
      const m=event.data;
      if(event.source!==editor||event.origin!==origin||m?.channel!=='wirenest-dashboard'||m.nonce!==nonce)return;
      if(m.type==='ready'&&text)send({type:'project',text,filename:doc.filename});
      if(m.type==='loaded'){loaded=true;message('WireNest에서 열었습니다. 이 대시보드 탭을 유지하면 편집한 내용을 새 백업으로 저장할 수 있습니다.');}
      if(m.type==='save'&&loaded){
        if(typeof m.requestId!=='string'||m.requestId.length>100)return;
        if(doneRequests.has(m.requestId)){send(doneRequests.get(m.requestId));return;}
        if(saving){send({type:'save-result',requestId:m.requestId,error:'다른 백업을 저장 중입니다.'});return;}
        saving=true;let result;
        try{
          if(typeof m.text!=='string'||new TextEncoder().encode(m.text).length>limit)throw Error('25MB 이하의 프로젝트만 백업할 수 있습니다.');
          const data=JSON.parse(m.text);if(data?.app!=='wirenest'||!data.boards||!data.nodes||!data.wires)throw Error('프로젝트 형식이 올바르지 않습니다.');
          const filename=(String(data.name||doc.filename.replace(/\.wnest$/i,'')).replace(/[\/\\:*?"<>|]/g,'_').slice(0,180)||'WireNest')+'.wnest';
          const form=new FormData();form.set('file',new File([m.text],filename,{type:'application/json'}));form.set('title',filename);form.set('tags','[]');
          const saved=await(await request('',{method:'POST',body:form})).json();documents.unshift(saved.document);text=m.text;render();message('WireNest 작업을 새 백업으로 저장했습니다.');
          result={type:'save-result',requestId:m.requestId};
        }catch(error){result={type:'save-result',requestId:m.requestId,error:error.message};}
        finally{saving=false;}
        doneRequests.set(m.requestId,result);if(doneRequests.size>100)doneRequests.delete(doneRequests.keys().next().value);if(!closed)send(result);
      }
    };
    window.addEventListener('message',receive);
    const timer=setInterval(()=>{if(editor.closed){cleanup();return;}if(!loaded&&Date.now()-started>90000){message('WireNest 연결 시간이 초과되었습니다. 다시 열어주세요.',true);cleanup();}},1000);
    message('백업을 WireNest로 전달하는 중…');
    request('/'+doc.id+'/file').then(r=>r.blob()).then(async blob=>{
      if(closed)return;if(blob.size>limit)throw Error('25MB 이하의 백업만 열 수 있습니다.');text=await blob.text();
      if(!closed)send({type:'project',text,filename:doc.filename});
    }).catch(error=>{if(!closed){send({type:'error',error:error.message});message(error.message,true);cleanup();}});
  }
  $('wnUpload').onclick=()=>$('wnFiles').click();
  $('wnFiles').onchange=()=>{addFiles($('wnFiles').files);$('wnFiles').value='';};
  $('wnSearch').oninput=render;
  $('wnRefresh').onclick=()=>{previewKey=null;previewCache.clear();load();};
  for(const [id,key] of [['wnSortName','filename'],['wnSortSaved','createdAt'],['wnSortSize','size']])if($(id))$(id).onclick=()=>{
    ascending=sortKey===key?!ascending:true;sortKey=key;
    for(const [button,k,label] of [['wnSortName','filename','Name'],['wnSortSaved','createdAt','Saved'],['wnSortSize','size','Size']])$(button).textContent=label+(k===key?(ascending?' ▲':' ▼'):'');render();
  };
  if($('wnDeleteBackup'))$('wnDeleteBackup').onclick=()=>performAction({dataset:{delete:selectedId}});
  $('wnConnect').onclick=()=>{sessionStorage.setItem('dowon:open-wirenest','1');location.href=base+'/auth/login';};
  $('wirenestPage').addEventListener('dragover',event=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files'))event.preventDefault();});
  $('wirenestPage').addEventListener('drop',event=>{
    if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;
    event.preventDefault();
    if(!ready||busy){message(busy?'업로드가 끝난 뒤 다시 놓아주세요.':'GitHub 연결 후 파일을 올려주세요.',true);return;}
    addFiles(event.dataTransfer.files);
  });
  $('wnList').onclick=event=>performAction(event.target.closest('button'));
  async function performAction(button){
    if(busy||readonly)return;
    if(!button)return;
    if(button.dataset.preview){selectedId=button.dataset.preview;render();const buttons=$('wnList').querySelectorAll?.('[data-preview]');if(buttons)for(const el of buttons)if(el.dataset.preview===selectedId)el.focus();return;}
    if(button.dataset.dismiss){jobs=jobs.filter(j=>j.id!==button.dataset.dismiss);render();return;}
    if(button.dataset.retry){const job=jobs.find(j=>j.id===button.dataset.retry);if(job)await upload([job]);return;}
    const doc=documents.find(d=>d.id===(button.dataset.open||button.dataset.download||button.dataset.delete));if(!doc)return;
    if(button.dataset.open){openBackup(doc);return;}
    const deleting=!!button.dataset.delete;
    if(deleting&&!confirm('“'+doc.filename+'” ('+date(doc.createdAt)+') 백업을 삭제할까요?'))return;
    busy=true;render();message(deleting?'백업 삭제 중…':'백업 다운로드 준비 중…');
    try{
      if(deleting){
        await request('/'+doc.id+'/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:doc.revision})});
        documents=documents.filter(d=>d.id!==doc.id);message('백업을 삭제했습니다.');
      }else{
        const blob=await(await request('/'+doc.id+'/file')).blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download=doc.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
        message('백업 다운로드를 요청했습니다. 새 작업 창의 파일 → 열기에서 내려받은 파일을 선택하세요.');
      }
    }catch(error){message(error.message,true);}
    finally{busy=false;render();}
  }
  window.addEventListener('hashchange',()=>{if(location.hash==='#wirenest'&&!ready)load();});
  if(!readonly&&sessionStorage.getItem('dowon:open-wirenest')){sessionStorage.removeItem('dowon:open-wirenest');location.hash='wirenest';}
  render();
  if(readonly)message('공유 문서에서는 백업에 접근할 수 없습니다.');
  else if(local)message('로컬 화면 미리보기입니다. 업로드·다운로드는 배포 후 dashboard.3dowon.com에서 GitHub에 연결해 이용할 수 있습니다.');
  else if(location.hash==='#wirenest')load();
})();
