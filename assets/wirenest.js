(() => {
  'use strict';
  const $=id=>document.getElementById(id), base='https://api.3dowon.com', limit=25*1024*1024;
  const readonly=document.documentElement.dataset.readonly==='true';
  const local=['localhost','127.0.0.1'].includes(location.hostname);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const size=n=>n<1024*1024?Math.max(1,Math.round(n/1024))+' KB':(n/1024/1024).toFixed(1)+' MB';
  const date=value=>new Date(value).toLocaleString('ko-KR',{dateStyle:'medium',timeStyle:'short'});
  let documents=[],jobs=[],ready=false,busy=false;
  function message(text,error=false){$('wnStatus').textContent=text;$('wnStatus').classList.toggle('library-error',error);}
  function controls(){
    $('wnUpload').disabled=busy||!ready||readonly;
    $('wnRefresh').disabled=busy||readonly||local;
    $('wnConnect').disabled=busy||readonly||local;
  }
  async function request(path,options={}){
    const response=await fetch(base+'/api/wirenest'+path,{credentials:'include',...options});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'백업 요청에 실패했습니다. 다시 시도해주세요.');}
    return response;
  }
  function render(){
    const query=$('wnSearch').value.trim().toLocaleLowerCase();
    const shown=documents.filter(d=>d.filename.toLocaleLowerCase().includes(query));
    $('wnCount').textContent=ready?'저장된 백업 '+shown.length+'개':'';
    const disabled=busy?' disabled':'';
    $('wnList').innerHTML=jobs.map(job=>'<article class="pdf-card pdf-upload-card'+(job.error?' is-error':'')+'"><div class="pdf-emblem">'+(job.error?'업로드 실패':'업로드 중…')+'</div><h2>'+esc(job.file.name)+'</h2><p class="small">'+esc(job.error||'비공개 저장소에 백업하고 있습니다.')+'</p>'+(job.error?'<div class="tools"><button class="btn" data-retry="'+job.id+'"'+disabled+'>다시 시도</button><button class="btn" data-dismiss="'+job.id+'"'+disabled+'>목록에서 빼기</button></div>':'<progress aria-label="업로드 중"></progress>')+'</article>').join('')+
      shown.map(d=>'<article class="pdf-card"><div class="pdf-emblem">WNEST / '+esc(size(d.size))+'</div><h2>'+esc(d.filename)+'</h2><p class="small">'+esc(date(d.createdAt))+' 업로드</p><div class="tools"><button class="btn primary" data-download="'+esc(d.id)+'"'+disabled+'>백업 내려받기</button><button class="btn danger editable" data-delete="'+esc(d.id)+'"'+disabled+'>삭제</button></div></article>').join('');
    if(!jobs.length&&!shown.length)$('wnList').innerHTML='<div class="empty">'+(readonly?'공유 문서에는 비공개 백업이 포함되지 않습니다.':!ready?'GitHub 연결 후 업로드한 백업을 볼 수 있습니다.':documents.length?'검색한 이름의 백업이 없습니다.':'아직 업로드한 백업이 없습니다.<br>새 작업을 시작하거나 저장해 둔 .wnest 파일을 올려주세요.')+'</div>';
    controls();
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
  $('wnUpload').onclick=()=>$('wnFiles').click();
  $('wnFiles').onchange=()=>{addFiles($('wnFiles').files);$('wnFiles').value='';};
  $('wnSearch').oninput=render;
  $('wnRefresh').onclick=load;
  $('wnConnect').onclick=()=>{sessionStorage.setItem('dowon:open-wirenest','1');location.href=base+'/auth/login';};
  $('wirenestPage').addEventListener('dragover',event=>{if(Array.from(event.dataTransfer?.types||[]).includes('Files'))event.preventDefault();});
  $('wirenestPage').addEventListener('drop',event=>{
    if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;
    event.preventDefault();
    if(!ready||busy){message(busy?'업로드가 끝난 뒤 다시 놓아주세요.':'GitHub 연결 후 파일을 올려주세요.',true);return;}
    addFiles(event.dataTransfer.files);
  });
  $('wnList').onclick=async event=>{
    if(busy||readonly)return;
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.dismiss){jobs=jobs.filter(j=>j.id!==button.dataset.dismiss);render();return;}
    if(button.dataset.retry){const job=jobs.find(j=>j.id===button.dataset.retry);if(job)await upload([job]);return;}
    const doc=documents.find(d=>d.id===(button.dataset.download||button.dataset.delete));if(!doc)return;
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
  };
  window.addEventListener('hashchange',()=>{if(location.hash==='#wirenest'&&!ready)load();});
  if(!readonly&&sessionStorage.getItem('dowon:open-wirenest')){sessionStorage.removeItem('dowon:open-wirenest');location.hash='wirenest';}
  render();
  if(readonly)message('공유 문서에서는 백업에 접근할 수 없습니다.');
  else if(local)message('로컬 화면 미리보기입니다. 업로드·다운로드는 배포 후 dashboard.3dowon.com에서 GitHub에 연결해 이용할 수 있습니다.');
  else if(location.hash==='#wirenest')load();
})();
