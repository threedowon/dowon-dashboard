(() => {
  'use strict';
  const $=id=>document.getElementById(id),base='https://api.3dowon.com';
  const readonly=document.documentElement.dataset.readonly==='true';
  const local=location.hostname!=='dashboard.3dowon.com';
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let documents=[],busy=false,ready=false;
  const message=text=>{$('transferStatus').textContent=text;};
  async function request(path='',options={}){
    const response=await fetch(base+'/api/transfers'+path,{credentials:'include',...options});
    if(!response.ok){if(response.status===401)ready=false;throw Error((await response.json().catch(()=>({}))).error||'요청에 실패했습니다. 다시 시도해주세요.');}
    return response;
  }
  function render(){
    $('transferConnect').disabled=busy||readonly||local;
    $('transferRefresh').disabled=busy||readonly||local;
    $('transferUpload').disabled=busy||!ready||readonly||local;
    $('transferMinutes').disabled=busy;
    $('transferList').innerHTML=documents.length?documents.map(d=>{
      const remaining=d.expiresAt-Date.now(),expired=remaining<=0;
      return '<article class="library-card"><h2 style="overflow-wrap:anywhere">'+esc(d.filename)+'</h2><p class="small">'+(d.size/1024/1024).toFixed(2)+' MB · '+(expired?'만료됨':Math.ceil(remaining/60000)+'분 남음')+'</p><p class="small">'+new Date(d.expiresAt).toLocaleString('ko-KR')+' 만료</p><div class="tools"><button class="btn primary" data-download="'+esc(d.id)+'"'+(busy||expired||!ready?' disabled':'')+'>내려받기</button><button class="btn danger editable" data-delete="'+esc(d.id)+'"'+(busy||!ready?' disabled':'')+'>삭제</button></div></article>';
    }).join(''):'<div class="empty">'+(readonly?'공유 문서에는 임시 파일이 포함되지 않습니다.':ready?'전달할 파일이 없습니다. 파일을 올려보세요.':'GitHub 연결 후 임시 파일을 볼 수 있습니다.')+'</div>';
  }
  async function load(){
    if(busy||readonly||local)return;
    busy=true;render();message('파일 목록을 불러오는 중…');
    try{documents=(await(await request()).json()).documents;ready=true;message('다른 PC에서도 같은 계정으로 연결한 뒤 이 페이지를 열어주세요.');}
    catch(e){ready=false;documents=[];message(e.message);}
    finally{busy=false;render();}
  }
  async function upload(files){
    if(busy||!ready||readonly||local)return;
    const selected=Array.from(files);if(!selected.length)return;
    busy=true;render();let saved=0;const errors=[];
    for(const file of selected){
      message('전송 중 ('+(saved+errors.length+1)+'/'+selected.length+'): '+file.name);
      try{
        if(file.size>5*1024**3)throw Error('5GB를 초과합니다.');
        const post=async(path,data)=> (await request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)})).json();
        let result;
        if(!file.size){const form=new FormData();form.set('file',file);form.set('minutes',$('transferMinutes').value);result=await(await request('',{method:'POST',body:form})).json();}
        else{
          const session=await post('/uploads',{filename:file.name,size:file.size,minutes:Number($('transferMinutes').value)});
          try{
            const parts=[];
            for(let offset=0;offset<file.size;offset+=session.partSize){
              const chunk=file.slice(offset,Math.min(offset+session.partSize,file.size));let part;
              for(let attempt=0;attempt<3;attempt++){
                try{part=await(await request('/uploads/'+session.id+'/part?number='+(parts.length+1),{method:'POST',headers:{'content-type':'application/octet-stream'},body:chunk})).json();break;}
                catch(e){if(attempt===2||!ready)throw e;await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));}
              }
              parts.push(part);message('전송 중: '+file.name+' · '+Math.round(Math.min(offset+chunk.size,file.size)/file.size*100)+'%');
            }
            for(let attempt=0;attempt<3;attempt++){try{result=await post('/uploads/'+session.id+'/complete',{parts});break;}catch(e){if(attempt===2||!ready)throw e;}}
          }catch(e){await post('/uploads/'+session.id+'/abort',{}).catch(()=>{});throw e;}
        }
        documents.unshift(result.document);saved++;
      }catch(e){errors.push(file.name+': '+e.message);}
    }
    busy=false;render();message(saved+'개 전송 완료.'+(errors.length?' 실패한 파일을 다시 선택해주세요. '+errors.join(' / '):' 다른 PC에서 새로고침하면 받을 수 있어요.'));
  }
  $('transferConnect').onclick=()=>{sessionStorage.setItem('dowon:open-transfers','1');location.href=base+'/auth/login';};
  $('transferRefresh').onclick=load;
  $('transferUpload').onclick=()=>$('transferFiles').click();
  $('transferFiles').onchange=()=>{upload($('transferFiles').files);$('transferFiles').value='';};
  $('transfersPage').addEventListener('dragover',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files'))e.preventDefault();});
  $('transfersPage').addEventListener('drop',e=>{e.preventDefault();if(!ready||busy){message('연결 상태를 확인하고 진행 중인 전송이 끝난 뒤 다시 놓아주세요.');return;}upload(e.dataTransfer.files);});
  $('transferList').onclick=async e=>{
    const button=e.target.closest('button');if(!button||busy||readonly||!ready)return;
    const doc=documents.find(d=>d.id===(button.dataset.download||button.dataset.delete));if(!doc)return;
    const deleting=!!button.dataset.delete;
    if(deleting&&!confirm('“'+doc.filename+'”을 삭제할까요?'))return;
    busy=true;render();message(deleting?'삭제 중…':'다운로드 준비 중…');
    try{
      if(deleting){await request('/'+doc.id+'/delete',{method:'POST'});documents=documents.filter(d=>d.id!==doc.id);message('삭제했습니다.');}
      else{
        const a=document.createElement('a');a.href=base+'/api/transfers/'+doc.id+'/file';a.referrerPolicy='strict-origin-when-cross-origin';document.body.append(a);a.click();a.remove();message('다운로드를 요청했습니다. 브라우저 다운로드 목록을 확인해주세요.');
      }
    }catch(error){message(error.message);}finally{busy=false;render();}
  };
  window.addEventListener('hashchange',()=>{if(location.hash==='#transfers')load();});
  setInterval(()=>{if(location.hash==='#transfers'&&!busy)render();},30000);
  if(!readonly&&sessionStorage.getItem('dowon:open-transfers')){sessionStorage.removeItem('dowon:open-transfers');location.hash='transfers';}
  render();
  if(local)message('로컬 미리보기입니다. 파일 전송은 배포된 대시보드에서 이용해주세요.');
  else if(location.hash==='#transfers')load();
})();
