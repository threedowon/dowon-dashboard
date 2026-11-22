import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./signal-tester/signal_tester_ui/desktop.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function harness(){
 const nodes=new Map(),calls=[],intervals=[];
 function node(){return {value:'',dataset:{},children:[],append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},showModal(){this.open=true;},close(){this.open=false;}};}
 const $=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 let status={connected:true,name:'Original PC',device:'a'.repeat(32),dirty:true},accepted=true;
 const context=vm.createContext({$,document:{activeElement:null},Date,setInterval:fn=>intervals.push(fn),
  workspace:{targets:[]},workspaceRevision:'original',selectedId:'old',keyboardEnabled:true,saving:false,sending:false,ioBusy:false,
  healthChecks:new Map(),applyRuntime(){},render(){},lockWorkspace:()=>false,toast(){},safe:fn=>fn,
  confirmAction:async()=>accepted,el:()=>node(),button:(cls,text,handler)=>({...node(),text,onclick:handler}),
  api:async(route,body)=>{calls.push({route,body});if(route==='cloud/status')return {desktop:true,cloud:status};if(route==='cloud/connect')return {...status,name:body.name};if(route==='cloud/backups')return {backups:[{id:'b'.repeat(32),name:'Another PC'}]};if(route==='cloud/restore')return {workspace:{targets:[{id:'restored'}]},revision:'new',recovery:'local-recovery.json'};return status;}
 });vm.runInContext(source,context);
 return {$,calls,context,intervals,set accepted(value){accepted=value;},set status(value){status=value;}};
}
test('backup connect preserves a typed PC name across polling and button focus',async()=>{
 const h=harness();await tick();h.$('cloudName').value='현장 PC';h.$('cloudName').oninput();await h.intervals[0]();
 assert.equal(h.$('cloudName').value,'현장 PC');h.$('cloudConnect').onclick();await tick();
 assert.equal(h.calls.find(c=>c.route==='cloud/connect').body.name,'현장 PC');
});
test('restoring a backup requires confirmation and sends the current local revision',async()=>{
 const h=harness();await tick();await h.$('cloudList').onclick();
 const restore=h.$('cloudBackups').children[0].children[1];h.accepted=false;await restore.onclick();
 assert.equal(h.calls.some(c=>c.route==='cloud/restore'),false);
 h.accepted=true;await restore.onclick();const request=h.calls.find(c=>c.route==='cloud/restore');
 assert.equal(request.body.revision,'original');assert.equal(request.body.id,'b'.repeat(32));
 assert.equal(h.context.workspaceRevision,'new');assert.equal(h.context.keyboardEnabled,false);
 assert.match(h.$('cloudRestoreNote').textContent,/local-recovery/);
});
