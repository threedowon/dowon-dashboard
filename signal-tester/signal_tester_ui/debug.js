/* Read-only local diagnostics, separate from the sending workspace. */
globalThis.SignalDebug = (() => {
  const results = {transitioned:'장면 전환', queued:'타임라인 분기 대기', matched:'다른 조건 대기',
    ignored:'일치하는 조건 없음', cooldown:'Player 쿨다운', unknown:'등록되지 않은 키',
    stopped:'재생 정지', busy:'전환 진행 중', unavailable:'Player 처리 불가'};
  function outcome(event) {
    if (event.protocol === 'http') {
      if (event.received) return {kind:'acknowledged', label:'Player 수신 확인', detail:results[event.status] || event.label, tone:event.status==='transitioned'?'good':'warning'};
      if (event.stage === 'cooldown') return {kind:'blocked', label:'보내지 않음', detail:'Tester 쿨다운', tone:'warning'};
      return {kind:'unconfirmed', label:'Player 수신 미확인', detail:event.label || '전송 결과 없음', tone:'bad'};
    }
    if (event.direction === 'RX') return {kind:'received', label:'센서 데이터 수신', detail:event.protocol.toUpperCase()+' RX', tone:'good'};
    return {kind:event.ok===false?'error':'other', label:event.label, detail:event.protocol.toUpperCase()+' '+event.direction, tone:event.ok===false?'bad':'warning'};
  }
  function filter(events, {key='', kind='all', search=''}={}) {
    const needle=search.trim().toLowerCase();
    return events.filter(event => (!key || event.protocol==='http' && event.key===key) &&
      (kind==='all' || kind==='http' && event.protocol==='http' || outcome(event).kind===kind) &&
      (!needle || [event.key,event.target?.name,event.origin,event.label,event.detail,event.packet?.text,event.peer].join(' ').toLowerCase().includes(needle)));
  }
  return {outcome,filter};
})();

