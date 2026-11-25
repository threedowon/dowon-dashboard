import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('hosted UI pairs only with its own local popup and never puts credentials in URLs',()=>{
  const handlers={},buttons=[],saved=[],popup={},status={append(...items){buttons.push(...items);}};
  let reloads=0;
  const ctx={location:{origin:'https://dashboard.3dowon.com',reload(){reloads++;}},
    window:{addEventListener:(name,fn)=>handlers[name]=fn,open:()=>popup},
    document:{addEventListener:(name,fn)=>handlers[name]=fn,getElementById:()=>status,createElement:()=>({})},
    sessionStorage:{setItem:(key,value)=>saved.push(JSON.parse(value))}};
  vm.runInNewContext(readFileSync('signal-tester/signal_tester_ui/bridge.js','utf8'),ctx);
  handlers.DOMContentLoaded();buttons[0].onclick();
  const data={type:'signal-tester-pair',base:'http://127.0.0.1:6699',token:'a'.repeat(43)};
  handlers.message({source:{},origin:data.base,data});
  handlers.message({source:popup,origin:'https://evil.example',data});
  handlers.message({source:popup,origin:data.base,data:{...data,token:'bad'}});
  assert.equal(saved.length,0);
  handlers.message({source:popup,origin:data.base,data});
  assert.equal(saved.length,1);assert.equal(saved[0].token,data.token);assert.equal(reloads,1);
});

test('local approval page sends credentials only after approval and only to the dashboard',()=>{
  const button={},calls=[];
  vm.runInNewContext(readFileSync('signal-tester/signal_tester_ui/pair.js','utf8'),{
    document:{getElementById:()=>button,querySelector:()=>({content:'test-token'})},location:{origin:'http://127.0.0.1:6699'},
    window:{opener:{postMessage:(data,origin)=>calls.push({data,origin})},close(){}}});
  assert.equal(calls.length,0);button.onclick();
  assert.equal(calls.length,1);assert.equal(calls[0].origin,'https://dashboard.3dowon.com');
});
