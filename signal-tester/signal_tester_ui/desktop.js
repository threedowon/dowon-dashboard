'use strict';
// Credentials stay in Python; this UI receives settings and status only.
(() => {
  let state=null,working=false;
  const date=value=>value?new Date(value).toLocaleString('ko-KR'):'아직 없음';
  function renderCloud(){
    if(!state)return;
    const text=!state.connected?(state.error||'대시보드 연결 후 자동 백업'):state.conflict?'백업 충돌 · 확인 필요':state.error?'이 PC에 저장됨 · '+state.error:state.busy?'설정 백업 중…':state.dirty?'이 PC에 저장됨 · 자동 백업 대기':'자동 백업 완료 · '+date(state.updatedAt);
    $('desktopBackupStatus').textContent=text;$('cloudStatus').textContent=(state.login?state.login+' · ':'')+text;
    if(!$('cloudName').dataset.edited)$('cloudName').value=state.name;
    $('cloudConnect').disabled=working;
    $('cloudConnect').textContent=state.pendingLogin?'로그인 다시 열기':state.connected?'계정 다시 연결':'대시보드 계정 연결';
    for(const id of ['cloudList','cloudSync','cloudDisconnect'])$(id).disabled=working||!state.connected;
    $('cloudForce').hidden=!state.conflict;$('cloudForce').disabled=working;
  }
  async function refresh(){try{const result=await api('cloud/status');$('desktopBar').hidden=!result.desktop;$('webDevNotice').hidden=!result.webDev;$('webRestart').hidden=!result.webRestart;$('desktopBackup').disabled=!result.cloud;state=result.cloud;renderCloud();}catch{}}
  async function task(work){if(working)return;working=true;renderCloud();try{await work();}catch(e){toast(e.message,true);}finally{working=false;await refresh();}}
  $('cloudClose').onclick=()=>$('cloudDialog').close();
  $('cloudName').oninput=()=>{$('cloudName').dataset.edited='true';};
  $('desktopBackup').onclick=()=>{$('cloudDialog').showModal();refresh();};
  $('cloudConnect').onclick=()=>{const name=$('cloudName').value;task(async()=>{state=await api('cloud/connect',{name});delete $('cloudName').dataset.edited;renderCloud();});};
  $('cloudSync').onclick=()=>task(async()=>{state=await api('cloud/sync',{});if(state.error)throw Error(state.error);});
  $('cloudForce').onclick=()=>task(async()=>{
    if(!await confirmAction('이 PC 설정으로 백업할까요?','클라우드의 이 PC 백업을 현재 설정으로 갱신합니다. 다른 PC 백업은 유지됩니다.','백업 갱신'))return;
    state=await api('cloud/sync',{force:true});if(state.error)throw Error(state.error);
  });
  $('cloudDisconnect').onclick=()=>task(async()=>{
    if(!await confirmAction('자동 백업 연결을 해제할까요?','로컬 설정과 기존 백업은 유지됩니다. 이후 변경은 이 PC에만 저장됩니다.','연결 해제'))return;
    await api('cloud/disconnect',{});$('cloudBackups').replaceChildren();
  });
  $('cloudList').onclick=()=>task(async()=>{
    const result=await api('cloud/backups');$('cloudBackups').replaceChildren();
    if(!result.backups.length)$('cloudBackups').append(el('p','muted','저장된 백업이 없습니다.'));
    for(const backup of result.backups){
      const row=el('div','cloud-backup-row'),info=el('div');
      info.append(el('strong','',backup.name+(backup.id===state.device?' · 이 PC':'')),el('p','muted',date(backup.updatedAt)));
      row.append(info,button('button','불러오기',()=>task(async()=>{
        if(lockWorkspace())return;
        if(!await confirmAction('백업 설정을 불러올까요?',backup.name+'의 설정으로 교체합니다. 현재 설정은 복구 파일로 보관하며 모든 연결과 자동 규칙을 정지합니다. COM 포트와 IP를 확인한 뒤 다시 연결하세요.','불러오기'))return;
        const result=await api('cloud/restore',{id:backup.id,revision:workspaceRevision});
        workspace=result.workspace;workspaceRevision=result.revision;selectedId=null;healthChecks.clear();keyboardEnabled=false;
        applyRuntime(result);render();$('cloudRestoreNote').textContent='복원 완료 · COM 포트와 IP를 확인하세요. 이전 설정: '+result.recovery;
        toast('설정 복원 완료 · 연결과 자동 규칙은 정지 상태입니다.');
      })));
      $('cloudBackups').append(row);
    }
  });
  $('desktopExit').onclick=safe(async()=>{
    if(saving||sending||ioBusy){toast('진행 중인 작업이 끝난 후 종료하세요.',true);return;}
    const pending=state?.dirty?' 백업 대기 중인 설정은 이 PC에 보관되고 다음 실행 시 다시 백업합니다.':'';
    if(!await confirmAction('Signal Tester를 종료할까요?','Serial·UDP 연결과 자동 규칙이 모두 종료됩니다.'+pending,'프로그램 종료'))return;
    await api('exit',{});
  });
  $('webRestart').onclick=safe(async()=>{
    if($('webRestart').disabled)return;
    if(lockWorkspace())return;
    if(!await confirmAction('변경사항을 적용하고 다시 시작할까요?','설정은 유지됩니다. Serial·UDP 연결과 자동 규칙은 정지하며 송수신 기록은 초기화됩니다. 필요한 기록은 먼저 내보내세요. 다시 시작한 뒤 사용할 연결과 규칙을 켜주세요.','적용 · 다시 시작'))return;
    $('webRestart').disabled=true;
    $('webRestartStatus').textContent='변경사항 적용 중… 준비되면 이 화면이 자동으로 새로고침됩니다.';
    try{
      await api('web/restart',{});
      for(let attempt=0;attempt<90;attempt++){
        await new Promise(resolve=>setTimeout(resolve,1000));
        try{
          const response=await fetch('/',{cache:'no-store',signal:AbortSignal.timeout(2000)});
          if(!response.ok)continue;
          const html=await response.text();
          const nextToken=/name="tester-token" content="([A-Za-z0-9_-]{43})"/.exec(html)?.[1];
          if(nextToken&&nextToken!==token){location.reload();return;}
        }catch{}
      }
      throw Error('다시 시작을 확인하지 못했습니다. Start-Web-Tester.cmd를 실행한 뒤 새로고침하세요.');
    }catch(error){
      $('webRestartStatus').textContent=error.message;
      $('webRestart').disabled=false;
    }
  });
  refresh();setInterval(refresh,5000);
})();
