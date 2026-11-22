import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './src/index.js';
import {hardware,SHEET_KEY,ORIGINAL_KEY,validSheet} from './src/hardware.js';
import {cleanupTransfers} from './src/transfers.js';

function storage() {
  const objects=new Map(); let seq=0;
  return {objects, async get(key) {
    const value=objects.get(key); if(!value)return null;
    return {etag:value.etag,text:async()=>value.raw,json:async()=>JSON.parse(value.raw)};
  }, async put(key,raw,options={}) {
    const current=objects.get(key), c=options.onlyIf;
    if(c?.etagDoesNotMatch==='*'&&current || c?.etagMatches&&c.etagMatches!==current?.etag)return null;
    const value={raw,etag:String(++seq)};objects.set(key,value);return value;
  }, async list({prefix}) {return {objects:[...objects.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false};},
  async delete(keys){for(const key of [keys].flat())objects.delete(key);}};
}
const data={items:[{id:'item',name:'커넥터',detail:'2핀',price:0,image:'',link:'https://www.coupang.com/',group:'전선·커넥터',usage:'공용'}],people:[{id:'person',name:'팀원'}],quantities:{'person:item':3}};
const request=(body)=>new Request('https://api.3dowon.com/api/hardware-sheet',body?{method:'POST',headers:{origin:'https://dashboard.3dowon.com'},body:JSON.stringify(body)}:{});

test('migration preserves all workbook data and original version, then never reads legacy again',async()=>{
  const bucket=storage(),env={TRANSFERS:bucket};let reads=0;
  const original=globalThis.fetch;globalThis.fetch=async()=>{reads++;return Response.json({data,version:8});};
  try{
    assert.deepEqual(await(await hardware(request(),env,{})).json(),{data,version:8});
    assert.deepEqual(JSON.parse(bucket.objects.get(ORIGINAL_KEY).raw),{data,version:8});
    const changed={...data,quantities:{'person:item':4}};
    assert.equal((await hardware(request({data:changed,version:8}),env,{})).status,200);
    assert.deepEqual(await(await hardware(request(),env,{})).json(),{data:changed,version:9});
    assert.equal(reads,1);
    await cleanupTransfers(env);
    assert.ok(bucket.objects.has(SHEET_KEY));assert.ok(bucket.objects.has(ORIGINAL_KEY));
  }finally{globalThis.fetch=original;}
});
test('concurrent saves accept exactly one edit and preserve the winning quantities',async()=>{
  const bucket=storage();await bucket.put(SHEET_KEY,JSON.stringify({data,version:8}));
  const env={TRANSFERS:bucket},a={...data,quantities:{'person:item':5}},b={...data,quantities:{'person:item':6}};
  const responses=await Promise.all([hardware(request({data:a,version:8}),env,{}),hardware(request({data:b,version:8}),env,{})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  assert.equal(JSON.parse(bucket.objects.get(SHEET_KEY).raw).version,9);
  assert.equal((await hardware(request({data,version:8}),env,{})).status,409);
});
test('invalid or unavailable migration never creates an empty sheet',async()=>{
  const original=globalThis.fetch;
  try{
    for(const upstream of [new Response('',{status:503}),Response.json({data:null,version:0})]){
      const bucket=storage();globalThis.fetch=async()=>upstream;
      assert.equal((await hardware(request(),{TRANSFERS:bucket},{})).status,503);
      assert.equal(bucket.objects.size,0);
    }
  }finally{globalThis.fetch=original;}
});
test('team workbook is public but writes require dashboard origin and private APIs remain protected',async()=>{
  const bucket=storage();await bucket.put(SHEET_KEY,JSON.stringify({data,version:8}));
  const env={TRANSFERS:bucket,DASHBOARD_ORIGIN:'https://dashboard.3dowon.com'};
  assert.equal((await worker.fetch(request(),env)).status,200);
  assert.equal((await worker.fetch(request({data,version:8}),env)).status,200);
  const evil=new Request('https://api.3dowon.com/api/hardware-sheet',{method:'POST',headers:{origin:'https://evil.example'},body:JSON.stringify({data,version:9})});
  assert.equal((await worker.fetch(evil,env)).status,403);
  assert.equal((await worker.fetch(new Request('https://api.3dowon.com/api/backup',{headers:{origin:env.DASHBOARD_ORIGIN}}),env)).status,401);
});
test('invalid links, categories and quantities are rejected',()=>{
  assert.ok(validSheet(data));
  assert.equal(validSheet({...data,items:[{...data.items[0],link:'javascript:alert(1)'}]}),false);
  assert.equal(validSheet({...data,items:[{...data.items[0],group:'unknown'}]}),false);
  assert.equal(validSheet({...data,quantities:{'person:item':-1}}),false);
  assert.equal(validSheet({...data,quantities:{'unknown:item':1}}),false);
});
test('optional bundle sizes survive saving and reloading, and can be removed',async()=>{
 const bucket=storage(),env={TRANSFERS:bucket};await bucket.put(SHEET_KEY,JSON.stringify({data,version:8}));
 const bundled={...data,items:[{...data.items[0],packSize:3}]};
 assert.equal((await hardware(request({data:bundled,version:8}),env,{})).status,200);
 assert.deepEqual(await(await hardware(request(),env,{})).json(),{data:bundled,version:9});
 for(const packSize of [null,0,1,-3,2.5,'3',true,10001]){
  const invalid={...data,items:[{...data.items[0],packSize}]};
  assert.equal(validSheet(invalid),false);
  assert.equal((await hardware(request({data:invalid,version:9}),env,{})).status,400);
 }
 assert.equal((await hardware(request({data,version:9}),env,{})).status,200);
 assert.deepEqual(await(await hardware(request(),env,{})).json(),{data,version:10});
 assert.ok(validSheet({...data,items:[{...data.items[0],packSize:10000}]}));
});
