(() => {
  'use strict';
  const $=id=>document.getElementById(id),base='https://api.3dowon.com';
  const readonly=document.documentElement.dataset.readonly==='true';
  const local=location.hostname!=='dashboard.3dowon.com';
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let documents=[],busy=false,ready=false,pending=[],jobs=[];
  const uploads=new WeakMap();
  const message=text=>{$('transferStatus').textContent=text;};
  const expires=d=>typeof d.expiresAt==='number'?d.expiresAt:Number(d.expiresAt)||Date.parse(d.expiresAt);
  const countdown=timestamp=>{const seconds=Math.max(0,Math.ceil((timestamp-Date.now())/1000));return Number.isFinite(seconds)&&seconds>0?'Expires in '+String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'):'Expired';};
  const sizeLabel=size=>size>=1024**3?(size/1024**3).toFixed(2)+' GB':size>=1024**2?(size/1024**2).toFixed(1)+' MB':size>=1024?(size/1024).toFixed(1)+' KB':size+' B';
  const fileIcon=name=>{const ext=name.split('.').pop().toLowerCase(),kind=/^(zip|rar|7z|gz|tar)$/.test(ext)?'archive':ext==='pdf'?'pdf':/^(png|jpg|jpeg|gif|webp|svg|avif)$/.test(ext)?'image':'file';return '<span class="transfer-file-icon transfer-icon-'+kind+'" aria-hidden="true"></span>';};
  function renderRows(){
    const uploading=jobs.filter(j=>j.state!=='done').map(j=>{
      const active=j.state==='uploading'||j.state==='finishing',status=j.state==='queued'?'Waiting to upload':j.state==='cancelled'?'Cancelled':j.state==='failed'?'Upload failed':j.state==='finishing'?'Finishing upload…':'Uploading '+j.progress+'%';
      const progress=active?'<progress max="100" value="'+j.progress+'" aria-label="Upload progress for '+esc(j.file.name)+'"></progress>':'';
      const action=j.state==='queued'||j.state==='uploading'?'<button class="btn" data-cancel="'+jobs.indexOf(j)+'">Cancel</button>':j.state==='failed'?'<span>Use Retry upload</span>':j.state==='finishing'?'<span>Finishing…</span>':'—';
      return '<tr class="'+(active?'is-uploading':'')+'"><td><div class="transfer-file">'+fileIcon(j.file.name)+'<span>'+esc(j.file.name)+'</span></div></td><td>'+sizeLabel(j.file.size)+'</td><td><div class="transfer-upload-status">'+status+'</div>'+progress+(j.error?'<small class="transfer-error">'+esc(j.error)+'</small>':'')+'</td><td class="transfer-actions">'+action+'</td></tr>';
    }).join('');
    const rows=documents.map(d=>{
      const expiry=expires(d),expired=!Number.isFinite(expiry)||expiry<=Date.now();
      return '<tr><td><div class="transfer-file">'+fileIcon(d.filename)+'<span>'+esc(d.filename)+'</span></div></td><td>'+sizeLabel(d.size)+'</td><td><span data-ready="'+esc(d.id)+'">'+(expired?'File expired':'Ready to download')+'</span><time class="transfer-countdown" data-expires="'+expiry+'" data-file="'+esc(d.id)+'">'+countdown(expiry)+'</time></td><td class="transfer-actions"><button class="btn" data-download="'+esc(d.id)+'"'+(busy||expired||!ready?' disabled':'')+'>Download</button><button class="btn transfer-delete editable" data-delete="'+esc(d.id)+'"'+(busy||!ready?' disabled':'')+' aria-label="Delete '+esc(d.filename)+'">Delete</button></td></tr>';
    }).join('');
    const empty='<tr><td colspan="4" class="transfer-empty">'+(readonly?'Temporary files are not included in shared documents.':ready?'No files yet. Add files or drop them here.':'Connect GitHub to send and receive files.')+'</td></tr>';
    $('transferList').innerHTML='<table class="transfer-table" aria-label="File transfers"><thead><tr><th scope="col">File</th><th scope="col">Size</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>'+((uploading+rows)||empty)+'</tbody></table>';
  }
  function updateCountdowns(){
    for(const el of $('transferList').querySelectorAll('[data-expires]')){
      const text=countdown(Number(el.dataset.expires));if(el.textContent!==text)el.textContent=text;
      if(text==='Expired'){
        const row=el.closest('tr');row.querySelector('[data-download]').disabled=true;row.querySelector('[data-ready]').textContent='File expired';
      }
    }
  }
  async function request(path='',options={}){
    const response=await fetch(base+'/api/transfers'+path,{credentials:'include',...options});
    if(!response.ok){if(response.status===401)ready=false;throw Error((await response.json().catch(()=>({}))).error||'Request failed. Please try again.');}
    return response;
  }
  function render(){
    $('transferConnect').disabled=busy||readonly||local;
    $('transferRefresh').disabled=busy||readonly||local;
    $('transferUpload').disabled=busy||!ready||readonly||local;
    $('transferMinutes').disabled=busy;
    $('transferRetry').hidden=!pending.length;
    $('transferRetry').disabled=busy||!ready;
    renderRows();
  }
  async function load(){
    if(busy||readonly||local)return;
    busy=true;render();message('Loading files…');
    try{documents=(await(await request()).json()).documents;ready=true;jobs=jobs.filter(j=>j.state==='failed');message('');}
    catch(e){ready=false;documents=[];message(e.message);}
    finally{busy=false;render();}
  }
  async function upload(files){
    if(busy||!ready||readonly||local)return;
    const selected=Array.from(files);if(!selected.length)return;
    pending=[];jobs=selected.map(file=>({file,state:'queued',progress:0,controller:new AbortController()}));busy=true;render();let saved=0;const errors=[];
    for(const job of jobs){
      if(job.state==='cancelled')continue;
      const file=job.file,signal=job.controller.signal;job.state='uploading';renderRows();
      message('Uploading ('+(jobs.indexOf(job)+1)+'/'+selected.length+'): '+file.name);
      try{
        if(file.size>5*1024**3)throw Error('File exceeds the 5GB limit.');
        const post=async(path,data)=> (await request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)})).json();
        let result;
        if(!file.size){job.state='finishing';renderRows();const form=new FormData();form.set('file',file);form.set('minutes',$('transferMinutes').value);result=await(await request('',{method:'POST',body:form})).json();}
        else{
          let session=uploads.get(file);
          if(!session){session={...await post('/uploads',{filename:file.name,size:file.size,minutes:Number($('transferMinutes').value)}),parts:[]};uploads.set(file,session);}
          signal.throwIfAborted();
          const count=Math.ceil(file.size/session.partSize);let next=0,failed=null;
          const showProgress=()=>{const bytes=session.parts.reduce((sum,part,i)=>sum+(part?Math.min(session.partSize,file.size-i*session.partSize):0),0);job.progress=Math.floor(bytes/file.size*100);renderRows();};
          showProgress();
          const retry=async action=>{
            for(let attempt=0;;attempt++){
              try{signal.throwIfAborted();return await action();}catch(e){
                if(signal.aborted||attempt===5||!ready)throw e;
                message('Retrying connection: '+file.name+' ('+(attempt+1)+'/5)');
                await new Promise(resolve=>setTimeout(resolve,Math.min(15000,2000*2**attempt)));
              }
            }
          };
          const send=async()=>{
            while(!failed){
              if(signal.aborted)return;
              const index=next++;if(index>=count)return;if(session.parts[index])continue;
              const offset=index*session.partSize,chunk=file.slice(offset,Math.min(offset+session.partSize,file.size));
              try{
                const part=await retry(async()=> (await request('/uploads/'+session.id+'/part?number='+(index+1),{method:'POST',headers:{'content-type':'application/octet-stream'},body:chunk,signal:AbortSignal.any([signal,AbortSignal.timeout(120000)])})).json());
                session.parts[index]=part;
                showProgress();
                message('Uploading: '+file.name+' · '+job.progress+'%');
              }catch(e){failed=e;}
            }
          };
          await Promise.all(Array.from({length:4},()=>send()));
          signal.throwIfAborted();
          if(failed)throw failed;
          job.state='finishing';renderRows();
          result=await retry(()=>post('/uploads/'+session.id+'/complete',{parts:session.parts}));
          uploads.delete(file);
        }
        documents.unshift(result.document);job.state='done';saved++;
      }catch(e){
        if(signal.aborted){job.state='cancelled';const session=uploads.get(file);if(session){try{await request('/uploads/'+session.id+'/abort',{method:'POST'});}catch{}uploads.delete(file);}}
        else{job.state='failed';job.error=e.message;pending.push(file);errors.push(file.name+': '+e.message);}
      }
      renderRows();
    }
    busy=false;render();const cancelled=jobs.filter(j=>j.state==='cancelled').length;message(saved+' file(s) uploaded.'+(cancelled?' '+cancelled+' cancelled.':'')+(errors.length?' Use Retry upload to resume. '+errors.join(' / '):saved?' Refresh on another device to download.':''));
  }
  $('transferConnect').onclick=()=>{sessionStorage.setItem('dowon:open-transfers','1');location.href=base+'/auth/login';};
  $('transferRefresh').onclick=load;
  $('transferRetry').onclick=()=>upload(pending.slice());
  $('transferUpload').onclick=()=>$('transferFiles').click();
  $('transferFiles').onchange=()=>{upload($('transferFiles').files);$('transferFiles').value='';};
  $('transfersPage').addEventListener('dragover',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files'))e.preventDefault();});
  $('transfersPage').addEventListener('drop',e=>{e.preventDefault();if(!ready||busy){message('Connect GitHub and wait for the current transfer to finish before adding files.');return;}upload(e.dataTransfer.files);});
  $('transferList').onclick=async e=>{
    const button=e.target.closest('button');if(!button||readonly||!ready)return;
    if(button.dataset.cancel!==undefined){const job=jobs[Number(button.dataset.cancel)];if(job&&['queued','uploading'].includes(job.state)){job.controller.abort();job.state='cancelled';renderRows();}return;}
    if(busy)return;
    const doc=documents.find(d=>d.id===(button.dataset.download||button.dataset.delete));if(!doc)return;
    const deleting=!!button.dataset.delete;
    if(!deleting&&(!Number.isFinite(expires(doc))||expires(doc)<=Date.now())){render();message('This file has expired.');return;}
    if(deleting&&!confirm('Delete “'+doc.filename+'”?'))return;
    busy=true;render();message(deleting?'Deleting…':'Preparing download…');
    try{
      if(deleting){await request('/'+doc.id+'/delete',{method:'POST'});documents=documents.filter(d=>d.id!==doc.id);message('File deleted.');}
      else{
        const a=document.createElement('a');a.href=base+'/api/transfers/'+doc.id+'/file';a.referrerPolicy='strict-origin-when-cross-origin';document.body.append(a);a.click();a.remove();message('Download requested. Check your browser downloads.');
      }
    }catch(error){message(error.message);}finally{busy=false;render();}
  };
  window.addEventListener('hashchange',()=>{if(location.hash==='#transfers')load();});
  setInterval(()=>{if(location.hash==='#transfers')updateCountdowns();},1000);
  if(!readonly&&sessionStorage.getItem('dowon:open-transfers')){sessionStorage.removeItem('dowon:open-transfers');location.hash='transfers';}
  render();
  if(local)message('Local preview. File transfers are available on the deployed dashboard.');
  else if(location.hash==='#transfers')load();
})();
