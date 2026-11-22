(() => {
  const $=id=>document.getElementById(id),base='https://api.3dowon.com';
  const readonly=document.documentElement.dataset.readonly==='true';
  let busy=false;
  async function request(path){const r=await fetch(base+'/api/signal-tester/backups'+path,{credentials:'include'});const data=await r.json();if(!r.ok)throw Error(data.error||'백업을 불러오지 못했습니다.');return data;}
  async function load(){
    if(busy||readonly)return;busy=true;$('signalBackupRefresh').disabled=true;
    $('signalBackupStatus').textContent='백업 목록을 확인하고 있습니다…';
    try{
      const result=await request('');$('signalBackupList').replaceChildren();
      $('signalBackupStatus').textContent=result.backups.length?'PC별 최신 설정 백업입니다. EXE의 설정 자동 백업에서 불러올 수 있습니다.':'아직 백업이 없습니다. EXE에서 대시보드 계정을 연결하세요.';
      for(const item of result.backups){
        const row=document.createElement('article');row.className='signal-backup-item';
        const info=document.createElement('div'),name=document.createElement('strong'),time=document.createElement('p');name.textContent=item.name;time.textContent=new Date(item.updatedAt).toLocaleString('ko-KR');info.append(name,time);
        const button=document.createElement('button');button.className='btn';button.textContent='설정 파일 받기';
        button.onclick=async()=>{button.disabled=true;try{const {backup}=await request('/'+encodeURIComponent(item.id));if(!backup)throw Error('백업을 찾을 수 없습니다.');const url=URL.createObjectURL(new Blob([JSON.stringify(backup.data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='SignalTester-'+item.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){$('signalBackupStatus').textContent=e.message;}finally{button.disabled=false;}};
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
