'use strict';
// Auto-discovered values belong to one connection. Selecting a value never saves settings.
let autoSensor=null, autoSensorState=null, fieldSelection=null, fieldRows=[], fieldSource=null;
let fieldCardsSignature='', fieldEpoch=0, fieldPending=null, fieldHistory=[], fieldHistoryKey='';
const fieldChoices=new Map();
function sourceMonitors(){return (workspace?.sensors||[]).filter(m=>m.sourceId===active()?.id);}
function fieldKey(path){return JSON.stringify(path);}
function monitorFieldKey(m){return m.parser==='json'?fieldKey(m.field.split('.')):null;}
function fieldLabel(path){return path.map(p=>/^[A-Za-z0-9_-]+$/.test(p)?p:JSON.stringify(p)).join('.');}
function fieldCanConfigure(row){return row.path.every(p=>/^[A-Za-z0-9_-]+$/.test(p))&&row.path.join('.').length<=120;}
function selectedJSONField(){return fieldRows.find(row=>row.key===fieldSelection?.key);}
function jsonFieldHasSelection(){return fieldSelection?.source===active()?.id&&!!selectedJSONField();}
function jsonFieldGraphAvailable(){const row=selectedJSONField();return !!(selectedMonitor()&&(!row||row.numeric||row.savedOnly));}
function fieldDisplay(value){return value===undefined?'—':typeof value==='number'?String(Number(value.toPrecision(7))):typeof value==='string'?value:JSON.stringify(value);}
function resetFieldHistory(){fieldEpoch++;fieldHistory=[];fieldHistoryKey='';autoSensor=null;autoSensorState=null;sensorPaused=false;frozenSensor=null;}
function selectJSONField(key,monitorId=null){
  if(lockWorkspace())return;
  fieldSelection={source:active()?.id,key,monitorId};fieldChoices.set(fieldSelection.source,{...fieldSelection});
  resetFieldHistory();renderJSONFields();renderSensors();renderGauge();
}
function selectJSONMonitor(id){
  const m=sourceMonitors().find(m=>m.id===id);
  if(!m||m.parser!=='json'){
    fieldSelection=m?{source:m.sourceId,key:null,monitorId:m.id}:null;fieldChoices.set(active()?.id,fieldSelection);resetFieldHistory();return;
  }
  fieldSelection={source:m.sourceId,key:monitorFieldKey(m),monitorId:m.id};fieldChoices.set(m.sourceId,{...fieldSelection});
  resetFieldHistory();renderJSONFields();
}
function setupJSONFields(){
  const host=el('section','json-fields');host.id='jsonFields';
  host.innerHTML=`<div class="section-heading"><div><div class="eyebrow">RECEIVED JSON / THIS DEVICE</div><h2 id="jsonFieldsTitle">수신 필드</h2><p>값을 누르면 그래프와 단위·규칙 설정이 열립니다.</p></div><span id="jsonFieldCount" class="badge">0 FIELDS</span></div><p id="jsonFieldStatus" class="field-help" role="status"></p><p id="jsonFieldError" class="notice error" hidden></p><div id="jsonFieldCards" class="json-field-cards"></div><p id="jsonFieldEmpty" class="empty"></p><section id="jsonTextDetail" class="json-text-detail" hidden><h3 id="jsonTextTitle"></h3><pre id="jsonTextValue"></pre><p id="jsonTextNote" class="field-help"></p></section>`;
  document.querySelector('.sensor-panel').before(host);
  // Advanced manual number/JSON configuration remains available, out of the primary flow.
  const advanced=el('div','manual-field-tools'),manualButton=$('addSensor');manualButton.textContent='수동 필드 설정';advanced.append(manualButton);
  $('connectionDiagnostics').append(advanced);
  $('configureSensor').textContent='단위 · 규칙 설정';$('configureSensor').onclick=openJSONFieldSettings;
  $('goRules').onclick=openJSONFieldSettings;
  $('rulesAddSensor').textContent='선택 필드 규칙 설정';$('rulesAddSensor').onclick=openJSONFieldSettings;
  $('sensorEmpty').hidden=true;
}
function openJSONFieldSettings(){
  const row=selectedJSONField(),config=selectedMonitor();
  if(!config){toast('먼저 이 연결의 숫자 필드를 선택하세요.');showTab('sensors');return;}
  if(row&&!fieldCanConfigure(row)){toast('이 필드명은 규칙 경로로 사용할 수 없습니다. 영문·숫자·밑줄·하이픈으로 된 JSON 키를 사용하세요.',true);return;}
  openSensorEditor();
  if(!$('sensorDialog').open)return;
  if(config.parser==='json'){
    for(const id of ['sensorInput','sensorParser','sensorJsonField'])$(id).disabled=true;
    $('sensorEditTitle').textContent=`${active()?.name} / ${config.field}`;
  }
}
function renderJSONFields(){
  if(!$('jsonFields')||!workspace)return;
  const target=active(),source=target?.id,raw=!!target&&kind(target)!=='http';
  $('jsonFields').hidden=!raw;
  if(fieldSource!==source){
    fieldSource=source;fieldSelection=fieldChoices.get(source)||null;sensorSelected=null;resetFieldHistory();
  }
  const runtime=connectionStates[source]?.fields,own=sourceMonitors();
  fieldRows=(runtime?.items||[]).map(row=>({...row}));
  // Saved rules and units remain accessible even before the first message after restart.
  for(const monitor of own.filter(m=>m.parser==='json')){
    const key=monitorFieldKey(monitor);
    if(!fieldRows.some(r=>r.key===key))fieldRows.push({key,path:monitor.field.split('.'),type:'number',numeric:true,present:false,savedOnly:true});
  }
  if(!raw){fieldRows=[];fieldSelection=null;autoSensor=null;autoSensorState=null;return;}
  const manual=own.find(m=>m.id===fieldSelection?.monitorId&&m.parser==='number');
  if(!manual&&!fieldRows.some(r=>r.key===fieldSelection?.key)){
    const remembered=own.find(m=>m.id===sensorSelected&&m.parser==='json');
    const row=fieldRows.find(r=>r.key===monitorFieldKey(remembered||{}))||fieldRows[0];
    fieldSelection=row?{source,key:row.key,monitorId:null}:null;resetFieldHistory();
  }
  const row=selectedJSONField();
  if(fieldSelection)fieldChoices.set(source,{...fieldSelection});
  const matching=row?own.filter(m=>monitorFieldKey(m)===row.key):[];
  const saved=matching.find(m=>m.id===fieldSelection?.monitorId)||matching[0];
  const numeric=!!row&&(row.numeric||row.savedOnly);
  autoSensor=null;autoSensorState=null;
  if(row&&numeric){
    if(saved){sensorSelected=saved.id;fieldSelection.monitorId=saved.id;}
    else{
      autoSensor={id:'auto:'+source+':'+row.key,sourceId:source,name:fieldLabel(row.path).slice(0,80),parser:'json',field:row.path.join('.'),unit:'',staleSeconds:2,rules:[]};
      sensorSelected=autoSensor.id;
      autoSensorState={id:autoSensor.id,value:row.value,time:row.time,samples:row.count||0,errors:runtime?.errors||0,error:'',rules:[],points:fieldHistory,
        live:!engineOffline&&connectionStates[source]?.status==='open'&&row.live,status:fieldStatus(row,saved)};
    }
  }else if(row){sensorSelected=saved?.id||null;}
  else if(manual){sensorSelected=manual.id;}
  else if(!own.some(m=>m.id===sensorSelected)){sensorSelected=own.find(m=>m.parser==='number')?.id||null;}
  $('jsonFieldsTitle').textContent=target.name+' · 수신 필드';$('jsonFieldCount').textContent=fieldRows.length+' FIELDS';
  const state=connectionStates[source];
  $('jsonFieldStatus').textContent=engineOffline?'엔진 연결이 끊겼습니다. 표시값은 마지막 수신값입니다.':state?.status!=='open'?'연결을 열면 이 센서가 보내는 JSON 필드가 자동으로 표시됩니다. 저장된 단위와 규칙은 유지됩니다.':runtime?.partial?'JSON 한 줄을 받는 중입니다. 줄바꿈(LF)을 기다립니다.':`${runtime?.messages||0} JSON 수신 · 이 연결의 필드만 표시${runtime?.limited?' · 최근 128개 필드로 제한':''}`;
  $('jsonFieldError').hidden=!runtime?.error;$('jsonFieldError').textContent=runtime?.error?'JSON 해석 오류 · '+runtime.error:'';
  $('jsonFieldEmpty').hidden=!!fieldRows.length;$('jsonFieldEmpty').textContent='JSON 수신 대기 · 예: {"distance":184,"detected":true}';
  const signature=JSON.stringify([source,fieldRows.map(r=>r.key)]);
  if(signature!==fieldCardsSignature){
    fieldCardsSignature=signature;const cards=$('jsonFieldCards');cards.replaceChildren();
    for(const item of fieldRows){
      const card=button('json-field-card','',()=>selectJSONField(item.key));card.dataset.fieldKey=item.key;
      card.append(el('strong','field-name',fieldLabel(item.path)),el('span','field-value','—'),el('small','field-kind',''),el('small','field-state',''));
      cards.append(card);
    }
  }
  for(const card of $('jsonFieldCards').children){
    const item=fieldRows.find(r=>r.key===card.dataset.fieldKey),configured=own.find(m=>monitorFieldKey(m)===item.key);
    card.querySelector('.field-value').textContent=fieldDisplay(item.value);
    card.querySelector('.field-kind').textContent=`${item.type}${configured?.unit?' / '+configured.unit:''}${configured?' · 설정 저장됨':''}`;
    card.querySelector('.field-state').textContent=fieldStatus(item,configured);
    card.classList.toggle('selected',item.key===row?.key);card.classList.toggle('stale',!item.live||engineOffline||state?.status!=='open');
    card.setAttribute('aria-pressed',String(item.key===row?.key));
  }
  $('jsonTextDetail').hidden=!row||numeric;
  if(row&&!numeric){
    $('jsonTextTitle').textContent=fieldLabel(row.path);$('jsonTextValue').textContent=fieldDisplay(row.value);
    $('jsonTextNote').textContent=`${fieldStatus(row,saved)} · ${row.type} · 숫자 필드는 그래프와 임계값 규칙을 사용할 수 있습니다.`;
  }
  document.querySelector('.sensor-panel').hidden=!jsonFieldGraphAvailable();
  $('configureSensor').disabled=!!row&&!fieldCanConfigure(row);
  $('rulesAddSensor').disabled=!selectedMonitor()||!!row&&!fieldCanConfigure(row);
  // New fields have a session graph immediately, without saving a monitor or pausing rules.
  if(autoSensor&&!$('paneSensors').hidden&&!engineOffline){
    const key=source+'\n'+row.key;
    if(fieldHistoryKey!==key){fieldHistoryKey=key;fieldHistory=[];autoSensorState.points=[];}
    const epoch=fieldEpoch;
    if(fieldPending!==epoch){
      fieldPending=epoch;
      api(`fields?target=${encodeURIComponent(source)}&field=${encodeURIComponent(row.key)}`)
        .then(result=>{if(epoch!==fieldEpoch||active()?.id!==source||fieldSelection?.key!==row.key)return;fieldHistory=result.points;if(autoSensorState){autoSensorState.points=fieldHistory;drawSensorGraph();renderGauge();}})
        .catch(error=>{if(epoch===fieldEpoch)$('jsonFieldError').hidden=false;if(epoch===fieldEpoch)$('jsonFieldError').textContent='그래프 수신 실패 · '+error.message;})
        .finally(()=>{if(fieldPending===epoch)fieldPending=null;});
    }
  }
}
function fieldStatus(row,config){
  if(engineOffline)return '엔진 연결 끊김';
  if(connectionStates[active()?.id]?.status!=='open')return '연결 닫힘 · 마지막 값';
  if(row.savedOnly)return '저장된 필드 · 수신 대기';
  if(!row.present)return '이번 JSON에 없음 · '+stamp(row.time);
  if(row.ageSeconds>(config?.staleSeconds??2))return '수신 끊김 · '+stamp(row.time);
  return '수신 중 · '+stamp(row.time);
}
