import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../assets/transfers.js',import.meta.url),'utf8');
test('failed multipart uploads resume only missing parts and complete in numeric order',async()=>{
 const elements=new Map(),sent=[],completed=[];let fail=true,starts=0;
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'10',classList:{toggle(){}},addEventListener(name,fn){this[name]=fn;}});return elements.get(id);};
 const ctx={document:{documentElement:{dataset:{}},getElementById:el},window:{addEventListener(){}},location:{hostname:'dashboard.3dowon.com',hash:'#transfers'},sessionStorage:{getItem:()=>null},FormData,AbortSignal,setInterval(){},setTimeout(fn){fn();},fetch:async(url,options)=>{
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
