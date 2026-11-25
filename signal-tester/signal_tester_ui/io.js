// Connection UI and live monitoring share the same Python engine as HTTP Signals.
let connectionStates={}, serialInfo={available:true,ports:[],error:''}, ioBusy=false, engineOffline=false;
let liveCursor=0, logGeneration=0, logPaused=false, frozenEvents=[], missedEvents=0, rxFormat='text', rawTargetId=null, lastPortsPaint='', lastSelectedTarget=null;
const rawDrafts=new Map();
const kind=t=>t?.type||'http';
const isRaw=()=>kind(active())!=='http';
const sentOK=e=>e && (e.protocol==='http'||!e.protocol ? e.received : e.ok);
const stamp=value=>value?new Date(value).toLocaleTimeString('en-GB'):'Not yet';

function mergeEvents(incoming){
  const combined=new Map(events.map(e=>[e.id,e]));
  for(const event of incoming)combined.set(event.id,event);
  events=[...combined.values()].sort((a,b)=>(b.seq||b.time)-(a.seq||a.time)).slice(0,500);
}
function applyRuntime(data){
  connectionStates=data.connections||connectionStates;serialInfo=data.serial||serialInfo;
  sensorRuntimeUpdate(data);
  if(typeof workbenchUpdate==='function')workbenchUpdate();
  $('portCount').textContent=serialInfo.available?`${serialInfo.ports.length} found`:'Setup needed';
  if($('portsDialog').open&&lastPortsPaint!==JSON.stringify(serialInfo))renderPorts();
}
function selectField(id,title,values,current){
  const wrapper=el('div','field'),label=el('label','',title),select=el('select');label.htmlFor=id;select.id=id;
  for(const [value,text] of values){const option=el('option','',text);option.value=value;select.append(option);}
  select.value=String(current);wrapper.append(label,select);return wrapper;
}
function renderTransportFields(item={}){
  const protocol=$('targetType').value,fields=$('transportFields');fields.replaceChildren();
  if(protocol!==kind(item))item={};
  if(protocol==='http'){
    const row=el('div','field-row');row.append(field('itemHost','IP / hostname',item.host||'127.0.0.1'),field('itemPort','Port',item.port||8420,{type:'number',min:1,max:65535}));
    fields.append(row,el('p','field-help','Player HTTP Signal receiver. Use 127.0.0.1 for this PC; each Player needs its own port.'));
  }else if(protocol==='enttec'){
    fields.append(field('serialDevice','ENTTEC COM port',item.device||'COM3'),field('dmxAddress','First DMX address (4 fixtures / 8 channels)',item.startAddress||1,{type:'number',min:1,max:505}),selectField('dmxOrder','Channel order',[['ww-cw','Warm → Cool'],['cw-ww','Cool → Warm']],item.channelOrder||'ww-cw'),el('p','field-help','USB PRO only, not Open DMX USB. Set both D4-P units to 4CH / 8-bit, addresses N and N+4. This output owns the entire universe; unused channels are zero.'));
  }else if(protocol==='serial'){
    const device=field('serialDevice','COM port',item.device||serialInfo.ports[0]?.device||'COM3');device.querySelector('input').setAttribute('list','serialPortOptions');
    const list=el('datalist');list.id='serialPortOptions';
    for(const p of serialInfo.ports){const option=el('option','',p.description);option.value=p.device;list.append(option);}device.append(list);
    const row=el('div','field-row equal');row.append(device,field('serialBaud','Baud rate',item.baudrate||115200,{type:'number',min:50,max:4000000}));fields.append(row);
    const frame=el('div','field-row triple');
    frame.append(selectField('serialBits','Data bits',[[8,'8'],[7,'7'],[6,'6'],[5,'5']],item.dataBits||8),selectField('serialParity','Parity',[['N','None'],['E','Even'],['O','Odd'],['M','Mark'],['S','Space']],item.parity||'N'),selectField('serialStop','Stop bits',[[1,'1'],[1.5,'1.5'],[2,'2']],item.stopBits||1));
    fields.append(frame,el('p','field-help',serialInfo.error||'Match the sensor manual. Detection does not prove that the port is free. Close other apps using the same COM port before opening it here.'));
  }else{
    const local=el('div','field-row');local.append(field('udpBind','수신 IP · 이 PC',item.bindHost||'127.0.0.1'),field('udpLocalPort','수신 포트',item.bindPort??9000,{type:'number',min:0,max:65535}));
    const remote=el('div','field-row');remote.append(field('udpRemote','전송 대상 IP',item.remoteHost||'127.0.0.1'),field('udpRemotePort','전송 대상 포트',item.remotePort||9001,{type:'number',min:1,max:65535}));
    const check=el('label','check-field'),input=el('input');input.type='checkbox';input.id='udpBroadcast';input.checked=!!item.broadcast;check.append(input,document.createTextNode('브로드캐스트 전송 허용'));
    fields.append(local,el('p','field-help','OSC는 수신 즉시 주소별로 자동 해석됩니다. 같은 PC는 127.0.0.1, 외부 장치 수신은 0.0.0.0을 사용하세요. 포트 0은 빈 포트를 자동 선택합니다.'),remote,el('p','field-help','아래는 수동 전송에 사용하는 목적지입니다. 수신만 할 때는 기본값을 유지해도 됩니다.'),check);
  }
  if(editing?.id&&connectionStates[editing.id]?.status==='open')fields.append(el('p','notice','Saving changed connection settings closes this connection. Open it again to use the new settings.'));
}
function readTargetFields(item){
  const base={id:item.id,name:$('itemName').value},protocol=$('targetType').value;
  if(protocol==='enttec')return {...base,type:protocol,device:$('serialDevice').value,startAddress:Number($('dmxAddress').value),channelOrder:$('dmxOrder').value};
  if(protocol==='serial')return {...base,type:protocol,device:$('serialDevice').value,baudrate:Number($('serialBaud').value),dataBits:Number($('serialBits').value),parity:$('serialParity').value,stopBits:Number($('serialStop').value)};
  if(protocol==='udp')return {...base,type:protocol,bindHost:$('udpBind').value,bindPort:Number($('udpLocalPort').value),remoteHost:$('udpRemote').value,remotePort:Number($('udpRemotePort').value),broadcast:$('udpBroadcast').checked};
  return {...base,host:$('itemHost').value,port:Number($('itemPort').value)};
}
function renderPorts(){
  lastPortsPaint=JSON.stringify(serialInfo);
  const list=$('portList');list.replaceChildren();
  if(serialInfo.error)list.append(el('div','notice error',serialInfo.error));
  for(const port of serialInfo.ports){
    const row=el('div','port-row'),body=el('div');
    body.append(el('strong','',port.device),el('p','',port.description));
    const identity=[port.manufacturer,port.vid!=null?`VID ${port.vid.toString(16).padStart(4,'0').toUpperCase()} · PID ${port.pid?.toString(16).padStart(4,'0').toUpperCase()}`:'',port.serialNumber?`S/N ${port.serialNumber}`:''].filter(Boolean).join(' · ');
    if(identity)body.append(el('small','',identity));
    const use=button('button','Use port',()=>{$('portsDialog').close();openEditor('target');$('targetType').value='serial';renderTransportFields();$('serialDevice').value=port.device;$('itemName').value=port.description==='n/a'?port.device:port.description;});use.disabled=saving||sending||!!repeating||ioBusy;
    row.append(body,use);list.append(row);
  }
  if(!serialInfo.ports.length&&!serialInfo.error){const empty=el('div','empty');empty.append(el('strong','','No COM ports detected'),el('p','','Connect the USB device, check its driver and cable, then refresh. HTTP and UDP remain available.'));list.append(empty);}
}
async function refreshPorts(){
  $('refreshPorts').disabled=true;
  try{serialInfo=await api('ports',{});renderPorts();renderTargets();renderIO();}
  finally{$('refreshPorts').disabled=false;}
}
function renderIO(){
  const target=active(),raw=!!target&&isRaw(),state=connectionStates[target?.id]||{},opened=state.status==='open';
  if(lastSelectedTarget!==target?.id&&!repeating){lastSelectedTarget=target?.id;$('repeatStatus').textContent='Starts now. Stops on connection errors.';$('repeatProgress').hidden=true;}
  $('ioPanel').hidden=!raw;$('rawComposer').hidden=!raw;document.querySelector('.signal-panel').hidden=raw;document.querySelector('.composer').hidden=raw;
  $('checkTarget').hidden=raw;$('connectTarget').hidden=!raw;
  const repeat=document.querySelector('.repeat-block'),repeatParent=raw?$('rawComposer'):document.querySelector('.composer');
  if(repeat.parentElement!==repeatParent)repeatParent.append(repeat);
  $('tabTestLabel').textContent='수동 전송';$('signalCount').hidden=raw;
  renderDmx();
  if(!raw)return;
  $('connectTarget').textContent=ioBusy?'Working…':opened?'연결 해제':'연결 열기';
  $('connectTarget').classList.toggle('stop',opened);$('connectTarget').classList.toggle('dark',!opened);
  const error=state.error,serialTarget=['serial','enttec'].includes(kind(target));
  $('healthStatus').textContent=ioBusy?'Working…':error?'Needs attention':opened?(serialTarget?'Port open':'Listening'):state.status==='error'?'Connection failed':'Closed';
  $('healthStatus').className='badge '+(error||state.status==='error'?'bad':opened?'good':'');
  $('healthTime').textContent=opened?`${state.rxBytes||0} B received`:'';
  $('healthDetail').textContent=error?`${error.stage.toUpperCase()} · ${error.detail}`:state.detail||'Open this connection to send and receive data.';
  $('ioProtocol').textContent=serialTarget?'SERIAL / DEVICE CONNECTION':'UDP / IPV4 DATAGRAMS';$('rawProtocol').textContent=kind(target).toUpperCase();
  $('ioDescription').textContent=serialTarget?`${target.device} · ${target.baudrate} baud · ${target.dataBits}${target.parity}${target.stopBits}`:`Local ${state.local||target.bindHost+':'+target.bindPort} → ${target.remoteHost}:${target.remotePort}`;
  $('connectionStages').replaceChildren();
  const stages=serialTarget?[
    ['Device detected',state.detected?'Found on this PC':serialInfo.error?'Discovery unavailable':'Not detected',state.detected?'good':'waiting'],
    ['Port open',opened?'Ready for I/O':state.status==='error'?'Open / connection failed':'Not opened',opened?'good':state.status==='error'?'bad':'waiting'],
  ]:[
    ['Local socket',opened?'Bound to '+state.local:state.status==='error'?'Bind / connection failed':'Not bound',opened?'good':state.status==='error'?'bad':'waiting'],
    ['Remote delivery','Not confirmed by UDP','waiting'],
  ];
  stages.push(['Receiving',state.lastRx?`${state.rxCount} reads · ${stamp(state.lastRx)}`:'Waiting for data',state.lastRx?'good':'waiting'],['Sending',state.lastTx?`${state.txCount} sends · ${stamp(state.lastTx)}`:'Nothing sent yet',state.lastTx?'good':'waiting']);
  stages.forEach(([title,detail,tone],index)=>{const card=el('div','connection-step '+tone),num=el('span','step-number',String(index+1)),body=el('div');body.append(el('strong','',title),el('small','',detail));card.append(num,body);$('connectionStages').append(card);});
  $('ioIssue').hidden=!error;$('ioIssue').replaceChildren();if(error)$('ioIssue').append(el('strong','',`${error.stage.toUpperCase()} · ${error.label}`),el('p','',error.detail),el('code','',error.raw));
  const packet=state.lastPacket;
  $('lastReceived').textContent=packet?(rxFormat==='hex'?packet.hex:packet.text||'(empty datagram)'):'No bytes received yet.';
  $('receiveMeta').textContent=packet?`${packet.bytes} bytes · from ${packet.peer} · ${stamp(state.lastRx)}${packet.truncated?' · preview truncated to 2 KB':''}${!packet.utf8?' · contains binary / partial UTF-8 bytes; inspect HEX':''}`:'An open connection can be healthy while no data is arriving.';
  $('ioHint').textContent=serialTarget?'Serial reads are raw byte chunks, not parsed sensor messages. If text looks wrong, check baud / parity or inspect HEX.':'UDP replies appear as separate RX events. For external devices, check the local bind address and Windows Firewall if no data arrives.';
  if(rawTargetId!==target.id){rawTargetId=target.id;const saved=rawDrafts.get(target.id)||{format:'text',data:'',ending:'none'};$('rawFormat').value=saved.format;$('rawData').value=saved.data;$('rawEnding').value=saved.ending;updateRaw(false);}
}
function rawPayload(){
  if(kind(active())==='enttec')throw Error('Use the DMX lighting controls. Raw serial sending is disabled for ENTTEC.');
  if(!active()||!isRaw())throw Error('Choose a Serial or UDP connection.');
  return {io:true,targetId:active().id,key:kind(active()).toUpperCase()+' data',format:$('rawFormat').value,data:$('rawData').value,ending:$('rawEnding').value};
}
function updateRaw(save=true){
  const hex=$('rawFormat').value==='hex';if(hex)$('rawEnding').value='none';
  $('rawEnding').disabled=hex||sending||saving||!!repeating||ioBusy;
  const compact=$('rawData').value.replace(/\s/g,''),ending=$('rawEnding').value;
  const bytes=hex?compact.length/2:new TextEncoder().encode($('rawData').value).length+(ending==='crlf'?2:ending==='none'?0:1);
  $('rawBytes').textContent=hex&&!/^(?:[0-9a-fA-F]{2})*$/.test(compact)?'Enter complete HEX pairs, for example AA 01 0D 0A.':`${bytes} bytes · maximum 8 KB`;
  if(save&&active())rawDrafts.set(active().id,{format:$('rawFormat').value,data:$('rawData').value,ending});
}
function updateIOControls(locked){
  if($('dmxPanel'))for(const b of $('dmxPanel').querySelectorAll('button'))b.disabled=locked||dmxBusy||engineOffline||connectionStates[active()?.id]?.status!=='open';
  const target=active(),open=connectionStates[target?.id]?.status==='open';
  $('connectTarget').disabled=locked||!target||engineOffline;$('editConnection').disabled=locked;
  $('sendRaw').disabled=locked||!target||!open||engineOffline;
  for(const id of ['rawFormat','rawData','rawEnding'])$(id).disabled=locked||(id==='rawEnding'&&$('rawFormat').value==='hex');
  if(isRaw())$('startRepeat').disabled=locked||!open||engineOffline;
}
async function toggleConnection(targetId=active()?.id){
  if(lockWorkspace()||engineOffline)return;const target=workspace.targets.find(t=>t.id===targetId);if(!target||kind(target)==='http')return;ioBusy=true;renderIO();updateControls();
  try{const close=connectionStates[target.id]?.status==='open';const result=await api(close?'io/close':'io/open',{targetId:target.id});applyRuntime(result);renderTargets();renderIO();
    const state=connectionStates[target.id];if(state?.error)toast(`${state.error.label} · ${state.error.detail}`,true);else toast(close?'Connection closed.':kind(target)==='udp'?'UDP socket listening. Remote receipt is not confirmed.':'Serial port opened.');
  }finally{ioBusy=false;renderIO();updateControls();}
}
function ioSetup(){
  $('scanPorts').onclick=safe(async()=>{renderPorts();$('portsDialog').showModal();await refreshPorts();});$('refreshPorts').onclick=safe(refreshPorts);
  $('connectTarget').onclick=safe(()=>toggleConnection());$('editConnection').onclick=()=>openEditor('target',active());
  for(const id of ['rawFormat','rawEnding'])$(id).onchange=()=>updateRaw();$('rawData').oninput=()=>updateRaw();$('sendRaw').onclick=safe(()=>sendOnce(rawPayload()));
  for(const fmt of ['Text','Hex'])$('showRx'+fmt).onclick=()=>{rxFormat=fmt.toLowerCase();$('showRxText').setAttribute('aria-pressed',String(rxFormat==='text'));$('showRxHex').setAttribute('aria-pressed',String(rxFormat==='hex'));renderIO();};
  for(const id of ['protocolFilter','directionFilter','currentOnly'])$(id).onchange=renderEvents;
  $('pauseLog').onclick=()=>{logPaused=!logPaused;frozenEvents=logPaused?events.slice():[];const label=logPaused?'Resume view':'Pause view';$('pauseLog').replaceChildren(icon(logPaused?'play':'pause'));$('pauseLog').title=label;$('pauseLog').setAttribute('aria-label',label);$('pauseLog').setAttribute('aria-pressed',String(logPaused));renderEvents();};
}
async function pollLive(){
  if(!workspace){setTimeout(pollLive,650);return;}
  try{
    const graphs=sensorOverlay?sensorGraphSeries().map(s=>'&graph='+encodeURIComponent(s.config.id)).join(''):'';
    const data=await api('live?after='+liveCursor+(sensorSelected?'&monitor='+encodeURIComponent(sensorSelected):'')+graphs);engineOffline=false;$('engineWarning').hidden=true;applyRuntime(data);
    if(data.generation>=logGeneration){
      if(data.generation>logGeneration){events=[];logGeneration=data.generation;}
      mergeEvents(data.events);liveCursor=data.cursor;missedEvents+=data.skipped||0;
    }
    renderTargets();renderIO();renderKeyboard();if(!logPaused)renderEvents();updateControls();
  }catch(e){engineOffline=true;$('engineWarning').hidden=false;$('engineWarning').textContent='Live monitor disconnected. Connection states are unconfirmed. Keep the tester launch window open; reload this page if the engine restarted.';renderSensors();renderKeyboard();updateControls();if(typeof workbenchUpdate==='function')workbenchUpdate();}
  finally{setTimeout(pollLive,650);}
}

