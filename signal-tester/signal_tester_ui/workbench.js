'use strict';
// The workbench reuses the existing engine, forms and workspace persistence.
let oscSelected='', oscArgument=0, oscFilter='', oscRowsSignature='', rulesSignature='';
let oscPlotPoints=[], oscPlotKey='', oscRequestBusy=false, workbenchTarget=null;
const oscValue=value=>typeof value==='string'?value:JSON.stringify(value);
const oscRows=()=>connectionStates[active()?.id]?.osc?.addresses||[];
function workbenchSetup(){
  const sidebar=document.querySelector('.sidebar'),heading=sidebar.querySelector('.sidebar-heading');
  sidebar.id='deviceSidebar';
  const toggle=button('icon-button sidebar-toggle','‹',()=>setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed')));
  toggle.id='sidebarToggle';toggle.setAttribute('aria-controls','deviceSidebar');heading.append(toggle);
  function setSidebarCollapsed(collapsed){
    document.body.classList.toggle('sidebar-collapsed',collapsed);
    toggle.textContent=collapsed?'›':'‹';toggle.title=collapsed?'장치 목록 펼치기':'장치 목록 접기';
    toggle.setAttribute('aria-label',toggle.title);toggle.setAttribute('aria-expanded',String(!collapsed));
    try{localStorage.setItem('signalTesterSidebarCollapsed',String(collapsed));}catch{}
  }
  let collapsed=false;try{collapsed=localStorage.getItem('signalTesterSidebarCollapsed')==='true';}catch{}
  setSidebarCollapsed(collapsed);

  $('paneLogs').append(document.querySelector('.activity-rail'));
  const diagnostics=el('details','connection-diagnostics');diagnostics.id='connectionDiagnostics';diagnostics.append(el('summary','','연결 진단 · 수신 원문 / HEX'),$('ioPanel'));$('paneSensors').append(diagnostics);
  const allSensors=el('details','all-sensors');allSensors.id='allSensors';allSensors.append(el('summary','','전체 센서 값 보기'),$('sensorOverview'));$('sensorBody').prepend(allSensors);
  const calibration=document.querySelector('.sensor-fsr-note');if(calibration)calibration.remove();
  const settings=$('settingsContent');
  for(const id of ['desktopBar','updateBar','webDevNotice'])settings.append($(id));
  const tools=el('div','settings-tools');tools.append(document.querySelector('.workspace-tools'));settings.append(tools);
  $('openSettings').onclick=()=>$('settingsDialog').showModal();
  $('goRules').onclick=()=>showTab('rules');
  $('rulesAddSensor').onclick=()=>$('addSensor').click();
  $('rulesArm').onclick=()=>$('sensorArm').click();
  $('sensorHub').textContent='센서 모니터';
  $('sensorHub').onclick=()=>showTab('sensors');
  $('importWorkspace').textContent='설정 불러오기';$('exportWorkspace').textContent='설정 내보내기';
  const plate=el('div','instrument-plate');
  plate.innerHTML='<strong>CHANNEL / INPUT</strong><span id="channelPlate">NO DEVICE</span><div class="calibration" aria-hidden="true"><span>⊕</span><i></i></div><small>SERIAL / UDP / OSC / HTTP</small>';
  document.querySelector('.sidebar-bottom').before(plate);
  const gauge=el('div','instrument-gauge');gauge.id='instrumentGauge';
  document.querySelector('.sensor-reading').after(gauge);
  const osc=el('section','panel osc-panel');osc.id='oscPanel';osc.hidden=true;
  osc.innerHTML=`<div class="section-heading"><div><div class="eyebrow">OSC / UDP INPUT</div><h2>OSC 주소 모니터</h2><p>수신한 주소별 값이 자동으로 나타납니다.</p></div><span id="oscCount" class="badge">0 ADDRESSES</span></div>
  <div class="osc-tools"><label class="search"><input id="oscSearch" type="search" placeholder="/sensor/distance · 주소 검색" aria-label="OSC 주소 검색"></label><button id="oscAdd" class="button">OSC 연결 추가</button></div>
  <p id="oscStatus" role="status" class="muted"></p><p id="oscError" class="notice error" hidden></p>
  <div class="osc-table-wrap"><table class="osc-table"><thead><tr><th>주소 / ADDRESS</th><th>형식</th><th>최신 값</th><th>횟수</th><th>마지막 수신</th></tr></thead><tbody id="oscAddresses"></tbody></table></div>
  <div id="oscDetail" hidden><div class="section-heading"><div><div class="eyebrow">SELECTED ADDRESS</div><h3 id="oscAddressTitle"></h3></div><label>그래프 인자 <select id="oscArgument" aria-label="OSC 그래프 인자"></select></label></div><div id="oscArguments" class="osc-arguments"></div><canvas id="oscGraph" role="img" aria-label="선택한 OSC 숫자 인자 그래프"></canvas><p id="oscGraphNote" class="muted"></p><p id="oscPeer" class="muted"></p></div>
  <p class="field-help">최대 128개 주소 · 주소별 최근 120개 샘플 · 수신 시점 기준 표시. Bundle의 시간 태그는 기록만 하며 예약 실행하지 않습니다.</p>`;
  $('paneSensors').prepend(osc);
  $('oscSearch').oninput=e=>{oscFilter=e.target.value;oscRowsSignature='';renderOSC();};
  $('oscArgument').onchange=e=>{oscArgument=Number(e.target.value);oscPlotKey='';oscPlotPoints=[];renderOSC();};
  $('oscAdd').onclick=()=>{openEditor('target');if(!$('editDialog').open)return;$('targetType').value='udp';renderTransportFields();$('itemName').value='OSC Input';};
  const recent=el('section','panel recent-panel');recent.innerHTML='<div class="section-heading"><h2>최근 기록</h2><button id="allRecords" class="button quiet">전체 보기 ↗</button></div><div id="recentRecords"></div>';
  $('connectionDiagnostics').before(recent);$('allRecords').onclick=()=>showTab('logs');
  const foot=el('footer','workbench-footer');foot.innerHTML='<span id="sessionDevices">00 DEVICES</span><span>LOCAL SENSOR WORKBENCH</span><span id="sessionStatus">수신 대기</span>';
  document.querySelector('.app').append(foot);
  new ResizeObserver(()=>{drawOSCGraph();renderGauge();}).observe($('paneSensors'));
  setupJSONFields();
  workbenchUpdate();
}
function workbenchUpdate(){
  if(!$('oscPanel')||!workspace)return;
  $('localStatus').textContent=engineOffline?'LOCAL · OFFLINE':'LOCAL · CONNECTED';
  $('localStatus').classList.toggle('offline',engineOffline);
  $('channelPlate').textContent=active()?`${kind(active()).toUpperCase()} / ${active().name}`:'NO DEVICE';
  $('sessionDevices').textContent=String(workspace.targets.length).padStart(2,'0')+' DEVICES';
  $('sessionStatus').textContent=engineOffline?'엔진 연결 끊김':sensorRuntime.armed?'자동 규칙 실행 중':'자동 규칙 정지';
  $('logTabCount').textContent=events.length;
  const recent=$('recentRecords');recent.replaceChildren();
  for(const event of events.filter(e=>!active()||e.target?.id===active().id).slice(0,4)){
    const row=button('recent-row','',()=>showEvent(event));
    const message=event.packet?.osc;
    row.append(el('time','',stamp(event.time)),el('b','',event.direction||'TX'),el('code','',message?(message.error||message.messages.map(m=>m.address+' '+m.arguments.map(a=>oscValue(a.value)).join(' ')).join(' · ')):event.key||event.packet?.text||event.label),el('span','',event.label));recent.append(row);
  }
  if(!recent.children.length)recent.append(el('p','muted','아직 수신·전송 기록이 없습니다. 장치를 연결하면 여기에 표시됩니다.'));
  renderJSONFields();renderSensors();
  $('allSensors').hidden=true;
  const own=(workspace.sensors||[]).filter(m=>m.sourceId===active()?.id);
  if(workbenchTarget!==active()?.id){
    workbenchTarget=active()?.id;oscSelected='';oscPlotKey='';oscPlotPoints=[];
  }
  document.querySelector('.sensor-panel').hidden=!jsonFieldGraphAvailable();
  $('connectionDiagnostics').hidden=!active()||kind(active())==='http';
  renderGauge();renderRulesWorkbench();renderOSC();
}
function renderGauge(){
  const host=$('instrumentGauge');if(!host)return;
  const config=selectedMonitor(),state=sensorPaused?frozenSensor:sensorState(),value=state?.value;
  const values=(state?.points||[]).map(p=>p[1]).concat(config?.rules.map(r=>r.threshold)||[]).filter(Number.isFinite);
  let min=Math.min(0,...values),max=Math.max(1,...values);if(min===max)max=min+1;
  const finite=Number.isFinite(value),angle=-135+270*(finite?Math.max(0,Math.min(1,(value-min)/(max-min))):0);
  const endpoint=finite?`<line x1="100" y1="100" x2="${100+66*Math.sin(angle*Math.PI/180)}" y2="${100-66*Math.cos(angle*Math.PI/180)}" stroke="#218b4e" stroke-width="3"/>`:'';
  // Only numeric coordinates are interpolated. Device names are textContent elsewhere.
  host.innerHTML=`<span class="eyebrow">LIVE INPUT ///</span><svg viewBox="0 0 200 200" role="img" aria-label="센서 값 게이지"><g fill="none" stroke="currentColor"><circle cx="100" cy="100" r="76"/><circle cx="100" cy="100" r="69"/><circle cx="100" cy="100" r="63"/><path d="M100 14v22M100 164v22M14 100h22M164 100h22"/></g>${endpoint}<circle cx="100" cy="100" r="6" fill="${finite?'#218b4e':'#80867d'}"/><text x="100" y="132" text-anchor="middle" fill="currentColor" font-family="Consolas,monospace" font-size="20" font-weight="700">${finite?Number(value.toPrecision(4)):'—'}</text></svg>`;
  host.append(el('small','',values.length?`${Number(min.toPrecision(4))} — ${Number(max.toPrecision(4))} ${config?.unit||''} · 자동 눈금`:'수신 후 자동 눈금'));
}
function renderRulesWorkbench(){
  const arm=$('rulesArm');arm.textContent=$('sensorArm').textContent;arm.disabled=$('sensorArm').disabled;arm.classList.toggle('stop',sensorRuntime.armed);
  const signature=JSON.stringify([active()?.id,workspace.sensors,workspace.signals,workspace.targets,sensorRuntime.monitors.map(m=>[m.id,m.rules])]);
  if(signature===rulesSignature)return;rulesSignature=signature;
  const host=$('ruleWorkbench');host.replaceChildren();
  for(const monitor of sourceMonitors()){
    const card=el('section','rule-workbench-card'),head=el('div','section-heading');
    head.append(el('h3','',monitor.name),button('button','규칙 편집 ↗',()=>{selectSensorMonitor(monitor.id);openJSONFieldSettings();}));card.append(head);
    card.append(el('p','muted',`${workspace.targets.find(t=>t.id===monitor.sourceId)?.name||'삭제된 연결'} / ${monitor.parser==='json'?monitor.field:'NUMBER'} / ${monitor.unit}`));
    for(const rule of monitor.rules){
      const row=el('div','rule-flow'),status=sensorRuntime.monitors.find(m=>m.id===monitor.id)?.rules.find(r=>r.id===rule.id);
      const key=workspace.signals.find(s=>s.id===rule.signalId)?.key||'삭제된 신호';
      row.append(el('b','stage-label','IF'),el('strong','',`${rule.op==='lt'?'<':'>'} ${rule.threshold} ${monitor.unit}`),el('span','',`유지 ${rule.hold}s · 여유 ${rule.hysteresis}`),el('b','stage-label','THEN'),el('code','',key),el('span','',workspace.targets.find(t=>t.id===rule.targetId)?.name||'삭제된 출력'),el('span','badge',rule.enabled?(status?.status||'대기'):'비활성'));
      card.append(row);
    }
    if(!monitor.rules.length)card.append(el('p','muted','조건이 없습니다. 규칙 편집에서 조건과 출력 신호를 추가하세요.'));
    host.append(card);
  }
  if(!host.children.length)host.append(el('div','empty','이 센서에 저장된 규칙이 없습니다. 모니터에서 수신 필드를 선택한 뒤 단위 · 규칙 설정을 누르세요.'));
}
function renderOSC(){
  const target=active(),panel=$('oscPanel');panel.hidden=kind(target)!=='udp'||((!!workspace?.sensors?.some(m=>m.sourceId===target?.id)||!!connectionStates[target?.id]?.fields?.messages)&&!oscRows().length);if(panel.hidden)return;
  const state=connectionStates[target.id]||{},osc=state.osc,rows=oscRows();
  $('oscCount').textContent=rows.length+' ADDRESSES';
  $('oscStatus').textContent=engineOffline?'엔진 연결 끊김 · 아래 값은 마지막 수신값입니다.':state.status==='open'?`수신 중 · ${state.local} · 마지막 값은 주소별 수신 시각을 확인하세요.`:'연결이 닫혀 있습니다. 연결 열기를 누르고 송신 장치의 목적지 IP·포트를 이 PC에 맞추세요.';
  $('oscError').hidden=!osc?.lastError;
  $('oscError').textContent=osc?.lastError?`OSC 해석 오류 ${osc.errors}건 · ${stamp(osc.lastError.time)} · ${osc.lastError.message} · 수신은 계속됩니다.`:'';
  const selected=rows.find(row=>row.address===oscSelected);
  if(!selected){oscSelected=rows[0]?.address||'';oscArgument=0;}
  const shown=rows.filter(row=>row.address.toLowerCase().includes(oscFilter.toLowerCase())).sort((a,b)=>a.address.localeCompare(b.address));
  const sig=JSON.stringify([target.id,shown,oscSelected]);
  if(sig!==oscRowsSignature){
    oscRowsSignature=sig;const body=$('oscAddresses');body.replaceChildren();
    for(const row of shown){
      const tr=el('tr',row.address===oscSelected?'selected':'');const addr=el('td');
      addr.append(button('osc-address',row.address,()=>{oscSelected=row.address;oscArgument=0;oscPlotKey='';oscPlotPoints=[];renderOSC();}));tr.append(addr);
      for(const value of [row.types,row.arguments.map(a=>oscValue(a.value)).join(' / ')||'인자 없음',row.count,stamp(row.time)])tr.append(el('td','',String(value)));
      body.append(tr);
    }
    if(!shown.length){const tr=el('tr'),td=el('td','osc-empty',rows.length?'일치하는 주소가 없습니다.':'OSC 패킷을 기다리고 있습니다. 예: /sensor/distance 1.84');td.colSpan=5;tr.append(td);body.append(tr);}
  }
  const row=rows.find(row=>row.address===oscSelected);$('oscDetail').hidden=!row;if(!row)return;
  $('oscAddressTitle').textContent=row.address;
  const picker=$('oscArgument'),argumentsKey=JSON.stringify([row.address,row.types]);
  if(picker.dataset.signature!==argumentsKey){
    picker.dataset.signature=argumentsKey;picker.replaceChildren();
    row.arguments.forEach((a,i)=>{const opt=el('option','',`ARG ${i} / ${a.type}`);opt.value=i;picker.append(opt);});
    if(oscArgument>=row.arguments.length)oscArgument=0;
  }
  picker.value=oscArgument;picker.disabled=!row.arguments.length;
  const args=$('oscArguments');args.replaceChildren();
  row.arguments.forEach((arg,index)=>{const item=el('div','osc-argument');item.append(el('small','',`ARG ${index} / ${arg.type}`),el('code','',oscValue(arg.value)));args.append(item);});
  $('oscPeer').textContent=`FROM ${row.peer} · ${row.count} messages · ${stamp(row.time)}${row.timetag?' · Bundle timetag 0x'+row.timetag:''}`;
  const numeric=['i','f','d'].includes(row.arguments[oscArgument]?.type)&&typeof row.arguments[oscArgument]?.value==='number';
  $('oscGraph').hidden=!numeric;$('oscGraphNote').textContent=numeric?'최근 120개 수신 샘플 · 값과 시간 자동 눈금 · 단위 변환 없음':'이 인자는 숫자 그래프를 지원하지 않습니다. 원래 형식과 값은 위에 표시됩니다.';
  if(!numeric)return;
  const key=JSON.stringify([target.id,row.address,oscArgument]);
  if(key!==oscPlotKey){oscPlotKey=key;oscPlotPoints=[];drawOSCGraph();}
  if(!oscRequestBusy&&!engineOffline&&!$('paneSensors').hidden){
    oscRequestBusy=true;
    api(`osc?target=${encodeURIComponent(target.id)}&address=${encodeURIComponent(row.address)}&argument=${oscArgument}`)
      .then(data=>{if(oscPlotKey===key){oscPlotPoints=data.points;drawOSCGraph();}})
      .catch(error=>{if(oscPlotKey===key)$('oscGraphNote').textContent='그래프를 읽지 못했습니다: '+error.message;})
      .finally(()=>{oscRequestBusy=false;});
  }
}
function drawOSCGraph(){
  const canvas=$('oscGraph');if(!canvas||canvas.hidden)return;const w=canvas.clientWidth;if(w<100)return;
  const h=210,ratio=devicePixelRatio||1;canvas.width=w*ratio;canvas.height=h*ratio;
  const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.clearRect(0,0,w,h);
  const points=oscPlotPoints,values=points.map(p=>p[1]).filter(v=>typeof v==='number'&&Number.isFinite(v));
  if(!values.length){ctx.fillStyle='#50574e';ctx.fillText('숫자 샘플 대기 중',28,45);return;}
  let min=Math.min(...values),max=Math.max(...values);const pad=Math.max((max-min)*.1,Math.abs(max)*.01,.01);min-=pad;max+=pad;
  const first=points[0][0],last=Math.max(first+1,points.at(-1)[0]);
  const x=t=>70+(t-first)/(last-first)*(w-90),y=v=>175-(v-min)/(max-min)*155;
  ctx.font='12px Consolas, monospace';
  for(let i=0;i<4;i++){const v=min+(max-min)*i/3;ctx.strokeStyle='#bdc4b9';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(70,y(v));ctx.lineTo(w-20,y(v));ctx.stroke();ctx.fillStyle='#50574e';ctx.fillText(Number(v.toPrecision(4)),4,y(v)+4);}
  ctx.strokeStyle='#080a08';ctx.lineWidth=2;ctx.beginPath();let connected=false;
  for(const [t,v] of points){if(typeof v!=='number'){connected=false;continue;}if(!connected)ctx.moveTo(x(t),y(v));else ctx.lineTo(x(t),y(v));connected=true;}ctx.stroke();
  const final=points.at(-1);if(typeof final[1]==='number'){ctx.beginPath();ctx.arc(x(final[0]),y(final[1]),4,0,Math.PI*2);ctx.fillStyle='#218b4e';ctx.fill();}
  ctx.fillStyle='#50574e';ctx.fillText(stamp(first),70,200);ctx.textAlign='right';ctx.fillText(stamp(last),w-20,200);
}
workbenchSetup();
