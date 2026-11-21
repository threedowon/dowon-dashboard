let sensorRuntime={armed:false,monitors:[]}, sensorSelected=null, sensorEditing=null, sensorPaused=false, frozenSensor=null;
let sensorBusy=false, sensorPaint='', sensorRuleDrafts=[];
let sensorSourceFilter='', sensorCardSignature='', sensorSourceSignature='';
function selectSensorMonitor(id){sensorSelected=id;sensorPaused=false;frozenSensor=null;renderSensors();}
function renderSensorOverview(monitors){
  $('sensorOverview').hidden=!monitors.length;
  const sources=workspace.targets.filter(t=>monitors.some(m=>m.sourceId===t.id));
  if(sensorSourceFilter&&!sources.some(s=>s.id===sensorSourceFilter))sensorSourceFilter='';
  const sourceSignature=JSON.stringify(sources.map(s=>[s.id,s.name]));
  if(sourceSignature!==sensorSourceSignature){
    sensorSourceSignature=sourceSignature;
    $('sensorSourceFilter').replaceChildren();
    for(const [id,name] of [['','모든 센서'],...sources.map(s=>[s.id,s.name])]){
      const option=el('option','',name);option.value=id;$('sensorSourceFilter').append(option);
    }
  }
  $('sensorSourceFilter').value=sensorSourceFilter;
  const visible=monitors.filter(m=>!sensorSourceFilter||m.sourceId===sensorSourceFilter);
  const signature=JSON.stringify(visible.map(m=>[m.id,m.name,m.unit,m.sourceId]));
  if(signature!==sensorCardSignature){
    sensorCardSignature=signature;$('sensorCards').replaceChildren();
    for(const m of visible){
      const card=button('sensor-value-card','',()=>selectSensorMonitor(m.id));
      card.dataset.monitorId=m.id;
      card.append(el('span','sensor-card-name',m.name),el('strong','sensor-card-value','—'),
        el('small','sensor-card-unit',m.unit),el('span','sensor-card-source',''),el('span','sensor-card-status',''));
      $('sensorCards').append(card);
    }
  }
  for(const card of $('sensorCards').children){
    const m=monitors.find(m=>m.id===card.dataset.monitorId),s=sensorRuntime.monitors.find(s=>s.id===m.id);
    const connected=connectionStates[m.sourceId]?.status==='open';
    const fresh=!engineOffline&&connected&&s?.live&&!s?.error;
    card.classList.toggle('selected',m.id===sensorSelected);card.classList.toggle('stale',!fresh);
    card.setAttribute('aria-pressed',String(m.id===sensorSelected));
    card.querySelector('.sensor-card-value').textContent=s?.value==null?'—':Number(s.value.toPrecision(7)).toLocaleString('en-US');
    card.querySelector('.sensor-card-source').textContent=workspace.targets.find(t=>t.id===m.sourceId)?.name||'Source deleted';
    card.querySelector('.sensor-card-status').textContent=engineOffline?'Engine disconnected':s?.status||'Waiting for data';
  }
}
function selectedMonitor(){return workspace?.sensors?.find(m=>m.id===sensorSelected);}
function sensorState(){return sensorRuntime.monitors.find(m=>m.id===sensorSelected);}
function sensorRuntimeUpdate(data){if(data.sensors){sensorRuntime=data.sensors;renderSensors();}}
function sensorOptions(items,blank){return [[ '',blank],...items.map(t=>[t.id,t.name])];}
function renderSensors(){
  if(!workspace)return;
  const monitors=workspace.sensors||[];
  if(!monitors.some(m=>m.id===sensorSelected)){sensorSelected=monitors[0]?.id||null;sensorPaused=false;frozenSensor=null;}
  renderSensorOverview(monitors);
  $('sensorEmpty').hidden=!!monitors.length;$('sensorContent').hidden=!monitors.length;
  $('sensorCount').textContent=monitors.length;$('sensorTabLive').hidden=!sensorRuntime.armed;
  const sig=JSON.stringify(monitors.map(m=>[m.id,m.name]));
  if(sensorPaint!==sig){sensorPaint=sig;$('sensorSelect').replaceChildren();for(const m of monitors){const o=el('option','',m.name);o.value=m.id;$('sensorSelect').append(o);}}
  $('sensorSelect').value=sensorSelected||'';
  $('sensorArm').textContent=sensorRuntime.armed?'Pause all rules':'Enable all rules';
  $('sensorArm').classList.toggle('stop',sensorRuntime.armed);$('sensorArm').disabled=sensorBusy||engineOffline||!monitors.some(m=>m.rules.some(r=>r.enabled));
  $('sensorMode').textContent=engineOffline?'Engine disconnected':sensorRuntime.armed?'RULES LIVE':'PREVIEW ONLY';
  $('sensorMode').className='badge '+(engineOffline?'bad':sensorRuntime.armed?'good':'');
  $('sensorRunNote').textContent=sensorRuntime.armed?'Rules run in Python, even if you close this page. Pause all rules to stop new sends.':
    'Graph receives live data. Enable rules to send Signals. Restarting or changing a rule pauses automation.';
  $('sensorCollapse').textContent=$('sensorBody').hidden?'Expand':'Collapse';
  if(!monitors.length)return;
  const config=selectedMonitor(),state=sensorState(),source=workspace.targets.find(t=>t.id===config.sourceId);
  $('sensorSource').textContent=source?`${kind(source).toUpperCase()} · ${source.name} → ${config.parser==='json'?'JSON / '+config.field:'Number per line'}`:'Source deleted · edit this monitor';
  $('sensorValue').textContent=state?.value==null?'—':Number(state.value.toPrecision(7)).toLocaleString('en-US');
  $('sensorUnit').textContent=config.unit;$('sensorStatus').textContent=engineOffline?'Connection unconfirmed':state?.status||'Waiting for data';
  $('sensorStatus').className='badge '+(engineOffline||state?.error||state?.status.includes('deleted')?'bad':state?.live?'good':'');
  $('sensorStats').textContent=`${state?.samples||0} samples · ${state?.errors||0} parse errors · last ${stamp(state?.time)}`;
  $('sensorError').hidden=!state?.error;$('sensorError').textContent=state?.error||'';
  $('sensorRules').replaceChildren();
  for(const r of config.rules){const signal=workspace.signals.find(s=>s.id===r.signalId),target=workspace.targets.find(t=>t.id===r.targetId),status=state?.rules.find(s=>s.id===r.id);
    const row=el('div','sensor-rule-summary'),left=el('div'),right=el('div');
    left.append(el('strong','',`${r.op==='lt'?'Below':'Above'} ${r.threshold} ${config.unit} → ${signal?.key||'Deleted Signal'}`),el('small','',`${target?.name||'Deleted Player'} · hold ${r.hold}s · ${r.repeatSeconds ? 'repeat '+r.repeatSeconds+'s' : 'once · reset margin '+r.hysteresis}`));
    right.append(el('span','badge'+(status?.lastOK===false?' bad':status?.lastOK===true?' good':''),status?.status||'Preview only'),el('small','',status?.lastResult?'Last output: '+status.lastResult:'No output yet'));
    row.append(left,right);$('sensorRules').append(row);
  }
  if(!config.rules.length)$('sensorRules').append(el('p','muted','No rules yet. Configure this monitor to add a condition and Player output.'));
  $('pauseGraph').textContent=sensorPaused?'Resume graph':'Freeze graph';
  drawSensorGraph();
}
function drawSensorGraph(){
  const canvas=$('sensorGraph');if(!canvas||!selectedMonitor()||$('sensorBody').hidden)return;
  const config=selectedMonitor(),state=sensorPaused?frozenSensor:sensorState();
  const w=canvas.clientWidth,h=220;if(!w)return;
  const ratio=window.devicePixelRatio||1;canvas.width=w*ratio;canvas.height=h*ratio;
  const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.clearRect(0,0,w,h);
  const end=sensorPaused?(frozenSensor?.graphTime||Date.now()):Date.now(),start=end-60000;
  const pts=(state?.points||[]).filter(p=>p[0]>=start);
  const values=pts.map(p=>p[1]).concat(config.rules.map(r=>r.threshold));
  let min=values.length?Math.min(...values):0,max=values.length?Math.max(...values):100;
  const padding=Math.max((max-min)*.12,Math.abs(max)*.03,1);min-=padding;max+=padding;
  const l=68,r=w-18,top=18,bottom=185;
  const x=t=>l+(t-start)/60000*(r-l),y=v=>bottom-(v-min)/(max-min)*(bottom-top);
  ctx.font='11px "Segoe UI", system-ui, sans-serif';ctx.lineWidth=1;
  for(let i=0;i<5;i++){const v=min+(max-min)*i/4,yy=y(v);ctx.strokeStyle='#e2e7df';ctx.beginPath();ctx.moveTo(l,yy);ctx.lineTo(r,yy);ctx.stroke();ctx.fillStyle='#6f7f76';ctx.textAlign='right';ctx.fillText(Number(v.toPrecision(4)).toString(),l-9,yy+4);}
  ctx.textAlign='center';for(let i=0;i<=4;i++)ctx.fillText(i===4?'Now':`−${60-15*i}s`,l+(r-l)*i/4,209);
  config.rules.forEach((rule,i)=>{ctx.strokeStyle=i%2?'#c48a2a':'#b13a30';ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(l,y(rule.threshold));ctx.lineTo(r,y(rule.threshold));ctx.stroke();ctx.setLineDash([]);});
  ctx.strokeStyle='#1f7a52';ctx.lineWidth=2.2;ctx.beginPath();let previous=null;
  for(const p of pts){if(!previous||p[0]-previous[0]>config.staleSeconds*1000)ctx.moveTo(x(p[0]),y(p[1]));else ctx.lineTo(x(p[0]),y(p[1]));previous=p;}ctx.stroke();
  if(previous){ctx.beginPath();ctx.arc(x(previous[0]),y(previous[1]),3.5,0,Math.PI*2);ctx.fillStyle='#1f7a52';ctx.fill();}
  if(!pts.length){ctx.textAlign='center';ctx.fillStyle='#6f7f76';ctx.fillText('Waiting for numeric sensor data…',(l+r)/2,100);}
  $('graphCaption').textContent=sensorPaused?'Frozen view · receiving and rules continue':'Last 60 seconds · dashed lines = thresholds · units are not converted';
}
function numberField(id,title,value,min=0,max=3600){const f=field(id,title,value,{type:'number',min,max});f.querySelector('input').step='any';return f;}
function newSensorRule(){return {id:crypto.randomUUID(),signalId:workspace.signals[0]?.id||'',targetId:workspace.targets.find(t=>kind(t)==='http')?.id||'',op:'lt',threshold:100,hysteresis:10,hold:0,valueMode:'sensor',enabled:true};}
function readSensorRules(){return [...$('sensorEditRules').children].map(row=>{
  const get=name=>row.querySelector('[data-rule-field="'+name+'"]');
  return {id:row.dataset.ruleId,signalId:get('signalId').value,targetId:get('targetId').value,op:get('op').value,
    threshold:Number(get('threshold').value),hysteresis:Number(get('hysteresis').value),hold:Number(get('hold').value),repeatSeconds:Number(get('repeatSeconds').value),valueMode:get('valueMode').value,enabled:get('enabled').checked};
});}
function renderSensorRuleEditor(){
  const host=$('sensorEditRules');host.replaceChildren();
  sensorRuleDrafts.forEach((rule,index)=>{
    const row=el('div','sensor-rule-editor');row.dataset.ruleId=rule.id;
    const header=el('div','section-heading small'),enabled=el('label','filter-current'),check=el('input');check.type='checkbox';check.checked=rule.enabled;check.dataset.ruleField='enabled';enabled.append(check,document.createTextNode('Rule '+(index+1)));
    header.append(enabled,iconButton('trash','Remove rule '+(index+1),()=>{sensorRuleDrafts=readSensorRules().filter(r=>r.id!==rule.id);renderSensorRuleEditor();}));row.append(header);
    const first=el('div','sensor-rule-fields'),second=el('div','sensor-rule-fields');
    const add=(host,f,key)=>{f.querySelector('input,select').dataset.ruleField=key;host.append(f);};
    const rid=rule.id;
    add(first,selectField(rid+'-op','When value is',[['lt','Below (<)'],['gt','Above (>)']],rule.op),'op');
    add(first,numberField(rid+'-threshold','Threshold',rule.threshold,-1e12,1e12),'threshold');
    add(first,selectField(rid+'-signal','Send Signal',sensorOptions(workspace.signals,'Choose Signal…'),rule.signalId),'signalId');
    add(first,selectField(rid+'-target','To Player',sensorOptions(workspace.targets.filter(t=>kind(t)==='http'),'Choose Player…'),rule.targetId),'targetId');
    add(second,numberField(rid+'-hold','Hold · seconds',rule.hold),'hold');
    add(second,numberField(rid+'-repeat','Repeat · seconds (0 = once)',rule.repeatSeconds||0),'repeatSeconds');
    add(second,numberField(rid+'-margin','Reset margin · units',rule.hysteresis,0,1e12),'hysteresis');
    add(second,selectField(rid+'-value','Signal value',[['sensor','Sensor reading'],['saved','Saved Signal value']],rule.valueMode),'valueMode');
    row.append(first,second);host.append(row);
  });
}
function openSensorEditor(){
  if(lockWorkspace()||sensorBusy)return;
  const m=selectedMonitor();sensorEditing=m?.id||null;
  $('sensorEditTitle').textContent=m?'Configure sensor':'Add sensor monitor';$('sensorFormError').textContent='';$('deleteSensor').hidden=!m;
  const fields=$('sensorEditFields');fields.replaceChildren();
  const first=el('div','field-row equal');first.append(field('sensorName','Monitor name',m?.name||'Distance',{maxLength:80}),selectField('sensorInput','Receive from',sensorOptions(workspace.targets.filter(t=>kind(t)!=='http'),'Choose Serial or UDP…'),m?.sourceId|| (isRaw()?active()?.id:'')));
  const second=el('div','sensor-rule-fields');second.append(selectField('sensorParser','Message format',[['number','Number'],['json','JSON field']],m?.parser||'number'),field('sensorJsonField','JSON field path',m?.field||'distance',{maxLength:120}),field('sensorUnitInput','Display unit',m?.unit||'cm',{maxLength:16,required:false}),numberField('sensorTimeout','Data timeout · seconds',m?.staleSeconds||2,.1,60));
  fields.append(first,second,el('p','field-help','Serial: one value per line (LF / CRLF / CR). UDP: one complete value or JSON object per datagram; multiple lines are accepted. Examples: 120.5 or {"distance":120.5}. No binary decoding or unit conversion.'));
  const parserChange=()=>{$('sensorJsonField').disabled=$('sensorParser').value!=='json';};$('sensorParser').onchange=parserChange;parserChange();
  sensorRuleDrafts=clone(m?.rules||[]);renderSensorRuleEditor();$('sensorDialog').showModal();
}
function sensorSetup(){
  $('sensorHub').onclick=()=>showTab('sensors');
  $('sensorSourceFilter').onchange=e=>{sensorSourceFilter=e.target.value;renderSensors();};
  $('addSensor').onclick=()=>{sensorSelected=null;openSensorEditor();};$('configureSensor').onclick=openSensorEditor;
  $('sensorSelect').onchange=e=>{sensorSelected=e.target.value;sensorPaused=false;frozenSensor=null;renderSensors();};
  $('sensorCollapse').onclick=()=>{$('sensorBody').hidden=!$('sensorBody').hidden;renderSensors();};
  $('pauseGraph').onclick=()=>{sensorPaused=!sensorPaused;frozenSensor=sensorPaused?{...clone(sensorState()||{}),graphTime:Date.now()}:null;renderSensors();};
  $('sensorArm').onclick=safe(async()=>{sensorBusy=true;renderSensors();try{sensorRuntimeUpdate(await api('sensors/arm',{enabled:!sensorRuntime.armed}));}finally{sensorBusy=false;renderSensors();}});
  $('addSensorRule').onclick=()=>{sensorRuleDrafts=readSensorRules();if(sensorRuleDrafts.length>=16){$('sensorFormError').textContent='Maximum 16 rules per sensor.';return;}sensorRuleDrafts.push(newSensorRule());renderSensorRuleEditor();};
  $('sensorForm').onsubmit=async e=>{
    e.preventDefault();if(saving)return;$('sensorFormError').textContent='';
    try{
      const config={id:sensorEditing||crypto.randomUUID(),name:$('sensorName').value,sourceId:$('sensorInput').value,parser:$('sensorParser').value,field:$('sensorJsonField').value,
        unit:$('sensorUnitInput').value,staleSeconds:Number($('sensorTimeout').value),rules:readSensorRules()};
      const next=clone(workspace);next.sensors=(next.sensors||[]).filter(m=>m.id!==config.id);next.sensors.push(config);
      await saveWorkspace(next);sensorSelected=config.id;sensorPaused=false;$('sensorDialog').close();renderSensors();toast('Sensor saved. Review the graph, then enable rules.');
    }catch(error){$('sensorFormError').textContent=error.message;}
  };
  $('deleteSensor').onclick=safe(async()=>{if(!sensorEditing)return;if(!await confirmAction('Delete sensor monitor?','This removes its graph and rules. The source connection is kept.','Delete'))return;
    const next=clone(workspace);next.sensors=next.sensors.filter(m=>m.id!==sensorEditing);await saveWorkspace(next);$('sensorDialog').close();});
  new ResizeObserver(drawSensorGraph).observe($('sensorGraph'));
}
