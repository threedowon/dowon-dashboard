(() => {
  const $=id=>document.getElementById(id),base='https://api.3dowon.com';
  const readonly=document.documentElement.dataset.readonly==='true';
  let busy=false;
  async function request(path){const r=await fetch(base+'/api/signal-tester/backups'+path,{credentials:'include'});const data=await r.json();if(!r.ok)throw Error(data.error||'Could not load backups.');return data;}
  async function load(){
    if(busy||readonly)return;busy=true;$('signalBackupRefresh').disabled=true;
    $('signalBackupStatus').textContent='Loading backups…';
    try{
      const result=await request('');$('signalBackupList').replaceChildren();
      $('signalBackupStatus').textContent=result.backups.length?'Latest settings for each PC. Restore them from Settings backup in the app.':'No backups yet. Connect your dashboard account in the app to get started.';
      for(const item of result.backups){
        const row=document.createElement('article');row.className='signal-backup-item';
        const info=document.createElement('div'),name=document.createElement('strong'),time=document.createElement('p');name.textContent=item.name;time.textContent=new Date(item.updatedAt).toLocaleString('en-GB', {year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});info.append(name,time);
        const button=document.createElement('button');button.className='btn';button.textContent='Download JSON';
        button.onclick=async()=>{button.disabled=true;try{const {backup}=await request('/'+encodeURIComponent(item.id));if(!backup)throw Error('Backup not found.');const url=URL.createObjectURL(new Blob([JSON.stringify(backup.data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='SignalTester-'+item.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){$('signalBackupStatus').textContent=e.message;}finally{button.disabled=false;}};
        row.append(info,button);$('signalBackupList').append(row);
      }
    }catch(e){$('signalBackupStatus').textContent=e.message;}
    finally{busy=false;$('signalBackupRefresh').disabled=false;}
  }
  $('signalBackupConnect').onclick=()=>{if(readonly)return;sessionStorage.setItem('dowon:open-signaltester','1');location.href=base+'/auth/login';};
  $('signalBackupRefresh').onclick=load;
  try{if(sessionStorage.getItem('dowon:open-signaltester')){sessionStorage.removeItem('dowon:open-signaltester');location.hash='signaltester';}}catch{}
  addEventListener('hashchange',()=>{if(location.hash==='#signaltester')load();});
  if(location.hash==='#signaltester')load();
})();
