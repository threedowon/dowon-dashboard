import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./signal-tester/signal_tester_ui/desktop.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function harness({webDev=false,restartError=null,nextToken='b'.repeat(43)}={}){
 const nodes=new Map(),calls=[],intervals=[];
 function node(){return {value:'',dataset:{},children:[],append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},showModal(){this.open=true;},close(){this.open=false;}};}
 const $=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 let status={connected:true,name:'Original PC',device:'a'.repeat(32),dirty:true},accepted=true,reloaded=false;
 const context=vm.createContext({$,document:{activeElement:null},Date,setInterval:fn=>intervals.push(fn),
  workspace:{targets:[]},workspaceRevision:'original',selectedId:'old',keyboardEnabled:true,saving:false,sending:false,ioBusy:false,
  token:'a'.repeat(43),AbortSignal,setTimeout:fn=>fn(),location:{reload(){reloaded=true;}},
  fetch:async()=>({ok:true,text:async()=>`<meta name="tester-token" content="${nextToken}">`}),
  healthChecks:new Map(),applyRuntime(){},render(){},lockWorkspace:()=>false,toast(){},safe:fn=>fn,
  confirmAction:async()=>accepted,el:()=>node(),button:(cls,text,handler)=>({...node(),text,onclick:handler}),
  api:async(route,body)=>{calls.push({route,body});if(route==='web/restart'&&restartError)throw Error(restartError);if(route==='cloud/status')return {desktop:true,webDev,webRestart:webDev,cloud:status};if(route==='cloud/connect')return {...status,name:body.name};if(route==='cloud/backups')return {backups:[{id:'b'.repeat(32),name:'Another PC'}]};if(route==='cloud/restore')return {workspace:{targets:[{id:'restored'}]},revision:'new',recovery:'local-recovery.json'};return status;}
 });vm.runInContext(source,context);
 return {$,calls,context,intervals,get reloaded(){return reloaded;},set accepted(value){accepted=value;},set status(value){status=value;}};
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

test('web restart is hidden in EXE mode and cancellation does not restart',async()=>{
 const exe=harness();await tick();assert.equal(exe.$('webRestart').hidden,true);
 const h=harness({webDev:true});await tick();assert.equal(h.$('webRestart').hidden,false);
 h.accepted=false;await h.$('webRestart').onclick();assert.equal(h.calls.some(c=>c.route==='web/restart'),false);
});
test('web restart reloads only after a new server token appears and prevents duplicate clicks',async()=>{
 const h=harness({webDev:true});await tick();await h.$('webRestart').onclick();
 assert.equal(h.reloaded,true);assert.equal(h.$('webRestart').disabled,true);
 await h.$('webRestart').onclick();assert.equal(h.calls.filter(c=>c.route==='web/restart').length,1);
});
test('web restart shows recovery instructions if no new engine appears and surfaces request failures',async()=>{
 const h=harness({webDev:true,nextToken:'a'.repeat(43)});await tick();await h.$('webRestart').onclick();
 assert.equal(h.reloaded,false);assert.match(h.$('webRestartStatus').textContent,/Start-Web-Tester.cmd/);
 const failed=harness({webDev:true,restartError:'Restart unavailable'});await tick();await failed.$('webRestart').onclick();
 assert.equal(failed.reloaded,false);assert.equal(failed.$('webRestart').disabled,false);
 assert.equal(failed.$('webRestartStatus').textContent,'Restart unavailable');
});
