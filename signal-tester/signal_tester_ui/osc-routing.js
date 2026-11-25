'use strict';
// Settings are explicitly saved; live polling only refreshes status and logs.
document.addEventListener('DOMContentLoaded',()=>{
  const q=id=>document.getElementById(id);
  let data=null, rules=[], loaded=false, busy=false, loadVersion=0, routeRevision=null;
  function status(runtime){
    q('oscStatusRouting').textContent=runtime.state==='listening'?'OSC 수신 중 · 창을 닫아도 유지됩니다.':runtime.state==='error'?'수신 실패: '+runtime.error:'OSC 수신 중지';
    q('oscLog').textContent=runtime.logs.map(e=>`${new Date(e.time).toLocaleTimeString()} [${e.stage}] ${e.detail}${e.args?' '+JSON.stringify(e.args):''}${e.peer?' ← '+e.peer:''}${e.target?' → '+e.target:''}${e.key?' · '+e.key:''}`).join('\n');
  }
  function field(row,label,input){const wrapper=document.createElement('label');wrapper.textContent=label;wrapper.append(input);row.append(wrapper);return input;}
  function select(options,value,change){const el=document.createElement('select');el.required=true;el.append(new Option('선택…',''));for(const [key,label] of options)el.append(new Option(label,key));el.value=value;el.onchange=()=>change(el.value);return el;}
  function render(){
    q('oscRules').replaceChildren();
    for(const rule of rules){
      const row=document.createElement('fieldset');row.style.margin='16px 0';row.style.padding='12px';
      const address=document.createElement('input');address.value=rule.address;address.placeholder='/sensor/person';address.required=true;address.oninput=()=>rule.address=address.value;field(row,'OSC 주소',address);
      field(row,'조건',select([['any','수신할 때마다'],['eq','값이 같을 때 (=)'],['gte','이상 (≥)'],['lte','이하 (≤)']],rule.operator,value=>rule.operator=value));
      const value=document.createElement('input');value.value=typeof rule.value==='string'?JSON.stringify(rule.value):String(rule.value);value.placeholder='1 또는 "person"';value.oninput=()=>{rule.rawValue=value.value;};field(row,'비교 값 (숫자 / true / false / 문자열)',value);
      field(row,'Player',select(data.targets.filter(t=>!t.type || t.type==='http').map(t=>[t.id,t.name+' · '+t.host+':'+t.port]),rule.targetId,value=>rule.targetId=value));
      field(row,'Signal',select(data.signals.map(s=>[s.id,s.name+' · '+s.key]),rule.signalId,value=>rule.signalId=value));
      const cooldown=document.createElement('input');Object.assign(cooldown,{type:'number',min:'0',max:'3600',step:'0.1',value:String(rule.cooldown)});cooldown.oninput=()=>rule.cooldown=cooldown.valueAsNumber;field(row,'매핑 재전송 간격 (초)',cooldown);
      const remove=document.createElement('button');remove.type='button';remove.className='button';remove.textContent='매핑 삭제';remove.onclick=()=>{rules=rules.filter(r=>r!==rule);render();};row.append(remove);q('oscRules').append(row);
    }
  }
  async function load(){
    const version=++loadVersion;
    try{const result=await api('osc-routing');if(version!==loadVersion)return;data=result.workspace;routeRevision=result.revision;const config=data.osc || {host:'0.0.0.0',port:9000,enabled:false,rules:[]};rules=structuredClone(config.rules);q('oscHost').value=config.host;q('oscPort').value=config.port;q('oscEnabled').checked=config.enabled;render();status(result.osc);loaded=true;}
    catch(error){q('oscStatusRouting').textContent=error.message+' · 이 기능은 통신 프로그램 v1.4.0 이상이 필요합니다. 설정에서 업데이트한 뒤 다시 연결하세요.';}
  }
  q('oscAddRouting').onclick=()=>{if(!loaded)return;rules.push({id:crypto.randomUUID(),address:'/sensor/person',operator:'eq',value:1,cooldown:1,targetId:data.targets.find(t=>!t.type || t.type==='http')?.id || '',signalId:data.signals[0]?.id || ''});render();};
  q('oscReload').onclick=load;
  q('tabOsc').addEventListener('click',async()=>{if(!loaded){load();return;}try{const latest=await api('osc-routing');data=latest.workspace;render();status(latest.osc);}catch(error){toast(error.message,true);}});
  q('oscForm').onsubmit=async event=>{
    event.preventDefault();if(!loaded || busy || lockWorkspace())return;busy=true;
    try{
      const mappings=rules.map(({rawValue,...r})=>{if(rawValue!==undefined){try{r.value=JSON.parse(rawValue);}catch{r.value=rawValue;}}return r;});
      const result=await api('osc-routing',{config:{enabled:q('oscEnabled').checked,host:q('oscHost').value.trim(),port:q('oscPort').valueAsNumber,rules:mappings},revision:routeRevision});workspace=result.workspace;workspaceRevision=routeRevision=result.revision;renderTargets();status(result.osc);toast('OSC 설정을 저장했습니다.');
    }catch(error){toast(error.message,true);}finally{busy=false;}
  };
  q('oscStop').onclick=async()=>{
    if(busy)return;busy=true;
    try{const latest=await api('osc-routing'),result=await api('osc-routing',{config:{...(latest.workspace.osc || {host:'0.0.0.0',port:9000,rules:[]}),enabled:false},revision:latest.revision});workspace=result.workspace;workspaceRevision=routeRevision=result.revision;q('oscEnabled').checked=false;status(result.osc);}
    catch(error){toast(error.message,true);}finally{busy=false;}
  };
  setInterval(async()=>{if(q('paneOsc').hidden || busy)return;try{const result=await api('osc-routing');status(result.osc);}catch(error){q('oscStatusRouting').textContent=error.message;}},1000);

});
