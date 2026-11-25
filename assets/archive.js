(() => {
  'use strict';
  const $=id=>document.getElementById(id),base='https://api.3dowon.com';
  const readonly=document.documentElement.dataset.readonly==='true',local=location.hostname!=='dashboard.3dowon.com';
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const size=v=>v>=1024**3?(v/1024**3).toFixed(2)+' GB':v>=1024**2?(v/1024**2).toFixed(1)+' MB':v>=1024?(v/1024).toFixed(1)+' KB':v+' B';
  let documents=[],ready=false,busy=false;
  const status=text=>{$('archiveStatus').textContent=text;};
  function render(){
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
    try{documents=(await request()).documents;ready=true;status('');}catch(e){ready=false;documents=[];status(e.message);}finally{busy=false;render();}
  }
  async function upload(files){
    if(busy||!ready||readonly||local)return;
    busy=true;render();let saved=0;const errors=[];
    for(const file of Array.from(files)){
      status('보관 중: '+file.name);
      try{
        if(file.size>25*1024**2)throw Error('파일당 최대 25MB입니다.');
        const form=new FormData();form.set('file',file);
        const result=await request('',{method:'POST',body:form});documents.unshift(result.document);saved++;
      }catch(e){errors.push(file.name+': '+e.message);if(!ready)break;}
    }
    busy=false;render();status(saved+'개 파일을 보관했습니다.'+(errors.length?' '+errors.join(' / '):''));
  }
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
