import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './src/index.js';
import {hardwareProjects,SHEET_KEY} from './src/hardware.js';
function storage(){const values=new Map();let seq=0;return {values,async get(key){const v=values.get(key);return v?{etag:v.etag,text:async()=>v.raw,json:async()=>JSON.parse(v.raw)}:null;},async put(key,raw,options={}){const v=values.get(key),c=options.onlyIf;if(c?.etagDoesNotMatch==='*'&&v||c?.etagMatches&&c.etagMatches!==v?.etag)return null;const next={raw,etag:String(++seq),customMetadata:options.customMetadata};values.set(key,next);return next;},async list({prefix}){return {objects:[...values].filter(([key])=>key.startsWith(prefix)).map(([key,v])=>({key,customMetadata:v.customMetadata})),truncated:false};}};}
const site='https://dashboard.3dowon.com';
const request=(path,body,cookie)=>new Request('https://api.3dowon.com'+path,{method:body?'POST':'GET',headers:{origin:site,...(cookie?{cookie}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const empty={items:[],people:[],quantities:{}};
async function ownerCookie(env){const key=crypto.getRandomValues(new Uint8Array(32));env.SESSION_KEY=Buffer.from(key).toString('base64url');const iv=crypto.getRandomValues(new Uint8Array(12));const aes=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']);const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},aes,new TextEncoder().encode(JSON.stringify({login:'threedowon',expires:Date.now()+60000})));return '__Host-dowon_session='+Buffer.from(iv).toString('base64url')+'.'+Buffer.from(encrypted).toString('base64url');}
test('only owner can list/create; project links edit isolated sheets without revealing other names',async()=>{
 const bucket=storage(),env={TRANSFERS:bucket,DASHBOARD_ORIGIN:site};await bucket.put(SHEET_KEY,JSON.stringify({data:empty,version:7}));
 for(const body of [undefined,{name:'private'}])assert.equal((await worker.fetch(request('/api/hardware-projects',body),env)).status,401);
 const cookie=await ownerCookie(env);
 const created=[];
 for(const name of ['전시 A','워크숍 B']){const response=await worker.fetch(request('/api/hardware-projects',{name},cookie),env);assert.equal(response.status,201);created.push(await response.json());}
 assert.notEqual(created[0].id,created[1].id);
 const list=await(await worker.fetch(request('/api/hardware-projects',undefined,cookie),env)).json();assert.deepEqual(list.projects.map(p=>p.name),['기존 신청표','전시 A','워크숍 B']);
 const path='/api/hardware-sheet/'+created[0].id;
 const first=await(await worker.fetch(request(path),env)).json();assert.equal(first.name,'전시 A');assert.deepEqual(first.data,empty);assert.equal(JSON.stringify(first).includes('워크숍 B'),false);
 const data={...empty,people:[{id:'team',name:'팀원'}]};
 assert.equal((await worker.fetch(request(path,{data,version:0,name:'injected'}),env)).status,200);
 assert.equal((await worker.fetch(request(path,{data:empty,version:0}),env)).status,409);
 const saved=await(await worker.fetch(request(path),env)).json();assert.equal(saved.name,'전시 A');assert.deepEqual(saved.data,data);
 assert.deepEqual((await(await worker.fetch(request('/api/hardware-sheet/'+created[1].id),env)).json()).data,empty);
 assert.equal((await(await worker.fetch(request('/api/hardware-sheet'),env)).json()).version,7);
 const after=await(await worker.fetch(request('/api/hardware-projects',undefined,cookie),env)).json();assert.equal(after.projects[1].name,'전시 A');
});
test('bad, absent and guessed project links never fall back to legacy or create data',async()=>{
 const bucket=storage(),env={TRANSFERS:bucket,DASHBOARD_ORIGIN:site};
 for(const token of ['invalid','',crypto.randomUUID(),'..%2Fsheet.json'])for(const body of [undefined,{data:empty,version:0}])assert.equal((await worker.fetch(request('/api/hardware-sheet/'+token,body),env)).status,404);
 assert.equal(bucket.values.size,0);
 for(const name of ['', ' ', 'x'.repeat(81),null])assert.equal((await hardwareProjects(request('/api/hardware-projects',{name}),env,{})).status,400);
});
