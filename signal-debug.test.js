import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
vm.runInContext(fs.readFileSync('signal-tester/signal_tester_ui/debug.js','utf8'),context);
const model=context.SignalDebug;
test('Player cooldown acknowledgement is distinct from a request blocked inside Tester',()=>{
  const ack={protocol:'http',received:true,status:'cooldown'};
  assert.equal(model.outcome(ack).kind,'acknowledged');
  assert.equal(model.outcome(ack).detail,'Player 쿨다운');
  assert.equal(model.outcome({...ack,received:false,stage:'cooldown'}).kind,'blocked');
  assert.equal(model.outcome({protocol:'http',received:false,status:'timeout'}).kind,'unconfirmed');
  assert.equal(model.outcome({protocol:'udp',direction:'TX',ok:true}).kind,'other');
});
test('person and person_far quick filters match exact HTTP keys while RX search remains available',()=>{
  const events=[{protocol:'http',key:'person',received:true,status:'ignored'},
    {protocol:'http',key:'person_far',received:true,status:'transitioned'},
    {protocol:'serial',direction:'RX',packet:{text:'{"detected":1}'},target:{name:'FSR'}}];
  assert.equal(model.filter(events,{key:'person'}).length,1);
  assert.equal(model.filter(events,{key:'person_far'})[0].key,'person_far');
  assert.equal(model.filter(events,{kind:'received',search:'FSR'})[0].protocol,'serial');
  assert.equal(model.filter(events,{search:'detected'}).length,1);
});
test('native debugger opens without a browser and source mode uses a dedicated local window',async()=>{
  const source=fs.readFileSync('signal-tester/signal_tester_ui/debug-open.js','utf8');
  for(const native of [false,true]){
    const button={},calls=[];
    const window={open:(...args)=>{calls.push(args);return {};}};
    if(native)window.pywebview={api:{open_debug:async()=>{calls.push('native');return true;}}};
    vm.runInNewContext(source,{document:{getElementById:()=>button},window,URL,location:{href:'http://127.0.0.1:1234/'},token:'valid',safe:fn=>fn,toast(){}});
    await button.onclick();
    assert.equal(calls.length,1);assert.equal(native?calls[0]:calls[0][0],native?'native':'http://127.0.0.1:1234/debug.html');
  }
});
