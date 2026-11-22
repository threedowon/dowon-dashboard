'use strict';
(() => {
  let state=null,busy=false;
  function renderUpdate(){
    if(!state)return;
    $('updateBar').hidden=!state.enabled;
    const working=['checking','downloading','restarting'].includes(state.phase);
    const messages={checking:'새 버전 확인 중…',current:'최신 버전입니다.',available:`새 버전 ${state.latest}을 사용할 수 있습니다.`,downloading:`업데이트 다운로드 중 · ${state.progress}%`,restarting:'업데이트 적용 중 · 잠시 후 자동으로 다시 열립니다.'};
    let message=state.error||messages[state.phase]||'';
    if(state.result?.kind==='error'&&!state.error)message=state.result.message+' · 업데이트 확인으로 다시 시도하세요.';
    if(state.result?.kind==='success'&&state.result.version===state.current&&state.phase==='current')message='업데이트 완료 · 최신 버전입니다.';
    $('updateStatus').textContent=`v${state.current} · ${message}`;
    $('updateCheck').disabled=busy||working;
    $('updateInstall').hidden=!state.latest||state.phase==='restarting';
    $('updateInstall').disabled=busy||working;
    $('updateInstall').textContent=`v${state.latest} 업데이트`;
  }
  async function refresh(){try{state=await api('update/status');renderUpdate();}catch{}}
  $('updateCheck').onclick=safe(async()=>{if(busy)return;busy=true;renderUpdate();try{state=await api('update/check',{});}finally{busy=false;renderUpdate();}});
  $('updateInstall').onclick=safe(async()=>{
    if(busy||!state?.latest)return;
    if(saving||sending||ioBusy){toast('진행 중인 작업이 끝난 후 업데이트하세요.',true);return;}
    const version=state.latest;
    busy=true;renderUpdate();
    try{
      if(!await confirmAction('새 버전으로 업데이트할까요?',`v${version}을 내려받아 확인한 뒤 프로그램을 종료하고 다시 엽니다. 통신과 자동 규칙은 정지하며 기존 설정과 백업 계정 연결은 유지됩니다.`,'업데이트 후 재실행'))return;
      state=await api('update/install',{version});
    }finally{busy=false;renderUpdate();}
  });
  refresh();setInterval(refresh,1000);
})();