// ENTTEC USB PRO: desired levels are drafts; ON/OFF state comes from the engine.
let dmxBusy=false, dmxTarget=null;
function renderDmx(){
  let panel=$('dmxPanel');
  if(!panel){
    panel=el('section','panel');panel.id='dmxPanel';panel.style.padding='24px';
    panel.append(el('h2','','DMX · ENTTEC USB Pro'),el('p','field-help','조명 4개 · 공통 밝기 / 색 혼합 · 개별 ON/OFF. 색 혼합은 보정된 Kelvin 값이 아닙니다.'));
    const row=el('div','field-row');
    row.append(field('dmxBrightness','밝기 (%)',50,{type:'number',min:0,max:100}),field('dmxMix','주광색 비율 (%) · 0=전구색 / 100=주광색',50,{type:'number',min:0,max:100}));panel.append(row);
    panel.append(button('button','밝기 / 색 혼합 적용',safe(()=>sendDmx())));
    const lights=el('div','field-row');lights.id='dmxLights';lights.style.marginTop='16px';panel.append(lights);
    for(let i=0;i<4;i++){const b=button('button','',safe(()=>{const on=dmxState().on.slice();on[i]=!on[i];return sendDmx(on);}));b.id='dmxLight'+i;lights.append(b);}
    panel.append(button('button','전체 켜기',safe(()=>sendDmx([true,true,true,true]))),button('button stop','전체 소등',safe(()=>sendDmx([false,false,false,false],true))));
    const status=el('p','field-help');status.id='dmxStatus';panel.append(status,el('p','field-help','다른 프로그램에서 같은 COM 포트를 열지 마세요. 연결/종료 시 전체 소등을 전송합니다. 브라우저를 닫아도 마지막 출력은 유지됩니다. USB 단절 시 소등은 보장되지 않습니다.'));
    $('rawComposer').parentElement.append(panel);
  }
  const target=active(),enabled=kind(target)==='enttec';panel.hidden=!enabled;
  if(!enabled)return;
  $('rawComposer').hidden=true;
  if(dmxTarget!==target.id){dmxTarget=target.id;const state=dmxState();$('dmxBrightness').value=state.brightness;$('dmxMix').value=state.mix;}
  const state=dmxState();
  for(let i=0;i<4;i++){const b=$('dmxLight'+i),address=target.startAddress+i*2;b.textContent=`조명 ${i+1} · CH ${address}/${address+1} · ${state.on[i]?'ON':'OFF'}`;b.setAttribute('aria-pressed',String(state.on[i]));}
  $('dmxStatus').textContent=`마지막 전송값: 밝기 ${state.brightness}% · 주광색 ${state.mix}% · 실제 점등 확인은 별도입니다.`;
}
function dmxState(){return connectionStates[active()?.id]?.dmx||{brightness:50,mix:50,on:[false,false,false,false]};}
async function sendDmx(on=null,blackout=false){
  if(dmxBusy||saving||sending||ioBusy||repeating||engineOffline)return;
  const target=active();if(kind(target)!=='enttec')return;
  const previous=dmxState();
  const body={targetId:target.id,brightness:blackout?previous.brightness:Number($('dmxBrightness').value),mix:blackout?previous.mix:Number($('dmxMix').value),on:on||previous.on.slice()};
  dmxBusy=true;updateControls();
  try{const event=await api('io/send',body);mergeEvents([event]);renderEvents();if(!event.ok)throw Error(event.detail);const live=await api('live?after='+liveCursor);applyRuntime(live);renderDmx();toast('DMX 전송 완료 · 실제 점등을 확인하세요.');}
  finally{dmxBusy=false;updateControls();}
}
