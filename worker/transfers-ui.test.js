import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../assets/transfers.js',import.meta.url),'utf8');
test('failed multipart uploads resume only missing parts and complete in numeric order',async()=>{
 const elements=new Map(),sent=[],completed=[];let fail=true,starts=0;
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'10',classList:{toggle(){}},addEventListener(name,fn){this[name]=fn;}});return elements.get(id);};
 const ctx={document:{documentElement:{dataset:{}},getElementById:el},window:{addEventListener(){}},location:{hostname:'dashboard.3dowon.com',hash:'#transfers'},sessionStorage:{getItem:()=>null},FormData,AbortSignal,AbortController,setInterval(){},setTimeout(fn){fn();},fetch:async(url,options)=>{
   if(options.method!=='POST')return Response.json({documents:[]});
   if(url.endsWith('/uploads')){starts++;return Response.json({id:'test',partSize:8});}
   if(url.includes('/part?')){const n=Number(new URL(url).searchParams.get('number'));sent.push(n);if(n===2&&fail)throw Error('network interrupted');return Response.json({partNumber:n,etag:'p'+n});}
   const body=JSON.parse(options.body);completed.push(body.parts);return Response.json({document:{id:'test',filename:'large.bin',size:40,expiresAt:Date.now()+600000}});
 }};
 vm.runInNewContext(source,ctx);
 const settle=async()=>{for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));};await settle();
 const file={name:'large.bin',size:40,slice:()=>new Blob(['chunk'])};
 el('transferFiles').files=[file];el('transferFiles').onchange();await settle();
 assert.equal(el('transferRetry').hidden,false);assert.equal(completed.length,0);
 const prior=sent.filter(n=>n!==2);fail=false;await el('transferRetry').onclick();
 assert.equal(starts,1);assert.deepEqual(sent.filter(n=>n!==2),prior);assert.deepEqual(completed[0].map(p=>p.partNumber),[1,2,3,4,5]);assert.equal(el('transferRetry').hidden,true);
});

const settle=async()=>{for(let i=0;i<30;i++)await new Promise(r=>setImmediate(r));};
function preview(fetch,clock={now:Date.now()}){
 const elements=new Map(),timers=[];
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'10',classList:{toggle(){}},addEventListener(name,fn){this[name]=fn;},querySelectorAll(){return [];}});return elements.get(id);};
 class TestDate extends Date{static now(){return clock.now;}}
 vm.runInNewContext(source,{document:{documentElement:{dataset:{}},getElementById:el},window:{addEventListener(){}},location:{hostname:'dashboard.3dowon.com',hash:'#transfers'},sessionStorage:{getItem:()=>null},Date:TestDate,FormData,AbortSignal,AbortController,setInterval(fn){timers.push(fn);},setTimeout(fn){fn();},fetch});
 return {el,timers,clock};
}

test('countdown handles numeric and ISO expiry, ticks without replacing rows, and blocks expired downloads',async()=>{
 const clock={now:1700000000000};let calls=0;
 const {el,timers}=preview(async()=>{calls++;return Response.json({documents:[{id:'one',filename:'<script>.pdf',size:1024,expiresAt:clock.now+1000},{id:'two',filename:'Layout.png',size:3*1024**3,expiresAt:new Date(clock.now+600000).toISOString()}]});},clock);
 await settle();const html=el('transferList').innerHTML;
 assert.match(html,/<th scope="col">Status<\/th>/);assert.match(html,/Expires in 00:01/);assert.match(html,/Expires in 10:00/);assert.match(html,/3.00 GB/);assert.match(html,/&lt;script&gt;.pdf/);
 const download={disabled:false},ready={textContent:'Ready to download'},label={dataset:{expires:String(clock.now+1000)},textContent:'Expires in 00:01',closest:()=>({querySelector:selector=>selector==='[data-download]'?download:ready})};
 el('transferList').querySelectorAll=()=>[label];clock.now+=1000;timers[0]();
 assert.equal(label.textContent,'Expired');assert.equal(download.disabled,true);assert.equal(ready.textContent,'File expired');assert.equal(el('transferList').innerHTML,html);
 await el('transferList').onclick({target:{closest:()=>({dataset:{download:'one'}})}});
 assert.equal(calls,1);assert.equal(el('transferStatus').textContent,'This file has expired.');
});

test('cancel aborts active parts and server upload, skips queued files, and never completes or retries them',async()=>{
 let starts=0,aborts=0,completes=0,partRequests=0;
 const {el}=preview(async(url,options)=>{
  if(options.method!=='POST')return Response.json({documents:[]});
  if(url.endsWith('/uploads')){starts++;return Response.json({id:'cancel-session',partSize:8});}
  if(url.includes('/part?')){partRequests++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}
  if(url.endsWith('/abort')){aborts++;return Response.json({ok:true});}
  if(url.endsWith('/complete')){completes++;return Response.json({});}
 });
 await settle();const file={name:'test.zip',size:40,slice:()=>new Blob(['part'])};el('transferFiles').files=[file,{...file,name:'queued.zip'}];el('transferFiles').onchange();await settle();
 assert.match(el('transferList').innerHTML,/Uploading 0%/);assert.match(el('transferList').innerHTML,/<progress/);assert.equal(partRequests,4);
 await el('transferList').onclick({target:{closest:()=>({dataset:{cancel:'1'}})}});
 await el('transferList').onclick({target:{closest:()=>({dataset:{cancel:'0'}})}});await settle();
 assert.equal(starts,1);assert.equal(aborts,1);assert.equal(completes,0);assert.equal(el('transferRetry').hidden,true);assert.match(el('transferList').innerHTML,/Cancelled/);assert.equal(el('transferUpload').disabled,false);
});

test('oversize files show a per-file failure without starting a request',async()=>{
 let posts=0;const {el}=preview(async(url,options)=>{if(options.method==='POST')posts++;return Response.json({documents:[]});});
 await settle();el('transferFiles').files=[{name:'too-big.zip',size:5*1024**3+1}];el('transferFiles').onchange();await settle();
 assert.equal(posts,0);assert.match(el('transferList').innerHTML,/Upload failed/);assert.match(el('transferList').innerHTML,/5GB/);assert.equal(el('transferRetry').hidden,false);
});
