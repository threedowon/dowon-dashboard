'use strict';
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="tester-token"]').content;
if(token==='__TESTER_TOKEN__'){
  const home=document.querySelector('.brand');
  home.href='../../#signaltester';home.target='_top';
}
const icons = {
  monitor:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  edit:'<path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  send:'<path d="m5 19 14-14M5 5h14v14"/>',
  search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  import:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  plug:'<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0ZM12 17v4"/>',
  refresh:'<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  wave:'<path d="M3 12h3l3-7 4 14 3-7h5"/>',
  pause:'<path d="M9 5v14M15 5v14"/>',
  play:'<path d="m7 4 13 8-13 8Z"/>',
};
function icon(name) { const span=document.createElement('span'); span.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ''}</svg>`; return span; }
document.querySelectorAll('[data-icon]').forEach(el=>el.replaceChildren(...icon(el.dataset.icon).childNodes));
function el(tag, cls, text) { const node=document.createElement(tag); if(cls)node.className=cls; if(text!==undefined)node.textContent=text; return node; }
function button(cls, text, handler) { const b=el('button',cls,text); b.type='button'; b.addEventListener('click',handler); return b; }
function iconButton(name, label, handler) { const b=button('icon-button','',handler); b.append(icon(name)); b.title=label; b.setAttribute('aria-label',label); return b; }
let workspace=null, events=[], selectedId=null, draft=null, saving=false, sending=false, repeating=null, editing=null, detailEvent=null;
let workspaceRevision=null;
let toastTimer, healthChecks=new Map(), healthBusy=new Set();
let workspaceLoading=false, workspaceSetup=false, startupControls=null;
let workspaceError='Workspace is still loading. Wait for the saved connections to appear.';
const restartHelp='Run SignalTester.exe again (or Start-Signal-Tester.cmd for source installations), then use the newly opened page. Saved targets and Signals are kept.';
const selected=()=>workspace?.signals.find(s=>s.id===selectedId);
const active=()=>workspace?.targets.find(t=>t.id===workspace.activeTarget);
const address=t=>kind(t)==='serial'?`${t.device} · ${t.baudrate} baud`:kind(t)==='udp'?`${t.bindHost}:${t.bindPort} → ${t.remoteHost}:${t.remotePort}`:`${t.host.includes(':')?'['+t.host+']':t.host}:${t.port}`;
const liveAddress=t=>kind(t)==='udp'?`${connectionStates[t.id]?.status==='open'?connectionStates[t.id].local:t.bindHost+':'+(t.bindPort||'auto')} → ${t.remoteHost}:${t.remotePort}`:address(t);
const clone=value=>structuredClone(value);
const valueType=value=>value===null?'null':typeof value;
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').className='toast'+(error?' error':'');$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?7000:3500);}
async function api(path,body){
  let base='', auth=token;
  if(token==='__TESTER_TOKEN__'){
    const pairing=JSON.parse(sessionStorage.getItem('dowon-signal-pairing') || 'null');
    if(!pairing || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(pairing.base) || !/^[A-Za-z0-9_-]{43}$/.test(pairing.token))throw Error('대시보드에서 PC 연결 코드를 입력하세요.');
    base=pairing.base;auth=pairing.token;
  }
  const res=await fetch(base+'/api/'+path,{method:body===undefined?'GET':'POST',headers:{'X-Tester-Token':auth,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  let data;try{data=await res.json();}catch{throw Error('Tester is not responding. Keep its launch window open and reload this page.');}
  if(!res.ok)throw Object.assign(Error(data.error || 'Request failed.'),{status:res.status});return data;
}
function safe(handler){return async (...args)=>{try{await handler(...args);}catch(e){toast(e.message,true);}};}
function lockWorkspace(){if(!workspace){toast(workspaceError,true);return true;}if(saving||sending||repeating||ioBusy){toast('Finish or stop the current test before changing the workspace.');return true;}return false;}
async function saveWorkspace(next){
  if(!workspace)throw Error(workspaceError);
  if(typeof workspaceRevision!=='string')throw Error('Update and restart the PC tester before saving. This engine does not support workspace version checks.');
  if(saving)throw Error('A save is already in progress.');
  saving=true;$('saveState').textContent='Saving…';updateControls();
  try{const result=await api('workspace',{...next,revision:workspaceRevision});workspace=result.workspace;workspaceRevision=result.revision;applyRuntime(result);$('saveState').textContent='Saved on this PC';render();}
  catch(e){
    $('saveState').textContent='Changes not saved';
    if(e.status===409){
      try{const latest=await api('state');workspace=latest.workspace;workspaceRevision=latest.revision;applyRuntime(latest);render();}
      catch{throw Error('Workspace changed in another window. Could not reload it; reload this page before editing.');}
      throw Error('Workspace changed in another window. Latest settings loaded; review them and try your change again.');
    }
    throw e;
  }
  finally{saving=false;updateControls();}
}
function render(){
  if(!workspace)return;
  if(!selected()){selectedId=workspace.signals[0]?.id || null;draft=selected()?clone(selected().value):null;}
  renderTargets();renderSignals();renderComposer();renderIO();renderEvents();renderSensors();renderKeyboard();updateControls();
}
function renderTargets(){
  $('targetCount').textContent=workspace.targets.length;
  $('targets').replaceChildren();
  for(const t of workspace.targets){
    const row=el('div','target-row'+(t.id===workspace.activeTarget?' active':''));
    const pick=button('target-select','',safe(async()=>{
      if(lockWorkspace()||t.id===workspace.activeTarget)return;
      const next=clone(workspace);next.activeTarget=t.id;await saveWorkspace(next);checkHealth();
    }));
    pick.setAttribute('aria-pressed',String(t.id===workspace.activeTarget));
    const state=connectionStates[t.id],check=kind(t)==='http'?healthChecks.get(t.id):state?{online:state.status==='open'&&!state.error}:null,dot=el('span','dot'+(check?(check.online?' online':' offline'):'')),body=el('span');
    body.append(el('strong','',t.name),el('span','protocol-tag',kind(t)==='http'?'HTTP SIGNAL':kind(t).toUpperCase()),el('small','',liveAddress(t)));pick.append(dot,body);
    row.append(pick,iconButton('edit',`Edit target ${t.name}`,()=>openEditor('target',t)));$('targets').append(row);
  }
  if(!workspace.targets.length)$('targets').append(el('p','muted','No targets yet. Add your first Player.'));
  const t=active();$('activeName').textContent=t?.name || 'No target selected';$('activeAddress').textContent=t?liveAddress(t):'Add a target to begin';
  $('remoteNotice').hidden=!t||kind(t)!=='http'||['127.0.0.1','localhost','::1'].includes(t.host);
  if(t&&kind(t)!=='http'){renderIO();return;}
  const health=t&&healthChecks.get(t.id),busy=t&&healthBusy.has(t.id);
  $('healthStatus').textContent=busy?'Checking…':health?(health.online?'Receiver ready':'Not reachable'):'Not checked';
  $('healthStatus').className='badge'+(!busy&&health?(health.online?' good':' bad'):'');
  $('healthTime').textContent=health?.online&&!busy?`${health.elapsed} ms`:'';
  $('healthDetail').textContent=busy?'Checking the receiver. No Signal is sent.':health?`${health.detail} · Checked ${new Date(health.checkedAt).toLocaleTimeString('en-GB')}`:'Checking a connection does not send a Signal.';
}
let silentHealth=false;
async function checkHealth(silent=false){
  const t=active();if(!t||healthBusy.has(t.id)||(silent&&silentHealth))return;
  if(kind(t)!=='http'){renderIO();return;}
  const endpoint=address(t);
  if(silent)silentHealth=true;else{healthBusy.add(t.id);renderTargets();updateControls();}
  try{const result=await api('health',{targetId:t.id});if(workspace.targets.some(item=>item.id===t.id&&address(item)===endpoint))healthChecks.set(t.id,{...result,checkedAt:Date.now()});}
  catch(e){if(!silent)toast(e.message,true);}finally{if(silent)silentHealth=false;else healthBusy.delete(t.id);renderTargets();updateControls();}
}
// Re-check the selected HTTP receiver in the background (GET /health only; never sends a Signal).
setInterval(()=>{if(document.visibilityState==='visible'&&workspace&&!engineOffline&&!saving&&!document.querySelector('dialog[open]')&&active()&&kind(active())==='http')checkHealth(true);},5000);
function renderSignals(){
  $('signalCount').textContent=workspace.signals.length;$('signals').replaceChildren();
  const query=$('search').value.trim().toLowerCase();
  const filtered=workspace.signals.filter(s=>(s.name+' '+s.key).toLowerCase().includes(query));
  for(const s of filtered){
    const card=el('article','signal-card'+(s.id===selectedId?' selected':''));card.dataset.signalId=s.id;card.dataset.key=s.key;
    card.addEventListener('click',e=>{if(!e.target.closest('button'))choose(s);});
    const top=el('div','signal-card-top');
    const pick=button('signal-picker','',()=>choose(s));pick.setAttribute('aria-pressed',String(s.id===selectedId));pick.append(el('strong','',s.name),el('code','',s.key));
    top.append(pick,iconButton('edit',`Edit Signal ${s.name}`,()=>openEditor('signal',s)));
    const meta=el('span','card-meta'),summary=(s.value===null?'No value':JSON.stringify(s.value))+` · ${s.cooldown??3}s cooldown`;
    if(s.shortcut){const k=el('kbd','signal-shortcut',keyLabel(s.shortcut));k.title='Keyboard test key';meta.append(k);}
    const caption=el('span','',summary);caption.title=summary;meta.append(caption);
    const result=el('div','card-result');result.append(el('span','','Not sent yet'));
    const bottom=el('div','signal-card-bottom');
    const send=button('quick-send','',safe(()=>sendOnce({targetId:active()?.id,key:s.key,value:clone(s.value)})));send.title=`Send ${s.key} with its saved value`;send.setAttribute('aria-label',`Send ${s.key}`);send.append(icon('send'),document.createTextNode('Send'));send.dataset.send='';
    bottom.append(meta,send);card.append(top,result,bottom);$('signals').append(card);
  }
  if(!filtered.length){const empty=el('div','empty');empty.append(el('strong','',query?'No matching signals':'Build your signal library'),el('span','',query?'Try another name or key.':'Add a key or import the Signals from your .scene file.'));$('signals').append(empty);}
  updateCardResults(false);updateControls();
}
function choose(s){if(repeating){toast('Stop repeat before choosing another Signal.');return;}selectedId=s.id;draft=clone(s.value);renderSignals();renderComposer();updateControls();}
function readValue(){
  const type=$('valueType').value;
  if(type==='null')return null;
  if(type==='boolean')return $('booleanValue').value==='true';
  if(type==='number'){const raw=$('valueInput').value.trim();if(!raw||!Number.isFinite(Number(raw)))throw Error('Enter a finite number.');return Number(raw);}
  return $('valueInput').value;
}
function currentPayload(){if(isRaw())return rawPayload();if(!selected())throw Error('Add or select a Signal first.');if(!active())throw Error('Add a target first.');return {targetId:active().id,key:selected().key,value:readValue()};}
function renderComposer(){
  const s=selected();$('composeTitle').textContent=s?.name||'Choose a signal';$('selectedKey').textContent=s?.key||'—';
  $('valueType').value=valueType(draft);$('valueInput').value=draft===null?'':String(draft);$('booleanValue').value=String(draft===true);
  updateValue();
}
function updateValue(){
  const type=$('valueType').value;$('valueField').hidden=!['string','number'].includes(type);$('booleanField').hidden=type!=='boolean';
  $('valueInput').type=type==='number'?'number':'text';$('valueInput').step='any';$('valueInput').placeholder=type==='number'?'e.g. 120':'e.g. detected';
  try{draft=readValue();$('payloadPreview').textContent=selected()?JSON.stringify({key:selected().key,value:draft},null,2):'Select a Signal to begin.';}
  catch(e){$('payloadPreview').textContent=e.message;}
  updateControls();
}
function updateControls(){
  const locked=saving||sending||!!repeating||ioBusy||!workspace,hasSignal=!!selected(),hasTarget=!!active();
  for(const id of ['addTarget','addSignal','importScene','importWorkspace','exportWorkspace','addSensor','scanPorts','editSignal','sensorHub'])$(id).disabled=locked||(id==='editSignal'&&!hasSignal);
  document.querySelectorAll('.target-select,.target-row .icon-button,.signal-card .icon-button').forEach(b=>b.disabled=locked);
  document.querySelectorAll('[data-send]').forEach(b=>b.disabled=locked||!hasTarget||isRaw()||engineOffline);
  $('sendSignal').disabled=locked||!hasSignal||!hasTarget||isRaw()||engineOffline;
  $('startRepeat').disabled=locked||!hasSignal||!hasTarget;$('stopRepeat').disabled=!repeating;
  for(const id of ['valueType','valueInput','booleanValue'])$(id).disabled=locked||!hasSignal;
  for(const id of ['repeatCount','repeatInterval'])$(id).disabled=locked||(!isRaw()&&!hasSignal);
  $('checkTarget').disabled=!hasTarget||healthBusy.has(active()?.id);
  let dirty=false;try{dirty=hasSignal&&JSON.stringify(readValue())!==JSON.stringify(selected().value);}catch{}
  $('saveValue').disabled=locked||!dirty;$('copyPayload').disabled=!hasSignal;
  $('clearLog').disabled=locked||!events.length;$('exportLog').disabled=!events.length;
  $('retryEvent').disabled=locked||!workspace?.targets.some(t=>t.id===detailEvent?.target.id);
  updateIOControls(locked);
}
function resultClass(event){return event.severity==='error'||event.ok===false?'bad':event.severity==='warning'?'warning':'good';}
async function sendOnce(payload,repeatOwner=null){
  if(sending||saving||ioBusy||(repeating&&repeating!==repeatOwner)){toast('A test is already running.');return null;}
  if(!payload.targetId)throw Error('Add a target first.');sending=true;updateControls();
  try{
    const event=await api(payload.io?'io/send':'send',payload.io?payload:{...payload,origin:payload.origin||(repeatOwner?'Repeat test':'Manual')});mergeEvents([event]);renderEvents();
    if(!repeatOwner)toast(`${event.key||event.target.name} · ${event.label}`,!sentOK(event));
    return event;
  }finally{sending=false;updateControls();}
}
function stopRepeat(message='Repeat stopped. A request already sent may still finish.'){
  if(!repeating)return;const run=repeating;repeating=null;clearTimeout(run.timer);run.wake?.();$('repeatStatus').textContent=message;updateControls();
}
async function startRepeat(){
  const count=Number($('repeatCount').value),interval=Number($('repeatInterval').value);
  if(!Number.isInteger(count)||count<2||count>1000)throw Error('Repeat sends must be a whole number from 2 to 1000.');
  if(!Number.isFinite(interval)||interval<.2||interval>3600)throw Error('Interval must be between 0.2 and 3600 seconds.');
  const payload=currentPayload(),run={payload,count,interval};repeating=run;$('repeatProgress').hidden=false;$('repeatProgress').max=count;$('repeatProgress').value=0;updateControls();
  try{
    for(let i=0;i<count&&repeating===run;i++){
      $('repeatStatus').textContent=`Sending ${i+1} of ${count} · ${payload.key}`;
      const event=await sendOnce(payload,run);$('repeatProgress').value=i+1;
      if(repeating!==run)return;
      if(!sentOK(event)){stopRepeat(`Stopped after ${i+1} sends: delivery failed.`);return;}
      if(i+1<count){$('repeatStatus').textContent=`${i+1} / ${count} sent · next in ${interval}s`;await new Promise(resolve=>{run.wake=resolve;run.timer=setTimeout(resolve,interval*1000);});}
    }
    if(repeating===run){stopRepeat(`Complete · ${count} sends. Review results below.`);toast(`Repeat complete · ${count} signals sent.`);}
  }catch(e){if(repeating===run)stopRepeat('Stopped: could not read the delivery result.');throw e;}
}
const cardFlash=new Map();
function ago(time){const s=Math.max(0,Math.round((Date.now()-time)/1000));return s<5?'just now':s<60?s+'s ago':s<3600?Math.floor(s/60)+'m ago':new Date(time).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});}
function latestFor(key){const t=active();return events.find(e=>(e.protocol||'http')==='http'&&e.direction!=='RX'&&e.key===key&&(!t||e.target?.id===t.id));}
function updateCardResults(flash=true){
  if(!workspace)return;
  for(const card of document.querySelectorAll('#signals .signal-card')){
    const e=latestFor(card.dataset.key),box=card.querySelector('.card-result');if(!box)continue;
    box.className='card-result'+(e?' '+resultClass(e):'');box.replaceChildren();
    if(e){box.append(el('span','',e.label),el('time','',' · '+ago(e.time)));box.title=e.detail||e.label;}else{box.append(el('span','','Not sent yet'));box.title='';}
    const seen=cardFlash.get(card.dataset.key);
    if(e&&seen!==undefined&&seen!==e.id&&flash&&Date.now()-e.time<4000){card.classList.remove('flash-good','flash-bad');void card.offsetWidth;card.classList.add(resultClass(e)==='bad'?'flash-bad':'flash-good');}
    cardFlash.set(card.dataset.key,e?.id??null);
  }
  const s=selected(),box=$('lastResult'),e=s&&!isRaw()?latestFor(s.key):null;box.hidden=!e;
  if(e){box.className='last-result '+resultClass(e);box.replaceChildren();const head=el('div','lr-head');head.append(el('span','badge '+resultClass(e),e.label),el('time','',`${e.elapsed!=null?e.elapsed+' ms · ':''}${ago(e.time)}`));box.append(head,el('p','',e.detail||''));}
}
let renderedEvents=null;
function renderEvents(){
  const source=logPaused?frozenEvents:events;$('eventCount').textContent=source.length;
  const changed=source.filter(e=>e.status==='transitioned').length,rx=source.filter(e=>e.direction==='RX').length,errors=source.filter(e=>e.severity==='error').length;
  $('activitySummary').textContent=source.length?[`${changed} scene change${changed===1?'':'s'}`,errors?`${errors} error${errors===1?'':'s'}`:'no errors',rx?`${rx} RX`:''].filter(Boolean).join(' · '):'All connections, one timeline.';
  $('logNotice').hidden=!logPaused&&!missedEvents;$('logNotice').textContent=logPaused?'View paused. Capture continues in the Python engine.':`${missedEvents} older events skipped during high traffic or a background tab. The engine keeps the latest 500.`;
  const filter=$('logFilter').value,protocol=$('protocolFilter').value,direction=$('directionFilter').value;
  const visible=source.filter(e=>(protocol==='all'||e.protocol===protocol)&&(direction==='all'||e.direction===direction)&&(!$('currentOnly').checked||e.target.id===active()?.id)&&(filter==='all'||(filter==='changed'&&e.status==='transitioned')||(filter==='received'&&e.protocol==='http'&&e.received&&e.status!=='transitioned')||(filter==='failed'&&e.severity==='error'))).slice(0,200);
  $('events').replaceChildren();
  for(const e of visible){
    const row=button('log-row tone-'+resultClass(e)+(renderedEvents&&!renderedEvents.has(e.id)?' fresh':''),'',()=>showEvent(e)),time=el('time','',new Date(e.time).toLocaleTimeString('en-GB', {hour12:false}));time.dateTime=new Date(e.time).toISOString();
    const key=el('span'),preview=e.key||e.packet?.text?.replace(/\s+/g,' ')||e.packet?.hex||e.label;
    key.append(el('code','',preview),el('small','',`${e.target.name} · ${(e.protocol||'http').toUpperCase()} ${e.direction||'TX'}`));
    const outcome=el('span');outcome.append(el('span','badge '+resultClass(e),e.label),el('small','',`${e.origin||e.stage||'response'}${e.peer?' · '+e.peer:''}`));
    row.append(time,key,outcome,el('span','latency',e.packet?`${e.packet.bytes} B`:e.elapsed!=null?`${e.elapsed} ms`:'—'));$('events').append(row);
  }
  if(!visible.length){const empty=el('div','empty');empty.append(el('strong','',events.length?'No results in this filter':'Your next signal starts here.'),el('span','',events.length?'Choose All to see the full activity log.':'Press Send on a Signal card. Its response appears here.'));$('events').append(empty);}
  renderedEvents=new Set(source.map(e=>e.id));
  document.querySelectorAll('[data-log-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.logFilter===filter)));
  updateCardResults();updateControls();
}
function showEvent(event){
  detailEvent=event;$('detailTitle').textContent=event.label;const content=$('detailContent');content.replaceChildren();
  content.append(el('p','',event.detail),el('p','muted',`${event.target.name} · ${address(event.target)} · ${new Date(event.time).toLocaleString('en-GB')} · ${event.protocol.toUpperCase()} / ${event.direction} / ${event.stage}`));
  $('retryEvent').hidden=event.protocol!=='http';
  if(event.protocol!=='http'){
    if(event.packet){content.append(el('h3','',`${event.packet.bytes} BYTES${event.packet.truncated?' · PREVIEW LIMITED TO 2 KB':''}`),el('pre','',event.packet.text||'(empty)'),el('h3','','HEX'),el('pre','',event.packet.hex||'(empty)'));}
    if(event.peer)content.append(el('h3','','PEER'),el('pre','',event.peer));
    if(event.error)content.append(el('h3','','SYSTEM ERROR'),el('pre','',event.error));
    $('detailDialog').showModal();updateControls();return;
  }
  if(event.origin)content.append(el('p','field-help','Source: '+event.origin));
  content.append(el('h3','',`REQUEST · POST /signal`),el('pre','',JSON.stringify({key:event.key,value:event.value},null,2)),el('h3','','RESPONSE'),el('pre','',event.response?JSON.stringify(event.response,null,2):'No acknowledged Signal response. Check the receiver address and port.'));
  $('detailDialog').showModal();updateControls();
}
function field(id,text,value,opts={}){
  const wrap=el('div','field'),label=el('label','',text),input=el('input');label.htmlFor=id;input.id=id;input.name=id;input.value=value??'';input.required=opts.required??true;input.type=opts.type||'text';
  if(opts.step!==undefined)input.step=opts.step;if(opts.maxLength)input.maxLength=opts.maxLength;if(opts.min!==undefined)input.min=opts.min;if(opts.max!==undefined)input.max=opts.max;
  wrap.append(label,input);return wrap;
}
function openEditor(kind,item=null){
  if(lockWorkspace())return;editing={kind,id:item?.id};$('editTitle').textContent=`${item?'Edit':'Add'} ${kind==='target'?'connection':'signal'}`;$('editEyebrow').textContent=kind==='target'?'SAVED CONNECTION':'SIGNAL LIBRARY';$('editFields').replaceChildren();$('formError').textContent='';$('deleteItem').hidden=!item;
  if(kind==='target'){
    $('editFields').append(field('itemName','Name',item?.name||'',{maxLength:80}));
    $('editFields').append(selectField('targetType','Connection type',[['http','HTTP Signal · Player'],['serial','Serial · COM device'],['udp','UDP · send / receive']],item?.type||'http'));
    const transport=el('div');transport.id='transportFields';$('editFields').append(transport);renderTransportFields(item||{});$('targetType').onchange=()=>renderTransportFields(item||{});
  }else{
    $('editFields').append(field('itemName','Display name',item?.name||'',{maxLength:80}),field('itemKey','Signal key',item?.key||'',{maxLength:120}),field('itemCooldown','Cooldown · seconds',item?.cooldown??3,{type:'number',min:0,max:3600,step:0.1}),el('p','field-help','Must match the key in Editor → Signals. Keys are saved in lowercase. Set its optional value in the right panel.'));
    renderKeyPicker(item);
  }
  $('editDialog').showModal();$('itemName').focus();
}
$('editForm').addEventListener('submit',async e=>{
  e.preventDefault();if(saving)return;$('formError').textContent='';
  try{
    if(!workspace)throw Error(workspaceError);
    if(!editing)throw Error('Close this dialog and choose Add target or Add signal again.');
    const next=clone(workspace),list=editing.kind==='target'?next.targets:next.signals;
    let item=list.find(i=>i.id===editing.id);if(!item){item={id:crypto.randomUUID(),value:null};list.push(item);}
    item.name=$('itemName').value;
    if(editing.kind==='target'){const index=list.indexOf(item);item=readTargetFields(item);list[index]=item;if(!next.activeTarget)next.activeTarget=item.id;}
    else{item.key=$('itemKey').value;item.cooldown=Number($('itemCooldown').value);if(shortcutDraft)item.shortcut=shortcutDraft;else delete item.shortcut;}
    await saveWorkspace(next);if(editing.kind==='target')healthChecks.delete(item.id);else{selectedId=item.id;draft=clone(item.value);}
    render();$('editDialog').close();toast(`${editing.kind==='target'?'Target':'Signal'} saved.`);
  }catch(err){$('formError').textContent=err.message;}
});
function confirmAction(title,text,yes='Continue'){
  $('confirmTitle').textContent=title;$('confirmText').textContent=text;$('confirmYes').textContent=yes;$('confirmDialog').showModal();
  return new Promise(resolve=>{
    const finish=result=>{$('confirmDialog').close();$('confirmYes').onclick=null;$('confirmNo').onclick=null;$('confirmDialog').removeEventListener('cancel',cancel);resolve(result);};
    const cancel=e=>{e.preventDefault();finish(false);};$('confirmYes').onclick=()=>finish(true);$('confirmNo').onclick=()=>finish(false);$('confirmDialog').addEventListener('cancel',cancel);
  });
}
$('deleteItem').addEventListener('click',safe(async()=>{
  if(!editing?.id||saving)return;const kind=editing.kind;
  if(!await confirmAction(`Delete this ${kind}?`,'This removes it from the tester only. Your Player and .scene file stay unchanged.','Delete'))return;
  const next=clone(workspace),list=kind==='target'?'targets':'signals';next[list]=next[list].filter(i=>i.id!==editing.id);await saveWorkspace(next);$('editDialog').close();toast(`${kind==='target'?'Target':'Signal'} deleted.`);
}));
document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$('addTarget').onclick=()=>openEditor('target');$('addSignal').onclick=()=>openEditor('signal');$('editSignal').onclick=()=>openEditor('signal',selected());
$('checkTarget').onclick=()=>checkHealth();$('search').addEventListener('input',renderSignals);
$('valueType').addEventListener('change',()=>{if($('valueType').value==='number')$('valueInput').value='0';updateValue();});
$('valueInput').addEventListener('input',updateValue);$('booleanValue').addEventListener('change',updateValue);
$('saveValue').onclick=safe(async()=>{if(lockWorkspace())return;const next=clone(workspace);next.signals.find(s=>s.id===selectedId).value=readValue();await saveWorkspace(next);toast('Value saved to this Signal.');});
$('sendSignal').onclick=safe(()=>sendOnce(currentPayload()));$('startRepeat').onclick=safe(startRepeat);$('stopRepeat').onclick=()=>stopRepeat();
$('retryEvent').onclick=safe(async()=>{const e=detailEvent;const t=workspace.targets.find(t=>t.id===e.target.id);if(!t)throw Error('This target has been deleted.');if(address(t)!==address(e.target)){toast('This target address has changed. Send from the main panel to use the new address.',true);return;}$('detailDialog').close();await sendOnce({targetId:e.target.id,key:e.key,value:e.value});});
$('copyPayload').onclick=safe(async()=>{const {key,value}=currentPayload();await navigator.clipboard.writeText(JSON.stringify({key,value},null,2));toast('Payload copied.');});
$('logFilter').onchange=renderEvents;
document.querySelectorAll('[data-log-filter]').forEach(b=>b.addEventListener('click',()=>{$('logFilter').value=b.dataset.logFilter;renderEvents();}));
function showTab(name,remember=true){
  for(const tab of document.querySelectorAll('[data-tab]')){const on=tab.dataset.tab===name;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;$(tab.getAttribute('aria-controls')).hidden=!on;}
  if(name==='sensors')requestAnimationFrame(()=>{if(typeof drawSensorGraph==='function')drawSensorGraph();});
  if(remember)try{localStorage.setItem('signalTesterTab',name);}catch{}
}
document.querySelectorAll('[data-tab]').forEach(tab=>{
  tab.addEventListener('click',()=>showTab(tab.dataset.tab));
  tab.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;const tabs=[...document.querySelectorAll('[data-tab]')],next=tabs[(tabs.indexOf(tab)+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];e.preventDefault();e.stopPropagation();showTab(next.dataset.tab);next.focus();});
});
try{const saved=localStorage.getItem('signalTesterTab');if(saved==='sensors')showTab('sensors',false);}catch{}
$('repeatDetails').addEventListener('toggle',()=>{try{localStorage.setItem('signalTesterRepeat',$('repeatDetails').open?'1':'0');}catch{}});
try{if(localStorage.getItem('signalTesterRepeat')==='1')$('repeatDetails').open=true;}catch{}
$('copyPayload').addEventListener('click',e=>e.preventDefault());
setInterval(()=>{if(document.visibilityState==='visible')updateCardResults(false);},5000);
$('clearLog').onclick=safe(async()=>{if(lockWorkspace())return;if(!await confirmAction('Clear activity?','This clears this session’s activity. Export the log first if you need to keep it.','Clear'))return;const result=await api('clear',{});events=[];frozenEvents=[];missedEvents=0;logGeneration=result.generation;liveCursor=result.cursor;renderEvents();});
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('exportLog').onclick=()=>download('signal-log-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',{exportedAt:new Date().toISOString(),events});
$('exportWorkspace').onclick=()=>workspace&&download('signal-tester-workspace.json',workspace);
$('importWorkspace').onclick=()=>{if(!lockWorkspace())$('workspaceFile').click();};$('importScene').onclick=()=>{if(!lockWorkspace())$('sceneFile').click();};
async function readFile(input){const file=input.files[0];input.value='';if(!file)return null;if(file.size>5_000_000)throw Error('Choose a file smaller than 5 MB.');try{return JSON.parse((await file.text()).replace(/^\uFEFF/,''));}catch{throw Error('This is not a valid JSON / .scene file.');}}
$('workspaceFile').onchange=safe(async()=>{const data=await readFile($('workspaceFile'));if(!data||lockWorkspace())return;if(!await confirmAction('Import workspace?','This replaces the saved targets and Signals on this PC. Export the current workspace first if you want to keep it.','Replace workspace'))return;await saveWorkspace(data);healthChecks.clear();selectedId=null;render();toast('Workspace imported.');});
$('sceneFile').onchange=safe(async()=>{
  const data=await readFile($('sceneFile'));if(!data||lockWorkspace())return;saving=true;updateControls();$('saveState').textContent='Saving…';
  try{const result=await api('import-scene',data);workspace=result.workspace;workspaceRevision=result.revision;$('saveState').textContent='Saved on this PC';render();toast(`${result.added} Signals added · ${result.skipped} existing keys kept.`);}
  catch(e){$('saveState').textContent='Import not saved';throw e;}finally{saving=false;updateControls();}
});
$('helpButton').onclick=()=>$('helpDialog').showModal();
document.querySelectorAll('[data-guide-language]').forEach(button=>button.addEventListener('click',()=>{
  const korean=button.dataset.guideLanguage==='ko';
  $('helpKo').hidden=!korean;$('helpEn').hidden=korean;
  $('helpDialog').lang=korean?'ko':'en';
  $('helpTitle').textContent=korean?'키 설정부터 장면 전환까지.':'From key to scene.';
  $('helpClose').setAttribute('aria-label',korean?'닫기':'Close');
  $('helpDone').textContent=korean?'확인':'Got it';
  document.querySelectorAll('[data-guide-language]').forEach(option=>option.setAttribute('aria-pressed',String(option===button)));
}));
function outsideHelp(event){
  const dialog=$('helpDialog'),rect=dialog.getBoundingClientRect();
  return event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom);
}
let helpPointerStartedOutside=false;
$('helpDialog').addEventListener('pointerdown',event=>{helpPointerStartedOutside=outsideHelp(event);});
$('helpDialog').addEventListener('click',event=>{
  if(helpPointerStartedOutside&&outsideHelp(event))$('helpDialog').close();
  helpPointerStartedOutside=false;
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&repeating){e.preventDefault();stopRepeat();}
  const typing=e.target.closest?.('input,textarea,select,[contenteditable="true"]');
  if(!typing&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!document.querySelector('dialog[open]')&&!(typeof keyboardEnabled!=='undefined'&&keyboardEnabled)){
    if(e.key==='/'){e.preventDefault();showTab('test');$('search').focus();return;}
    if(e.key==='?'){e.preventDefault();$('helpDialog').showModal();return;}
  }
  if(e.key==='Escape'&&e.target===$('search')&&$('search').value){$('search').value='';renderSignals();return;}
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.repeat&&!document.querySelector('dialog[open]')){e.preventDefault();if(!(isRaw()?$('sendRaw'):$('sendSignal')).disabled)safe(()=>sendOnce(currentPayload()))();}
});
window.addEventListener('pagehide',()=>stopRepeat('Repeat stopped because this page closed.'));
window.addEventListener('beforeunload',e=>{if(repeating||sending||saving){e.preventDefault();e.returnValue='';}});
function lockStartupControls(){
  if(startupControls)return;
  startupControls=new Map();
  for(const control of document.querySelectorAll('button,input,select,textarea')){
    if(control.id==='helpButton'||control.id==='retryWorkspace'||control.closest('#helpDialog, #codeGuideDialog')||control.classList.contains('close-dialog'))continue;
    startupControls.set(control,control.disabled);control.disabled=true;
  }
}
function unlockStartupControls(){
  for(const [control,disabled] of startupControls || [])control.disabled=disabled;
  startupControls=null;
}
async function loadWorkspace(){
  if(workspaceLoading||workspace)return;
  workspaceLoading=true;lockStartupControls();
  $('workspaceStatus').hidden=false;$('workspaceStatus').classList.remove('error');
  $('workspaceTitle').textContent='Loading workspace…';$('workspaceDetail').textContent='Reading saved connections and Signals from the tester engine.';
  $('retryWorkspace').disabled=true;$('saveState').textContent='Loading workspace…';
  try{
    if(!workspaceSetup){
      // An older Python process can serve current HTML but return 404 for newer scripts.
      const missing=['ioSetup','sensorSetup','keyboardSetup','updateIOControls','sensorRuntimeUpdate'].filter(name=>typeof window[name]!=='function');
      if(missing.length)throw Error('This page and the running tester engine are different versions. '+restartHelp);
      ioSetup();sensorSetup();keyboardSetup();workspaceSetup=true;updateControls();
    }
    const state=await api('state');
    if(!state.workspace||!Array.isArray(state.workspace.targets)||!Array.isArray(state.workspace.signals)||!Array.isArray(state.events))throw Error('The tester returned an incomplete workspace. '+restartHelp);
    workspace=state.workspace;workspaceRevision=state.revision;events=state.events;liveCursor=state.cursor;logGeneration=state.generation;
    applyRuntime(state);$('warning').hidden=!state.warning;$('warning').textContent=state.warning;
    unlockStartupControls();render();$('saveState').textContent=state.warning?'Check workspace warning':'Saved on this PC';
    $('workspaceStatus').hidden=true;checkHealth();pollLive();
  }catch(error){
    const detail=error.message.includes(restartHelp)?error.message:error.message+' '+restartHelp;
    workspace=null;workspaceError='Workspace could not be loaded. '+detail;
    lockStartupControls();$('workspaceStatus').classList.add('error');
    $('workspaceTitle').textContent='Workspace not loaded';$('workspaceDetail').textContent=detail;
    $('saveState').textContent='Workspace not loaded';
  }finally{workspaceLoading=false;$('retryWorkspace').disabled=false;}
}
$('retryWorkspace').onclick=()=>workspaceSetup?loadWorkspace():location.reload();
function setupActivityResize(){
  const layout=document.querySelector('.layout'),rail=document.querySelector('.activity-rail'),handle=$('activityResize');
  const desktop=matchMedia('(min-width:1241px)'),cookie='signalTesterActivityWidth';
  let preferred=null,drag=null;
  // A host-scoped cookie retains this visual preference across the launcher's random ports.
  try{const value=document.cookie.split('; ').find(c=>c.startsWith(cookie+'='))?.split('=')[1];
    if(value&&Number.isFinite(Number(value)))preferred=Math.max(320,Math.min(1000,Number(value)));}catch{}
  function limits(){return {min:320,max:Math.max(320,Math.min(1000,layout.clientWidth-496))};}
  function apply(){
    const {min,max}=limits();
    if(desktop.matches&&preferred!==null)layout.style.setProperty('--activity-width',Math.round(Math.max(min,Math.min(max,preferred)))+'px');
    else layout.style.removeProperty('--activity-width');
    handle.setAttribute('aria-valuemin',min);handle.setAttribute('aria-valuemax',max);
    handle.setAttribute('aria-valuenow',Math.round(rail.getBoundingClientRect().width));
  }
  function save(){try{document.cookie=`${cookie}=${preferred===null?'':Math.round(preferred)}; Path=/; Max-Age=${preferred===null?0:31536000}; SameSite=Strict`;}catch{}}
  function setWidth(width){const {min,max}=limits();preferred=Math.max(min,Math.min(max,width));apply();}
  function finish(){
    if(!drag)return;
    const id=drag.id;drag=null;document.body.classList.remove('resizing-activity');
    if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);
    save();
  }
  handle.addEventListener('pointerdown',e=>{
    if(e.button!==0||!desktop.matches)return;
    e.preventDefault();handle.focus({preventScroll:true});
    drag={id:e.pointerId,x:e.clientX,width:rail.getBoundingClientRect().width};
    handle.setPointerCapture(e.pointerId);document.body.classList.add('resizing-activity');
  });
  handle.addEventListener('pointermove',e=>{if(drag&&e.pointerId===drag.id)setWidth(drag.width+drag.x-e.clientX);});
  handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
  handle.addEventListener('dblclick',()=>{finish();preferred=null;save();apply();});
  handle.addEventListener('keydown',e=>{
    if(!desktop.matches||!['ArrowLeft','ArrowRight','Home','End','Enter'].includes(e.key))return;
    e.preventDefault();e.stopPropagation();
    const width=rail.getBoundingClientRect().width,{min,max}=limits();
    if(e.key==='Enter'){preferred=null;apply();}
    else setWidth(e.key==='Home'?min:e.key==='End'?max:width+(e.key==='ArrowLeft'?1:-1)*(e.shiftKey?64:24));
    save();
  });
  desktop.addEventListener('change',()=>{finish();apply();});
  window.addEventListener('blur',finish);
  new ResizeObserver(apply).observe(layout);
  apply();
}
setupActivityResize();
loadWorkspace();
