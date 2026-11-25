import {test} from 'node:test';
import assert from 'node:assert/strict';
import {archive} from './src/archive.js';
import {cleanupTransfers} from './src/transfers.js';
import worker from './src/index.js';

function storage(){
  const objects=new Map();
  return {objects,async put(key,body,options){const bytes=await new Response(body).arrayBuffer();objects.set(key,{key,size:bytes.byteLength,...options,bytes});},async list({prefix,cursor}){const all=[...objects.values()].filter(o=>o.key.startsWith(prefix)),start=Number(cursor||0);return {objects:all.slice(start,start+1),truncated:start+1<all.length,cursor:String(start+1)};},async get(key){const o=objects.get(key);return o?{...o,body:new Blob([o.bytes]).stream()}:null;},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])objects.delete(key);}};
}
const request=(path='',options={})=>new Request('https://api.3dowon.com/api/archive'+path,options);
test('archive preserves bytes and duplicate filenames, paginates, survives transfer cleanup and deletes explicitly',async()=>{
  const bucket=storage(),env={TRANSFERS:bucket},ids=[];
  for(let i=0;i<2;i++){
    const form=new FormData();form.set('file',new Blob([new Uint8Array([0,255,17])]),'한글.bin');
    const response=await archive(request('',{method:'POST',body:form}),env,{});
    assert.equal(response.status,201);const {document}=await response.json();ids.push(document.id);assert.equal(document.expiresAt,undefined);
  }
  assert.notEqual(ids[0],ids[1]);
  await bucket.put('transfers/expired','temporary',{customMetadata:{expiresAt:'0'}});
  await cleanupTransfers(env);
  const list=await(await archive(request(),env,{})).json();
  assert.equal(list.documents.length,2);assert.equal(list.totalBytes,6);
  const download=await archive(request('/'+ids[0]+'/file'),env,{});
  assert.deepEqual([...new Uint8Array(await download.arrayBuffer())],[0,255,17]);
  assert.match(download.headers.get('content-disposition'),/attachment/);
  await archive(request('/'+ids[0]+'/delete',{method:'POST'}),env,{});
  assert.equal((await archive(request('/'+ids[0]+'/file'),env,{})).status,404);
  assert.equal(bucket.objects.size,1);
});
test('archive rejects missing storage, malformed forms, oversized bodies and unauthenticated requests',async()=>{
  const env={TRANSFERS:storage()};
  assert.equal((await archive(request(),{},{})).status,503);
  assert.equal((await archive(request('',{method:'POST',body:'bad'}),env,{})).status,400);
  assert.equal((await archive(request('',{method:'POST',body:'x',headers:{'content-length':'999999999'}}),env,{})).status,413);
  for(const path of ['', '/'+crypto.randomUUID()+'/file','/'+crypto.randomUUID()+'/delete']){
    assert.equal((await worker.fetch(request(path,{headers:{origin:'https://dashboard.3dowon.com'}}),{DASHBOARD_ORIGIN:'https://dashboard.3dowon.com'})).status,401);
    assert.equal((await worker.fetch(request(path,{headers:{origin:'https://evil.example'}}),{})).status,403);
  }
  const native=request('/'+crypto.randomUUID()+'/file',{headers:{'sec-fetch-site':'same-site',referer:'https://dashboard.3dowon.com/'}});
  assert.equal((await worker.fetch(native,{DASHBOARD_ORIGIN:'https://dashboard.3dowon.com'})).status,401);
});
