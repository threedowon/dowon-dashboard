(() => {
  'use strict';
  const $=id=>document.getElementById(id),base='https://api.3dowon.com';
  const readonly=document.documentElement.dataset.readonly==='true',local=location.hostname!=='dashboard.3dowon.com';
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const size=v=>v>=1024**3?(v/1024**3).toFixed(2)+' GB':v>=1024**2?(v/1024**2).toFixed(1)+' MB':v>=1024?(v/1024).toFixed(1)+' KB':v+' B';
  const MAX_FILE=5*1024**3,WARNING_BYTES=10*1024**3;
  let documents=[],ready=false,busy=false,warned=false,controller=null;
  const total=()=>documents.reduce((n,d)=>n+d.size,0);
  function warnUsage(){if(total()<WARNING_BYTES){warned=false;return;}if(!warned){warned=true;alert('보관함 사용량이 '+size(total())+'입니다. 10GB 이상 보관 중이며 저장 비용이 늘어날 수 있습니다. 불필요한 파일을 정리해주세요.');}}

  const status=text=>{$('archiveStatus').textContent=text;};
  function render(){
    $('archiveCancel').hidden=!controller;
    $('archiveWarning').hidden=!ready||total()<WARNING_BYTES;
    $('archiveUpload').disabled=busy||!ready||readonly||local;
    $('archiveRefresh').disabled=$('archiveConnect').disabled=busy||readonly||local;
    $('archiveUsage').textContent=ready?documents.length+'개 파일 · '+size(documents.reduce((n,d)=>n+d.size,0))+' 사용 중':'';
    const query=$('archiveSearch').value.toLowerCase();
    const rows=documents.filter(d=>d.filename.toLowerCase().includes(query)).map(d=>'<tr><td>'+esc(d.filename)+'</td><td>'+size(d.size)+'</td><td>'+esc(new Date(d.createdAt).toLocaleString('ko-KR'))+'</td><td class="transfer-actions"><button class="btn" data-download="'+esc(d.id)+'" '+(busy?'disabled':'')+'>다운로드</button><button class="btn editable" data-delete="'+esc(d.id)+'" '+(busy?'disabled':'')+'>삭제</button></td></tr>').join('');
    $('archiveList').innerHTML='<table class="transfer-table" aria-label="보관된 파일"><thead><tr><th>파일</th><th>크기</th><th>보관일</th><th>작업</th></tr></thead><tbody>'+(rows||'<tr><td colspan="4" class="transfer-empty">'+(readonly?'공유 문서에는 보관 파일이 포함되지 않습니다.':ready?(query?'검색 결과가 없습니다.':'보관된 파일이 없습니다.'):'GitHub 연결 후 보관 파일을 확인할 수 있습니다.')+'</td></tr>')+'</tbody></table>';
  }
  async function request(path='',options={}){
    const response=await fetch(base+'/api/archive'+path,{credentials:'include',...options});
    if(!response.ok){if(response.status===401){ready=false;documents=[];}throw Error((await response.json().catch(()=>({}))).error||'요청에 실패했습니다. 다시 시도해주세요.');}
    return response.json();
  }
  async function load(){
    if(busy||readonly||local)return;
    busy=true;render();status('파일을 불러오는 중…');
    try{documents=(await request()).documents;ready=true;status('');warnUsage();}catch(e){ready=false;documents=[];status(e.message);}finally{busy=false;render();}
  }
  async function upload(files){
    if(busy||!ready||readonly||local)return;
    const selected=Array.from(files);if(!selected.length)return;
    busy=true;render();let saved=0;const errors=[];
    try{
      // Refresh usage so uploads from another device are included in the warning.
      documents=(await request()).documents;
      const projected=total()+selected.filter(f=>f.size<=MAX_FILE).reduce((n,f)=>n+f.size,0);
      if(projected>=WARNING_BYTES&&!confirm('업로드 후 보관함 사용량은 약 '+size(projected)+'입니다. 10GB 이상 보관하면 저장 비용이 늘어날 수 있습니다. 계속 업로드할까요?')){status('업로드를 취소했습니다.');return;}
      if(projected>=WARNING_BYTES)warned=true;
      controller=new AbortController();render();const signal=controller.signal;
      for(const file of selected){
        if(signal.aborted)break;
        let session=null;
        status('보관 중: '+file.name);
        try{
          if(file.size>MAX_FILE)throw Error('파일당 최대 5GB입니다.');
          let result;
          if(file.size<=25*1024**2){
            const form=new FormData();form.set('file',file);
            result=await request('',{method:'POST',body:form,signal});
          }else{
            const post=(path,data)=>request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal});
            session=await post('/uploads',{filename:file.name,size:file.size});
            const parts=[],count=Math.ceil(file.size/session.partSize);
            const retry=async action=>{for(let attempt=0;;attempt++){try{signal.throwIfAborted();return await action();}catch(e){if(signal.aborted||attempt===3||!ready)throw e;await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));}}};
            for(let index=0;index<count;index++){
              const chunk=file.slice(index*session.partSize,Math.min((index+1)*session.partSize,file.size));
              parts.push(await retry(()=>request('/uploads/'+session.id+'/part?number='+(index+1),{method:'POST',headers:{'content-type':'application/octet-stream'},body:chunk,signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])})));
              status('보관 중: '+file.name+' · '+Math.floor((index+1)/count*100)+'% ('+(index+1)+'/'+count+')');
            }
            // Commit is retryable. Keep cancellation disabled once finalizing starts.
            $('archiveCancel').disabled=true;
            result=await retry(()=>post('/uploads/'+session.id+'/complete',{parts}));
          }
          documents.unshift(result.document);saved++;render();
        }catch(e){
          if(session){try{await request('/uploads/'+session.id+'/abort',{method:'POST'});}catch{}}
          errors.push(file.name+': '+(signal.aborted?'업로드 취소':e.message));if(!ready||signal.aborted)break;
        }finally{$('archiveCancel').disabled=false;}
      }
      status(saved+'개 파일을 보관했습니다.'+(errors.length?' '+errors.join(' / '):''));
    }catch(e){status(e.message);}finally{controller=null;busy=false;render();}
  }
  $('archiveCancel').onclick=()=>{controller?.abort();};
  $('archiveConnect').onclick=()=>{sessionStorage.setItem('dowon:open-archive','1');location.href=base+'/auth/login';};
  $('archiveRefresh').onclick=load;
  $('archiveSearch').oninput=render;
  $('archiveUpload').onclick=()=>$('archiveFiles').click();
  $('archiveFiles').onchange=()=>{upload(Array.from($('archiveFiles').files));$('archiveFiles').value='';};
  $('archivePage').addEventListener('dragover',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files'))e.preventDefault();});
  $('archivePage').addEventListener('drop',e=>{e.preventDefault();upload(e.dataTransfer.files);});
  $('archiveList').onclick=async e=>{
    const button=e.target.closest('button');if(!button||busy||!ready||readonly||local)return;
    const doc=documents.find(d=>d.id===(button.dataset.download||button.dataset.delete));if(!doc)return;
    if(button.dataset.download){const a=document.createElement('a');a.href=base+'/api/archive/'+doc.id+'/file';a.referrerPolicy='strict-origin-when-cross-origin';document.body.append(a);a.click();a.remove();return;}
    if(!confirm('“'+doc.filename+'” 파일을 영구 삭제할까요?'))return;
    busy=true;render();
    try{await request('/'+doc.id+'/delete',{method:'POST'});documents=documents.filter(d=>d.id!==doc.id);status('파일을 삭제했습니다.');}catch(e){status(e.message);}finally{busy=false;render();}
  };
  window.addEventListener('hashchange',()=>{if(location.hash==='#archive')load();});
  if(!readonly&&sessionStorage.getItem('dowon:open-archive')){sessionStorage.removeItem('dowon:open-archive');location.hash='archive';}
  render();if(local)status('로컬 미리보기입니다. 파일 보관은 배포된 대시보드에서 사용할 수 있습니다.');else if(location.hash==='#archive')load();
})();
