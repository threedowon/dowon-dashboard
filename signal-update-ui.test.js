import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./signal-tester/signal_tester_ui/updates.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(){
 const nodes=new Map(),calls=[],intervals=[];
 const $=id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);};
 let state={enabled:true,current:'1.2.0',latest:'1.3.0',phase:'available',result:{}},accept=false;
 const context=vm.createContext({$,setInterval:fn=>intervals.push(fn),safe:fn=>fn,toast(){},saving:false,sending:false,ioBusy:false,
  confirmAction:async()=>accept,api:async(route,body)=>{calls.push({route,body});return state;}});
 vm.runInContext(source,context);
 return {$,calls,intervals,context,set accept(v){accept=v;},set state(v){state=v;}};
}
test('updates require an explicit confirmation and send only the displayed version',async()=>{
 const h=harness();await tick();assert.equal(h.$('updateInstall').hidden,false);
 await h.$('updateInstall').onclick();assert.equal(h.calls.some(c=>c.route==='update/install'),false);
 h.accept=true;await h.$('updateInstall').onclick();
 const call=h.calls.find(c=>c.route==='update/install');assert.deepEqual(JSON.parse(JSON.stringify(call.body)),{version:'1.3.0'});
 h.context.saving=true;await h.$('updateInstall').onclick();assert.equal(h.calls.filter(c=>c.route==='update/install').length,1);
});
test('download progress disables repeated updates, errors leave a retry control',async()=>{
 const h=harness();await tick();
 h.state={enabled:true,current:'1.2.0',latest:'1.3.0',phase:'downloading',progress:42};await h.intervals[0]();
 assert.match(h.$('updateStatus').textContent,/42%/);assert.equal(h.$('updateInstall').disabled,true);
 h.state={enabled:true,current:'1.2.0',latest:'1.3.0',phase:'error',error:'Download failed'};await h.intervals[0]();
 assert.match(h.$('updateStatus').textContent,/Download failed/);assert.equal(h.$('updateCheck').disabled,false);
});
