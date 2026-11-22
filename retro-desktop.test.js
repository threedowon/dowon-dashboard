import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./assets/retro-desktop.js',import.meta.url),'utf8');
function app({status=200,readonly=false,hostname='dashboard.3dowon.com',fetcher,syncMessage='Saved to GitHub'}={}){
 const elements=new Map(),requests=[];let syncs=0;
 function el(id){if(!elements.has(id))elements.set(id,{hidden:false,value:'',title:'',textContent:'',attributes:{},events:{},classList:{toggle(){},contains(){return false;}},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,fn){(this.events[k]??=[]).push(fn);},focus(){},contains(){return false;}});return elements.get(id);}
 el('cloudSave').onclick=async()=>{syncs++;el('cloudStatus').title=syncMessage;};
 const context={document:{documentElement:{dataset:{readonly:String(readonly)}},getElementById:el,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},location:{hostname,hash:'#home',href:'https://dashboard.3dowon.com/'},setInterval(){},AbortSignal,TypeError,fetch:async(...args)=>{requests.push(args);return fetcher?fetcher(...args):{status,ok:status===200};}};
 vm.runInNewContext(source,context);
 return {el,requests,context,get syncs(){return syncs;},activate:()=>el('retroComputer').events.dblclick[0](),click:detail=>el('retroComputer').events.click[0]({detail})};
}
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
test('My Computer double click syncs through the existing workspace handler and displays its status',async()=>{
 const a=app();await a.activate();assert.equal(a.syncs,1);assert.equal(a.requests[0][0],'https://api.3dowon.com/api/me');assert.equal(a.requests[0][1].credentials,'include');assert.equal(a.el('retroHomeStatus').textContent,'Saved to GitHub');assert.equal(a.el('retroComputer').disabled,false);assert.equal(a.el('retroComputer').attributes['aria-busy'],'false');
});
test('expired sessions go to GitHub login without attempting sync',async()=>{
 const a=app({status:401});await a.activate();assert.equal(a.syncs,0);assert.equal(a.context.location.href,'https://api.3dowon.com/auth/login');
});
test('single clicks do not sync; keyboard activation does; repeated double clicks coalesce',async()=>{
 const a=app();a.click(1);a.click(2);await settle();assert.equal(a.requests.length,0);a.click(0);await settle();assert.equal(a.syncs,1);
 let resolve;const b=app({fetcher:()=>new Promise(r=>resolve=r)});const first=b.activate();await b.activate();assert.equal(b.requests.length,1);resolve({status:200,ok:true});await first;assert.equal(b.syncs,1);
});
test('connection failures never redirect to login and conflict messages remain visible',async()=>{
 for(const config of [{status:403},{status:500},{fetcher:()=>{throw new TypeError('Failed to fetch');}}]){const a=app(config);await a.activate();assert.equal(a.syncs,0);assert.equal(a.context.location.href,'https://dashboard.3dowon.com/');assert.equal(a.el('retroComputer').disabled,false);assert.match(a.el('retroHomeStatus').textContent,/Could not/);}
 const conflict=app({syncMessage:'Changes conflict. Local edits are preserved.'});await conflict.activate();assert.match(conflict.el('retroHomeStatus').textContent,/Local edits are preserved/);
});
test('shared snapshots and local previews never contact GitHub',async()=>{
 for(const config of [{readonly:true},{hostname:'localhost'},{hostname:'127.0.0.1'}]){const a=app(config);await a.activate();assert.equal(a.requests.length,0);assert.equal(a.syncs,0);}
});
