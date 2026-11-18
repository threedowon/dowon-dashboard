import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transfers,cleanupTransfers} from './src/transfers.js';
import worker from './src/index.js';

function storage(){
  const objects=new Map();
  return {objects,async put(key,stream,options){const bytes=await new Response(stream).arrayBuffer();objects.set(key,{key,size:bytes.byteLength,...options,bytes});},async list({cursor}){const all=[...objects.values()],start=Number(cursor||0);return {objects:all.slice(start,start+1),truncated:start+1<all.length,cursor:String(start+1)};},async get(key){const o=objects.get(key);return o?{...o,body:new Blob([o.bytes]).stream()}:null;},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key);}};
}
const request=(path='',options={})=>new Request('https://api.3dowon.com/api/transfers'+path,options);
test('temporary storage preserves arbitrary bytes, supports pagination and deletion, never calls GitHub',async()=>{
  const bucket=storage(),env={TRANSFERS:bucket};
  const form=new FormData();form.set('file',new Blob([new Uint8Array([0,255,17])]),'한글 자료.bin');form.set('minutes','1');
  const response=await transfers(request('',{method:'POST',body:form}),env,{});
  assert.equal(response.status,201);const {document}=await response.json();assert.equal(document.expiresAt-document.createdAt,60000);
  const result=await transfers(request('/'+document.id+'/file'),env,{});
  assert.deepEqual([...new Uint8Array(await result.arrayBuffer())],[0,255,17]);
  assert.equal(result.headers.get('cache-control'),'no-store');assert.match(result.headers.get('content-disposition'),/attachment/);
  bucket.objects.set('transfers/another',{...bucket.objects.values().next().value,key:'transfers/another'});
  assert.equal((await(await transfers(request(),env,{})).json()).documents.length,2);
  await transfers(request('/'+document.id+'/delete',{method:'POST'}),env,{});
  assert.equal((await transfers(request('/'+document.id+'/file'),env,{})).status,404);
});
test('expired files disappear from lists and cannot be downloaded before cleanup',async()=>{
  const bucket=storage(),env={TRANSFERS:bucket},id=crypto.randomUUID();
  await bucket.put('transfers/'+id,new Blob(['secret']).stream(),{customMetadata:{filename:'a',expiresAt:String(Date.now()-1)}});
  assert.equal((await(await transfers(request(),env,{})).json()).documents.length,0);
  assert.equal((await transfers(request('/'+id+'/file'),env,{})).status,410);
  assert.equal(bucket.objects.size,0);
  await bucket.put('transfers/'+id,new Blob(['secret']).stream(),{customMetadata:{expiresAt:'0'}});
  await cleanupTransfers(env);assert.equal(bucket.objects.size,0);
});
test('invalid retention, oversized requests, missing binding and unauthenticated callers are rejected',async()=>{
  const env={TRANSFERS:storage()},form=new FormData();form.set('file',new Blob(['a']),'a');form.set('minutes','999');
  assert.equal((await transfers(request('',{method:'POST',body:form}),env,{})).status,400);
  assert.equal((await transfers(request('',{method:'POST',headers:{'content-length':'999999999'},body:'x'}),env,{})).status,413);
  assert.equal((await transfers(request(),{},{})).status,503);
  for(const path of ['', '/'+crypto.randomUUID()+'/file','/'+crypto.randomUUID()+'/delete']){
    assert.equal((await worker.fetch(request(path,{headers:{origin:'https://dashboard.3dowon.com'}}),{DASHBOARD_ORIGIN:'https://dashboard.3dowon.com'})).status,401);
    assert.equal((await worker.fetch(request(path,{headers:{origin:'https://evil.example'}}),{})).status,403);
  }
});
