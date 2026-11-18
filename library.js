(() => {
'use strict';
const $=id=>document.getElementById(id),base='https://api.3dowon.com';
if(document.documentElement.dataset.readonly==='true'){$('pdfStatus').textContent='공유 HTML에는 비공개 PDF 자료실이 포함되지 않습니다.';$('pdfRefresh').disabled=true;return;}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let docs=[],filter=null,ready=false,busy=false,editing=null,pending=[],viewerUrl=null,dropUploads=[],uploadSequence=0;
const selectedIds=new Set();let visibleDocs=[],tagging=[];
const tags=v=>[...new Set(v.split(/[,，\n]/).map(t=>t.trim().normalize('NFC')).filter(Boolean))];
const size=n=>n<1024*1024?Math.max(1,Math.round(n/1024))+' KB':(n/1024/1024).toFixed(1)+' MB';
function message(s,error=false){$('pdfStatus').textContent=s;$('pdfStatus').classList.toggle('library-error',error);}
async function request(path,options={}){const r=await fetch(base+path,{credentials:'include',...options});if(!r.ok){const v=await r.json().catch(()=>({}));throw Error(v.error||'요청에 실패했습니다. 잠시 후 다시 시도해주세요.');}return r;}
function render(){
 for(const id of selectedIds)if(!docs.some(d=>d.id===id))selectedIds.delete(id);
 const counts=new Map();for(const d of docs)for(const t of d.tags)counts.set(t,(counts.get(t)||0)+1);
 if(filter!==null&&filter!==''&&!counts.has(filter))filter=null;
 const filters=[{value:null,label:'전체',n:docs.length},{value:'',label:'태그 없음',n:docs.filter(d=>!d.tags.length).length},...[...counts].sort((a,b)=>a[0].localeCompare(b[0],'ko')).map(([value,n])=>({value,label:value,n}))];
 $('pdfTags').innerHTML=filters.map((t,i)=>'<button type="button" data-filter="'+i+'" aria-pressed="'+(filter===t.value)+'">'+esc(t.label)+' <span>'+t.n+'</span></button>').join('');
 $('pdfTags').onclick=e=>{const b=e.target.closest('[data-filter]');if(b){selectedIds.clear();filter=filters[Number(b.dataset.filter)].value;render();}};
 const q=$('pdfSearch').value.trim().toLocaleLowerCase();
 const shown=docs.filter(d=>(filter===null||(filter===''?!d.tags.length:d.tags.includes(filter)))&&[d.title,d.filename,...d.tags].join(' ').toLocaleLowerCase().includes(q));
 visibleDocs=shown;renderSelection();
 $('pdfCount').textContent=ready?shown.length+'개 문서'+(filter!==null?' · '+(filter||'태그 없음'):''):'';
 const completedIds=new Set(dropUploads.filter(job=>job.document).map(job=>job.document.id));
 const rows=dropUploads.map(job=>{const doc=job.document&&shown.find(d=>d.id===job.document.id);return job.document?(doc?documentCard(doc):''):uploadCard(job);}).join('')+shown.filter(d=>!completedIds.has(d.id)).map(documentCard).join('');
 const active=dropUploads.filter(job=>!job.document).length;
 if(ready&&active)$('pdfCount').textContent+=' · 업로드 '+active+'개';
 $('pdfList').innerHTML=rows||'<div class="empty">'+(!ready?'GitHub 연결 후 자료실을 불러와 주세요.':docs.length?'조건에 맞는 문서가 없어요.<br>검색어나 태그를 바꿔보세요.':'아직 보관한 PDF가 없어요.<br>PDF를 올리고 태그로 정리해 보세요.')+'</div>';
}
function documentCard(d){return '<article class="pdf-card '+(selectedIds.has(d.id)?'is-selected':'')+'"><label class="pdf-select-label"><input type="checkbox" data-select="'+esc(d.id)+'" aria-label="'+esc(d.title)+' 선택" '+(selectedIds.has(d.id)?'checked ':'')+(busy?'disabled':'')+'> 선택</label><div class="pdf-emblem">PDF / '+esc(size(d.size))+'</div><h2>'+esc(d.title)+'</h2><p class="small">'+esc(d.filename)+'<br>'+esc(d.createdAt.slice(0,10))+' 추가</p><div class="pdf-card-tags">'+d.tags.map(t=>'<button class="tag" data-tag="'+esc(t)+'">'+esc(t)+'</button>').join('')+'</div><div class="tools"><button class="btn primary" data-open="'+d.id+'">PDF 열기</button><button class="btn" data-edit="'+d.id+'">제목·태그 수정</button><button class="btn danger" data-delete="'+d.id+'">삭제</button></div></article>';}
function uploadCard(job){
 const failed=job.state==='error',uploading=job.state==='uploading';
 return '<article class="pdf-card pdf-upload-card '+(failed?'is-error':'')+'" aria-busy="'+uploading+'"><div class="pdf-emblem">PDF / '+esc(size(job.file.size))+'</div><h2>'+esc(job.file.name.replace(/\.pdf$/i,''))+'</h2><p class="small">'+esc(job.file.name)+'</p>'+(failed?'<p class="library-error">'+esc(job.error)+'</p><div class="tools"><button class="btn" data-upload-retry="'+job.id+'" '+(busy?'disabled':'')+'>다시 시도</button><button class="btn" data-upload-dismiss="'+job.id+'" '+(busy?'disabled':'')+'>목록에서 빼기</button></div>':'<div class="pdf-upload-state"><span>'+ (uploading?'업로드 중…':'업로드 대기 중')+'</span><progress '+(uploading?'':'value="0" max="1"')+' aria-label="'+esc(job.file.name)+' 업로드 진행"></progress></div>')+'</article>';
}
async function uploadFile(file,selectedTags=[]){
 const form=new FormData();form.set('file',file);form.set('title',file.name.replace(/\.pdf$/i,'').slice(0,200)||'제목 없음');form.set('tags',JSON.stringify(selectedTags));
 return (await(await request('/api/library',{method:'POST',body:form})).json()).document;
}
function settleUploads(){
 if(!dropUploads.length||dropUploads.some(job=>!job.document))return;
 const completed=dropUploads.map(job=>docs.find(d=>d.id===job.document.id)).filter(Boolean),ids=new Set(completed.map(d=>d.id));
 docs=[...completed,...docs.filter(d=>!ids.has(d.id))];dropUploads=[];
}
async function uploadDropped(jobs){
 if(busy)return;formBusy(true);filter=null;$('pdfSearch').value='';let saved=0;
 try{
  for(const job of jobs){
   job.state='uploading';job.error='';message(job.file.name+' 업로드 중…');render();
   try{job.document=await uploadFile(job.file);job.state='done';docs.unshift(job.document);saved++;}
   catch(error){job.state='error';job.error=error.message||'업로드에 실패했어요.';}
   render();
  }
  const failed=dropUploads.filter(job=>job.state==='error').length;
  message(saved+'개 PDF를 저장했습니다.'+(failed?' · '+failed+'개 업로드 실패. 아래 카드에서 다시 시도해 주세요.':''),!!failed);
  settleUploads();
 }finally{formBusy(false);render();}
}
async function load(){if(busy)return;busy=true;$('pdfRefresh').disabled=true;message('자료실 불러오는 중…');try{const data=await(await request('/api/library')).json();docs=data.documents;ready=true;message('비공개 자료실 · 업로드와 수정 내용은 바로 저장됩니다.');}catch(e){message(e.message,true);}finally{busy=false;$('pdfRefresh').disabled=false;$('pdfAdd').disabled=$('pdfDropzone').disabled=!ready;render();}}
$('pdfConnect').onclick=()=>{sessionStorage.setItem('dowon:open-pdf','1');location.href=base+'/auth/login';};
$('pdfRefresh').onclick=load;$('pdfSearch').oninput=()=>{selectedIds.clear();render();};
function formBusy(value){busy=value;renderSelection();for(const el of $('pdfForm').elements)el.disabled=value;$('pdfAdd').disabled=$('pdfDropzone').disabled=value||!ready;$('pdfRefresh').disabled=$('pdfConnect').disabled=value;}
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
  else{while(pending.length){const file=pending[0];$('pdfFormStatus').textContent=file.name+' 저장 중… ('+(saved+1)+' / '+(saved+pending.length)+')';docs.unshift(await uploadFile(file,selectedTags));pending.shift();saved++;}}
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
 if(busy||$('pdfModal').open||$('pdfViewer').open||$('pdfDeleteModal').open||$('pdfBulkTagModal').open){message('현재 작업을 마친 뒤 파일을 다시 놓아주세요.',true);return;}
 if(!ready){message('먼저 GitHub에 연결하고 자료실을 불러와 주세요.',true);return;}
 const files=Array.from(e.dataTransfer.files);
 if(!files.length||files.some(f=>!f.name.toLowerCase().endsWith('.pdf')||f.size>10*1024*1024||!f.size)){message('폴더 대신 10MB 이하의 PDF 파일을 선택해서 놓아주세요.',true);return;}
 const jobs=files.map(file=>({id:String(++uploadSequence),file,state:'waiting',error:'',document:null}));
 dropUploads.push(...jobs);uploadDropped(jobs);
});
window.addEventListener('dragend',clearDrag);
function renderSelection(){
 const n=selectedIds.size,all=$('pdfSelectAll');
 all.checked=!!visibleDocs.length&&visibleDocs.every(d=>selectedIds.has(d.id));
 all.indeterminate=!all.checked&&visibleDocs.some(d=>selectedIds.has(d.id));all.disabled=busy||!visibleDocs.length;
 $('pdfSelectionCount').textContent=n+'개 선택';
 for(const id of ['pdfClearSelection','pdfBulkTags','pdfBulkDelete'])$(id).disabled=busy||!n;
}
$('pdfSelectAll').onchange=e=>{if(busy)return;for(const d of visibleDocs)e.target.checked?selectedIds.add(d.id):selectedIds.delete(d.id);render();};
$('pdfClearSelection').onclick=()=>{if(!busy){selectedIds.clear();render();}};
$('pdfList').onchange=e=>{const box=e.target.closest('[data-select]');if(!box||busy)return;box.checked?selectedIds.add(box.dataset.select):selectedIds.delete(box.dataset.select);render();};
const selection=()=>docs.filter(d=>selectedIds.has(d.id));
const names=list=>list.map(d=>d.title+' ('+d.filename+')').join('\n');
async function batchRequest(action,targets,extra={}){return (await request('/api/library/batch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,documents:targets.map(d=>({id:d.id,revision:d.revision})),...extra})})).json();}
let deleting=null;
function openDelete(targets){if(busy||!targets.length)return;deleting=targets.map(d=>({...d}));$('pdfDeleteName').textContent=names(targets);$('pdfDeleteTitle').textContent=targets.length+'개 PDF를 삭제할까요?';$('pdfDeleteStatus').textContent='';$('pdfDeleteModal').showModal();}
$('pdfBulkDelete').onclick=()=>openDelete(selection());
$('pdfBulkTags').onclick=()=>{if(busy||!selectedIds.size)return;tagging=selection().map(d=>({...d}));$('pdfBulkTagNames').textContent=names(tagging);$('pdfBulkTagTitle').textContent=tagging.length+'개 PDF에 태그 추가';$('pdfBulkTagInput').value='';$('pdfBulkTagStatus').textContent='';$('pdfBulkTagModal').showModal();};
$('pdfBulkTagCancel').onclick=()=>$('pdfBulkTagModal').close();
$('pdfBulkTagModal').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('pdfBulkTagForm').onsubmit=async e=>{
 e.preventDefault();if(busy)return;const added=tags($('pdfBulkTagInput').value);
 if(!added.length||added.length>20||added.some(t=>t.length>40)){$('pdfBulkTagStatus').textContent='태그는 1개 이상, 최대 20개, 각 40자 이하로 입력해주세요.';return;}
 formBusy(true);for(const id of ['pdfBulkTagCancel','pdfBulkTagConfirm','pdfBulkTagInput'])$(id).disabled=true;$('pdfBulkTagStatus').textContent='태그 저장 중…';
 try{const result=await batchRequest('tags',tagging,{tags:added});const updates=new Map(result.documents.map(d=>[d.id,d]));docs=docs.map(d=>updates.get(d.id)||d);$('pdfBulkTagModal').close();message(tagging.length+'개 PDF에 태그를 추가했습니다.');selectedIds.clear();}
 catch(err){$('pdfBulkTagStatus').textContent=err.message;}
 finally{formBusy(false);for(const id of ['pdfBulkTagCancel','pdfBulkTagConfirm','pdfBulkTagInput'])$(id).disabled=false;render();}
};
$('pdfDeleteCancel').onclick=()=>$('pdfDeleteModal').close();
$('pdfDeleteModal').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('pdfDeleteConfirm').onclick=async()=>{
 if(busy||!deleting?.length)return;const targets=deleting;
 formBusy(true);$('pdfDeleteCancel').disabled=$('pdfDeleteConfirm').disabled=true;$('pdfDeleteStatus').textContent='삭제 중…';
 try{await batchRequest('delete',targets);const ids=new Set(targets.map(d=>d.id));docs=docs.filter(d=>!ids.has(d.id));selectedIds.clear();$('pdfDeleteModal').close();message(targets.length+'개 PDF를 삭제했습니다.');}
 catch(err){$('pdfDeleteStatus').textContent='삭제 실패: '+err.message;}
 finally{formBusy(false);$('pdfDeleteCancel').disabled=$('pdfDeleteConfirm').disabled=false;render();}
};
$('pdfList').onclick=async e=>{
 if(busy)return;
 const retry=e.target.closest('[data-upload-retry]');
 if(retry){const job=dropUploads.find(job=>job.id===retry.dataset.uploadRetry);if(job?.state==='error')await uploadDropped([job]);return;}
 const dismiss=e.target.closest('[data-upload-dismiss]');
 if(dismiss){dropUploads=dropUploads.filter(job=>job.id!==dismiss.dataset.uploadDismiss);settleUploads();render();return;}
 const deletion=e.target.closest('[data-delete]');
 if(deletion){
  openDelete(docs.filter(d=>d.id===deletion.dataset.delete));return;
 }
 const tag=e.target.closest('[data-tag]');if(tag){selectedIds.clear();filter=tag.dataset.tag;render();return;}
 const edit=e.target.closest('[data-edit]');if(edit){openForm(docs.find(d=>d.id===edit.dataset.edit));return;}
 const button=e.target.closest('[data-open]');if(!button)return;const doc=docs.find(d=>d.id===button.dataset.open);button.disabled=true;message('PDF 불러오는 중…');
 try{const blob=await(await request('/api/library/'+doc.id+'/file')).blob();viewerUrl=URL.createObjectURL(blob);$('pdfViewerTitle').textContent=doc.title;$('pdfDownload').href=viewerUrl;$('pdfDownload').download=doc.filename;$('pdfFrame').src=viewerUrl;$('pdfViewer').showModal();message('PDF를 불러왔습니다.');}catch(err){message(err.message,true);}finally{button.disabled=false;}
};
$('pdfViewerClose').onclick=()=>$('pdfViewer').close();$('pdfViewer').addEventListener('close',()=>{$('pdfFrame').removeAttribute('src');$('pdfDownload').removeAttribute('href');if(viewerUrl)URL.revokeObjectURL(viewerUrl);viewerUrl=null;});
window.addEventListener('hashchange',()=>{if(location.hash==='#pdf'&&!ready)load();});
if(sessionStorage.getItem('dowon:open-pdf')){sessionStorage.removeItem('dowon:open-pdf');location.hash='pdf';}
render();if(location.hash==='#pdf')load();
})();
