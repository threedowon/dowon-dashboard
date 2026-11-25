'use strict';
(() => {
  if(location.origin!=='https://dashboard.3dowon.com'){
    if(location.hostname==='127.0.0.1'&&location.pathname==='/')document.addEventListener('DOMContentLoaded',async()=>{
      try{
        const token=document.querySelector('meta[name="tester-token"]').content;
        const response=await fetch('/api/cloud/status',{headers:{'X-Tester-Token':token}});
        if(response.ok&&(await response.json()).hostedUI)location.replace('https://dashboard.3dowon.com/signal-tester/signal_tester_ui/index.html');
      }catch{}
    });
    return;
  }
  let popup=null;
  window.addEventListener('message',event=>{
    if(!popup||event.source!==popup||event.origin!=='http://127.0.0.1:6699')return;
    const data=event.data;
    if(data?.type!=='signal-tester-pair'||data.base!==event.origin||!/^[A-Za-z0-9_-]{43}$/.test(data.token))return;
    sessionStorage.setItem('dowon-signal-pairing',JSON.stringify({base:data.base,token:data.token}));
    popup=null;location.reload();
  });
  document.addEventListener('DOMContentLoaded',()=>{
    const status=document.getElementById('workspaceStatus');if(!status)return;
    function connectButton(){
      const b=document.createElement('button');b.type='button';b.className='button bridge-connect';b.textContent='이 PC 통신 프로그램 연결';
      b.onclick=()=>{
        popup=window.open('http://127.0.0.1:6699/pair','signal-tester-pair','width=520,height=320');
        if(!popup)document.getElementById('workspaceDetail').textContent='팝업을 허용한 뒤 다시 연결해 주세요.';
      };return b;
    }
    status.append(connectButton());document.getElementById('settingsContent')?.append(connectButton());
    const link=document.createElement('a');link.className='button';link.href='https://github.com/threedowon/dowon-dashboard/releases/latest/download/SignalTester.exe';link.textContent='최신 통신 프로그램 다운로드';status.append(link);
  });
})();