if (typeof document !== 'undefined') (() => {
  const $=id=>document.getElementById(id), token=document.querySelector('meta[name="tester-token"]').content;
  let latest=null, shown=null, paused=false, selected=null, key='', connected=false, lastUpdated='', shownAt='';
  const text=(tag,value,cls='')=>{const node=document.createElement(tag);node.textContent=value;node.className=cls;return node;};
  const value=raw=>JSON.stringify(raw ?? null);
  const time=stamp=>stamp ? new Date(stamp).toLocaleTimeString('ko-KR',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3}) : '—';
  const address=target=>!target?'—':target.type==='serial'?`${target.device} · ${target.baudrate}`:target.type==='udp'?`${target.bindHost}:${target.bindPort} → ${target.remoteHost}:${target.remotePort}`:`${target.host}:${target.port}`;
  const visible=()=>SignalDebug.filter(shown?.events||[],{key,kind:$('debugKind').value,search:$('debugSearch').value});
  function connection() {
    $('debugConnection').textContent=!connected?'프로그램 연결 끊김 · 표시된 기록은 마지막 수신 시점의 내용입니다. 본 프로그램을 확인하세요.':paused?`화면 일시정지 · 통신과 기록은 계속됩니다. 화면 기준 ${shownAt}`:`실시간 수신 중 · 마지막 갱신 ${lastUpdated}`;
    $('debugConnection').classList.toggle('offline',!connected);
  }
  function details(event) {
    selected=event;
    const host=$('debugDetail');host.replaceChildren();
    const result=SignalDebug.outcome(event);
    host.append(text('strong',event.key||event.target?.name||'통신 기록'),text('p',`${result.label} · ${result.detail}`),
      text('p',`${time(event.time)} · ${event.target?.name||'—'} · ${address(event.target)}`),text('p',event.origin||event.stage||''));
    if (event.detail) host.append(text('p',event.detail));
    if (event.protocol==='http') {
      host.append(text('h3',event.stage==='cooldown'?'차단된 요청 · 전송되지 않음':'전송 요청 · POST /signal'),text('pre',JSON.stringify({key:event.key,value:event.value},null,2)),
        text('h3','Player 응답'),text('pre',event.response?JSON.stringify(event.response,null,2):'수신 확인 응답이 없습니다. 시간 초과 등으로 응답을 받지 못한 경우 실제 수신 여부는 알 수 없습니다.'));
      if (event.elapsed != null) host.append(text('p',`처리 시간 ${event.elapsed} ms`));
    }
    if (event.packet) {
      host.append(text('h3',`원문 · ${event.packet.bytes} B${event.packet.truncated?' · 앞부분만 표시':''}`),text('pre',event.packet.text||'(빈 데이터)'),text('h3','HEX'),text('pre',event.packet.hex||'(없음)'));
      if(event.peer)host.append(text('p','상대 주소 · '+event.peer));
    }
    if (event.error) host.append(text('pre',event.error));
  }
  function renderRows() {
    const events=visible(), host=$('debugEvents');host.replaceChildren();
    $('debugVisibleCount').textContent=`${events.length}건`;
    for (const event of events) {
      const result=SignalDebug.outcome(event), row=document.createElement('button');
      row.type='button';row.className='debug-event';row.setAttribute('aria-pressed',String(selected?.id===event.id));
      row.append(text('time',time(event.time)),text('strong',event.key||event.packet?.text?.replace(/\s+/g,' ').slice(0,100)||event.label),
        text('span',result.label,'badge '+result.tone),text('small',`${event.target?.name||'—'} · ${event.origin||event.protocol.toUpperCase()+' '+event.direction} · ${result.detail}`));
      row.onclick=()=>{details(event);renderRows();};host.append(row);
    }
    if(!events.length)host.append(text('p','해당 기록이 없습니다. 본 화면에서 연결을 열거나 Signal을 전송하세요.','debug-empty'));
    $('debugExport').disabled=!shown;
  }
  function render(data) {
    if (shown && shown.generation!==data.generation) {selected=null;$('debugDetail').replaceChildren(text('p','본 화면에서 Activity 기록을 지웠습니다.'));}
    shown=data;
    shownAt=lastUpdated;
    const cards=$('debugWatched');cards.replaceChildren();
    for (const [name, watched] of Object.entries(data.watched)) {
      const card=text('section','','debug-signal-card'), result=watched.last&&SignalDebug.outcome(watched.last);
      card.append(text('h2',name),text('strong',result?`${result.label} · ${result.detail}`:'아직 전송 기록 없음'),
        text('p',watched.last?`${time(watched.last.time)} · ${watched.last.target?.name||'—'} · 값 ${value(watched.last.value)}`:'Signal 키별 최근 결과'),
        text('small',`수신 확인 ${watched.acknowledged} · 미확인 ${watched.unconfirmed} · 차단 ${watched.blocked}`));
      if(result)card.classList.add(result.tone);cards.append(card);
    }
    const c=data.counts;$('debugCounts').textContent=`이번 실행 · 센서 RX ${c.received} · Player 수신 확인 ${c.acknowledged} · 수신 미확인 ${c.unconfirmed} · Tester 차단 ${c.blocked} · 통신 오류 ${c.error}`;
    const sensors=$('debugSensors');sensors.replaceChildren(text('p',data.runtime.armed?'자동 규칙 실행 중':'자동 규칙 정지 상태'));
    for (const state of data.runtime.monitors) {
      const config=data.sensors.find(s=>s.id===state.id);
      sensors.append(text('p',`${config?.name||state.id}: ${state.value ?? '—'} ${config?.unit||''} · ${state.status}${!state.live?' · 현재 유효값 아님':''}`));
      for (const rule of state.rules) sensors.append(text('small',`규칙: ${rule.status}${rule.lastResult?' · '+rule.lastResult:''}`));
    }
    if(!data.runtime.monitors.length)sensors.append(text('p','등록된 센서 모니터가 없습니다. Raw 수신 기록은 아래에서 볼 수 있습니다.'));
    renderRows();
  }
  async function poll() {
    try {
      const pair=token==='__TESTER_TOKEN__'?JSON.parse(sessionStorage.getItem('dowon-signal-pairing')||'null'):null;
      if(token==='__TESTER_TOKEN__'&&(!pair||!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(pair.base)||!/^[A-Za-z0-9_-]{43}$/.test(pair.token)))throw Error('PC connection required');
      const response=await fetch((pair?.base||'')+'/api/debug',{headers:{'X-Tester-Token':pair?.token||token},signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('offline');
      latest=await response.json();connected=true;lastUpdated=time(Date.now());
      if(!paused)render(latest);
    } catch {connected=false;} finally {connection();setTimeout(poll,1000);}
  }
  $('debugPause').onclick=()=>{paused=!paused;$('debugPause').textContent=paused?'실시간으로 돌아가기':'화면 일시정지';if(!paused&&latest)render(latest);connection();};
  $('debugKind').onchange=renderRows;$('debugSearch').oninput=renderRows;
  for(const button of document.querySelectorAll('[data-debug-key]'))button.onclick=()=>{key=button.dataset.debugKey;for(const other of document.querySelectorAll('[data-debug-key]'))other.setAttribute('aria-pressed',String(other===button));renderRows();};
  $('debugExport').onclick=()=>{
    const data={exportedAt:new Date().toISOString(),paused,counts:shown.counts,watched:shown.watched,events:visible()};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');
    link.href=url;link.download='signal-debug-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  poll();
})();
