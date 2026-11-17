(() => {
'use strict';
const $=id=>document.getElementById(id),base='https://api.3dowon.com';
if(document.documentElement.dataset.readonly==='true'){$('pdfStatus').textContent='공유 HTML에는 비공개 PDF 자료실이 포함되지 않습니다.';$('pdfRefresh').disabled=true;return;}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let docs=[],filter=null,ready=false,busy=false,editing=null,pending=[],viewerUrl=null;
const tags=v=>[...new Set(v.split(/[,，\n]/).map(t=>t.trim().normalize('NFC')).filter(Boolean))];
const size=n=>n<1024*1024?Math.max(1,Math.round(n/1024))+' KB':(n/1024/1024).toFixed(1)+' MB';
function message(s,error=false){$('pdfStatus').textContent=s;$('pdfStatus').classList.toggle('library-error',error);}
async function request(path,options={}){const r=await fetch(base+path,{credentials:'include',...options});if(!r.ok){const v=await r.json().catch(()=>({}));throw Error(v.error||'요청에 실패했습니다. 잠시 후 다시 시도해주세요.');}return r;}
function render(){
 const counts=new Map();for(const d of docs)for(const t of d.tags)counts.set(t,(counts.get(t)||0)+1);
 if(filter!==null&&filter!==''&&!counts.has(filter))filter=null;
 const filters=[{value:null,label:'전체',n:docs.length},{value:'',label:'태그 없음',n:docs.filter(d=>!d.tags.length).length},...[...counts].sort((a,b)=>a[0].localeCompare(b[0],'ko')).map(([value,n])=>({value,label:value,n}))];
 $('pdfTags').innerHTML=filters.map((t,i)=>'<button type="button" data-filter="'+i+'" aria-pressed="'+(filter===t.value)+'">'+esc(t.label)+' <span>'+t.n+'</span></button>').join('');
 $('pdfTags').onclick=e=>{const b=e.target.closest('[data-filter]');if(b){filter=filters[Number(b.dataset.filter)].value;render();}};
 const q=$('pdfSearch').value.trim().toLocaleLowerCase();
 const shown=docs.filter(d=>(filter===null||(filter===''?!d.tags.length:d.tags.includes(filter)))&&[d.title,d.filename,...d.tags].join(' ').toLocaleLowerCase().includes(q));
 $('pdfCount').textContent=ready?shown.length+'개 문서'+(filter!==null?' · '+(filter||'태그 없음'):''):'';
 $('pdfList').innerHTML=shown.length?shown.map(d=>'<article class="pdf-card"><div class="pdf-emblem">PDF / '+esc(size(d.size))+'</div><h2>'+esc(d.title)+'</h2><p class="small">'+esc(d.filename)+'<br>'+esc(d.createdAt.slice(0,10))+' 추가</p><div class="pdf-card-tags">'+d.tags.map(t=>'<button class="tag" data-tag="'+esc(t)+'">'+esc(t)+'</button>').join('')+'</div><div class="tools"><button class="btn primary" data-open="'+d.id+'">PDF 열기</button><button class="btn" data-edit="'+d.id+'">제목·태그 수정</button><button class="btn danger" data-delete="'+d.id+'">삭제</button></div></article>').join(''):'<div class="empty">'+(!ready?'GitHub 연결 후 자료실을 불러와 주세요.':docs.length?'조건에 맞는 문서가 없어요.<br>검색어나 태그를 바꿔보세요.':'아직 보관한 PDF가 없어요.<br>PDF를 올리고 태그로 정리해 보세요.')+'</div>';
}
async function load(){if(busy)return;busy=true;$('pdfRefresh').disabled=true;message('자료실 불러오는 중…');try{const data=await(await request('/api/library')).json();docs=data.documents;ready=true;message('비공개 자료실 · 업로드와 수정 내용은 바로 저장됩니다.');}catch(e){message(e.message,true);}finally{busy=false;$('pdfRefresh').disabled=false;$('pdfAdd').disabled=$('pdfDropzone').disabled=!ready;render();}}
$('pdfConnect').onclick=()=>{sessionStorage.setItem('dowon:open-pdf','1');location.href=base+'/auth/login';};
$('pdfRefresh').onclick=load;$('pdfSearch').oninput=render;
function formBusy(value){busy=value;for(const el of $('pdfForm').elements)el.disabled=value;$('pdfAdd').disabled=$('pdfDropzone').disabled=value||!ready;$('pdfRefresh').disabled=$('pdfConnect').disabled=value;}
function openForm(doc=null){if(busy)return;editing=doc;pending=[];$('pdfForm').reset();$('pdfNameLabel').hidden=!doc;$('pdfName').required=!!doc;$('pdfFileLabel').hidden=!!doc;$('pdfFiles').required=!doc;$('pdfModalTitle').textContent=doc?'제목·태그 수정':'PDF 올리기';$('pdfName').value=doc?.title||'';$('pdfTagInput').value=doc?.tags.join(', ')||'';$('pdfSelected').textContent='';$('pdfFormStatus').textContent='';$('pdfModal').showModal();}
$('pdfAdd').onclick=()=>openForm();$('pdfCancel').onclick=()=>$('pdfModal').close();$('pdfModal').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('pdfFiles').onchange=()=>{pending=[...$('pdfFiles').files];$('pdfSelected').textContent=pending.map(f=>f.name+' ('+size(f.size)+')').join(' · ');};
$('pdfForm').onsubmit=e=>{e.preventDefault();saveForm();};
async function saveForm(){
 if(busy)return;const selectedTags=tags($('pdfTagInput').value);
 if(selectedTags.length>20||selectedTags.some(t=>t.length>40)){$('pdfFormStatus').textContent='태그는 40자 이하, 최대 20개까지 입력해주세요.';return;}
 if(!editing&&(!pending.length||pending.some(f=>f.size>10*1024*1024||!f.name.toLowerCase().endsWith('.pdf')))){$('pdfFormStatus').textContent='10MB 이하의 PDF 파일을 선택해주세요.';return;}
 formBusy(true);let saved=0;
 try{
  if(editing){const result=await(await request('/api/library/'+editing.id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:$('pdfName').value,tags:selectedTags,revision:editing.revision})})).json();docs=docs.map(d=>d.id===editing.id?result.document:d);}
  else{while(pending.length){const file=pending[0];$('pdfFormStatus').textContent=file.name+' 저장 중… ('+(saved+1)+' / '+(saved+pending.length)+')';const form=new FormData();form.set('file',file);form.set('title',file.name.replace(/\.pdf$/i,'').slice(0,200)||'제목 없음');form.set('tags',JSON.stringify(selectedTags));const result=await(await request('/api/library',{method:'POST',body:form})).json();docs.unshift(result.document);pending.shift();saved++;}}
  $('pdfModal').close();message(editing?'제목과 태그를 저장했습니다.':saved+'개 PDF를 저장했습니다.');filter=null;$('pdfSearch').value='';
 }catch(err){$('pdfFormStatus').textContent=(saved?saved+'개 저장 완료. 남은 파일: '+pending.map(f=>f.name).join(', ')+'\n':'')+err.message;}finally{formBusy(false);render();}
}
// File drops anywhere on the library page upload immediately with no default tags.
// Cancel browser navigation for external files, including drops outside the target.
$('pdfDropzone').onclick=()=>openForm();
let dragDepth=0;
const fileDrag=e=>Array.from(e.dataTransfer?.types||[]).includes('Files');
const clearDrag=()=>{dragDepth=0;$('pdfPage').classList.remove('pdf-dragging');};
window.addEventListener('dragover',e=>{if(fileDrag(e))e.preventDefault();});
window.addEventListener('drop',e=>{if(fileDrag(e))e.preventDefault();clearDrag();});
$('pdfPage').addEventListener('dragenter',e=>{if(!fileDrag(e))return;e.preventDefault();dragDepth++;if(ready&&!busy)$('pdfPage').classList.add('pdf-dragging');});
$('pdfPage').addEventListener('dragleave',e=>{if(fileDrag(e)&&--dragDepth<=0)clearDrag();});
$('pdfPage').addEventListener('drop',e=>{
 if(!fileDrag(e))return;e.preventDefault();clearDrag();
 if(busy||$('pdfModal').open||$('pdfViewer').open){message('현재 작업을 마친 뒤 파일을 다시 놓아주세요.',true);return;}
 if(!ready){message('먼저 GitHub에 연결하고 자료실을 불러와 주세요.',true);return;}
 const files=Array.from(e.dataTransfer.files);
 if(!files.length||files.some(f=>!f.name.toLowerCase().endsWith('.pdf')||f.size>10*1024*1024||!f.size)){message('폴더 대신 10MB 이하의 PDF 파일을 선택해서 놓아주세요.',true);return;}
 openForm();pending=files;$('pdfFiles').required=false;$('pdfSelected').textContent=files.map(f=>f.name+' ('+size(f.size)+')').join(' · ');saveForm();
});
window.addEventListener('dragend',clearDrag);
$('pdfList').onclick=async e=>{
 if(busy)return;
 const deletion=e.target.closest('[data-delete]');
 if(deletion){
  const doc=docs.find(d=>d.id===deletion.dataset.delete);if(!doc)return;
  if(!confirm('“'+doc.title+'”을 자료실에서 삭제할까요?\n파일: '+doc.filename+'\nPDF 파일과 목록에서 제거됩니다. 이전 파일은 GitHub 변경 기록에 남습니다.'))return;
  formBusy(true);deletion.disabled=true;message('PDF 삭제 중…');
  try{await request('/api/library/'+doc.id+'/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision:doc.revision})});docs=docs.filter(d=>d.id!==doc.id);message('“'+doc.title+'”을 삭제했습니다.');}
  catch(err){message('삭제 실패: '+err.message,true);}finally{formBusy(false);render();}
  return;
 }

 const tag=e.target.closest('[data-tag]');if(tag){filter=tag.dataset.tag;render();return;}
 const edit=e.target.closest('[data-edit]');if(edit){openForm(docs.find(d=>d.id===edit.dataset.edit));return;}
 const button=e.target.closest('[data-open]');if(!button)return;const doc=docs.find(d=>d.id===button.dataset.open);button.disabled=true;message('PDF 불러오는 중…');
 try{const blob=await(await request('/api/library/'+doc.id+'/file')).blob();viewerUrl=URL.createObjectURL(blob);$('pdfViewerTitle').textContent=doc.title;$('pdfDownload').href=viewerUrl;$('pdfDownload').download=doc.filename;$('pdfFrame').src=viewerUrl;$('pdfViewer').showModal();message('PDF를 불러왔습니다.');}catch(err){message(err.message,true);}finally{button.disabled=false;}
};
$('pdfViewerClose').onclick=()=>$('pdfViewer').close();$('pdfViewer').addEventListener('close',()=>{$('pdfFrame').removeAttribute('src');$('pdfDownload').removeAttribute('href');if(viewerUrl)URL.revokeObjectURL(viewerUrl);viewerUrl=null;});
window.addEventListener('hashchange',()=>{if(location.hash==='#pdf'&&!ready)load();});
if(sessionStorage.getItem('dowon:open-pdf')){sessionStorage.removeItem('dowon:open-pdf');location.hash='pdf';}
render();if(location.hash==='#pdf')load();
})();
