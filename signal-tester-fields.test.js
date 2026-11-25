import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const fields = readFileSync(new URL('./signal-tester/signal_tester_ui/fields.js',import.meta.url),'utf8');
const sensors = readFileSync(new URL('./signal-tester/signal_tester_ui/sensors.js',import.meta.url),'utf8');
class Element {
  constructor(tag='',cls='',text=''){this.tag=tag;this.className=cls;this.textContent=text;this.children=[];this.dataset={};this.hidden=false;this.classList={toggle(){}};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(){this.children=[];}
  setAttribute(){}
  querySelector(selector){return this.children.find(n=>n.className===selector.slice(1));}
}
function fixture(){
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const requests=[];
  const workspace={activeTarget:'mm',targets:[{id:'mm',name:'mmWave',type:'udp'},{id:'fsr',name:'FSR',type:'serial'}],sensors:[
    {id:'saved',name:'Saved Distance',sourceId:'mm',parser:'json',field:'distance',unit:'m',staleSeconds:3,rules:[{threshold:2.5}]},
    {id:'duplicate',name:'Second condition',sourceId:'mm',parser:'json',field:'distance',unit:'m',staleSeconds:3,rules:[{threshold:5}]},
    {id:'manual',name:'Legacy number',sourceId:'mm',parser:'number',field:'',unit:'ADC',rules:[]},
    {id:'pressure',name:'Pressure',sourceId:'fsr',parser:'json',field:'pressure',unit:'ADC',rules:[]}
  ]};
  const row=(path,value)=>({key:JSON.stringify(path),path,value,type:typeof value,numeric:typeof value==='number',time:1000,present:true,live:true,ageSeconds:0});
  const connections={mm:{status:'open',fields:{messages:1,items:[row(['distance'],1.84),row(['speed'],.2),row(['ready'],true)]}},
    fsr:{status:'open',fields:{messages:1,items:[row(['pressure'],512)]}}};
  const context=vm.createContext({workspace,connectionStates:connections,engineOffline:false,document:{querySelector:get},$:get,
    active:()=>workspace.targets.find(t=>t.id===workspace.activeTarget),kind:t=>t?.type||'http',el:(...args)=>new Element(...args),
    button:(cls,text,click)=>Object.assign(new Element('button',cls,text),{click}),lockWorkspace:()=>false,
    stamp:t=>String(t),renderSensors(){},renderGauge(){},drawSensorGraph(){},
    api:path=>new Promise(resolve=>requests.push({path,resolve}))});
  vm.runInContext(`let sensorSelected=null,sensorPaused=false,frozenSensor=null;
    ${fields}
    ${sensors.slice(sensors.indexOf('function selectedMonitor()'),sensors.indexOf('function sensorRuntimeUpdate('))}
    globalThis.client={render:renderJSONFields,choose:selectJSONField,monitor:selectJSONMonitor,
      state:()=>({selection:fieldSelection,selected:sensorSelected,config:selectedMonitor(),rows:fieldRows,auto:autoSensorState,graph:jsonFieldGraphAvailable()})};`,context);
  return {client:context.client,workspace,connections,nodes,get,requests};
}

test('only selected connection fields and saved units/rules appear; browsing never changes settings',()=>{
  const f=fixture(),before=JSON.stringify(f.workspace);
  f.client.render();
  assert.deepEqual(Array.from(f.client.state().rows,r=>r.path.join('.')),['distance','speed','ready']);
  assert.equal(f.client.state().config.unit,'m');
  assert.equal(f.client.state().config.rules[0].threshold,2.5);
  f.client.choose('["speed"]');
  assert.equal(f.client.state().config.field,'speed');
  assert.equal(JSON.stringify(f.workspace),before);
  f.workspace.activeTarget='fsr';f.client.render();
  assert.deepEqual(Array.from(f.client.state().rows,r=>r.path.join('.')),['pressure']);
  f.workspace.activeTarget='mm';f.client.render();
  assert.equal(f.client.state().config.field,'speed');
});

test('duplicate saved monitors and manual numeric monitors stay selectable without overwriting config',()=>{
  const f=fixture();f.client.render();const before=JSON.stringify(f.workspace);
  f.client.monitor('duplicate');f.client.render();
  assert.equal(f.client.state().config.rules[0].threshold,5);
  f.client.monitor('manual');f.client.render();
  assert.equal(f.client.state().config.id,'manual');
  assert.equal(JSON.stringify(f.workspace),before);
});

test('boolean values show raw detail; saved settings remain editable after a numeric field changes type',()=>{
  const f=fixture();f.client.render();f.client.choose('["ready"]');
  assert.equal(f.client.state().graph,false);
  assert.equal(f.get('jsonTextValue').textContent,'true');
  Object.assign(f.connections.mm.fields.items[0],{value:'invalid',type:'string',numeric:false});
  f.client.choose('["distance"]');
  assert.equal(f.client.state().graph,false);
  assert.equal(f.client.state().config.id,'saved');
  assert.equal(f.client.state().config.rules[0].threshold,2.5);
});

test('late graph responses cannot leak into a different connection or field',async()=>{
  const f=fixture();f.client.render();f.client.choose('["speed"]');
  const old=f.requests.at(-1);
  f.workspace.activeTarget='fsr';f.client.render();
  old.resolve({points:[[1000,99]]});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.client.state().config.id,'pressure');
  assert.equal(f.client.state().auto,null);
  f.workspace.activeTarget='mm';f.client.render();
  f.requests.at(-1).resolve({points:[[1000,.2]]});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.client.state().auto.points[0][1],.2);
});
