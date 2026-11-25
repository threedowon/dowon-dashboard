import {test} from 'node:test';
import assert from 'node:assert/strict';
import {largeTransfers,PART_SIZE,MAX_LARGE} from './src/large-transfers.js';
function fixture(persistent=false){
 const objects=new Map(),uploads=new Map();
 const bucket={async put(key,value,options={}){objects.set(key,{size:typeof value==='string'?value.length:value.byteLength,customMetadata:options.customMetadata,json:async()=>JSON.parse(value)});},async get(key){return objects.get(key);},async head(key){return objects.get(key);},async delete(key){objects.delete(key);},async createMultipartUpload(key){const uploadId=crypto.randomUUID();uploads.set(uploadId,{key,parts:new Map()});return {uploadId,abort:async()=>uploads.delete(uploadId)};},resumeMultipartUpload(key,id){return {async uploadPart(number,bytes){uploads.get(id).parts.set(number,new Uint8Array(await new Response(bytes).arrayBuffer()));return {partNumber:number,etag:'etag-'+number};},async complete(parts){const u=uploads.get(id);assert.ok(u);assert.equal(parts.length,u.parts.size);const object={size:[...u.parts.values()].reduce((n,b)=>n+b.length,0)};objects.set(key,object);uploads.delete(id);return object;},async abort(){uploads.delete(id);}};}};
 const call=(path,data)=>largeTransfers(new Request('https://api.3dowon.com/api/'+(persistent?'archive':'transfers')+'/uploads'+path,{method:'POST',headers:data instanceof Uint8Array?{'content-length':String(data.length)}:{},body:data instanceof Uint8Array?data:JSON.stringify(data)}),bucket,(d,s=200)=>Response.json(d,{status:s}),persistent);
 return {call,objects,uploads,bucket};
}
test('multipart validates exact sizes and ordered parts; completion starts retention and is retryable',async()=>{
 const f=fixture(),start=await f.call('',{filename:'large.bin',size:PART_SIZE+3,minutes:10});assert.equal(start.status,201);const {id}=await start.json();
 assert.equal((await f.call('/'+id+'/part?number=1',new Uint8Array(1))).status,400);
 const first=await(await f.call('/'+id+'/part?number=1',new Uint8Array(PART_SIZE))).json();
 const last=await(await f.call('/'+id+'/part?number=2',new Uint8Array([1,2,3]))).json();
 assert.equal((await f.call('/'+id+'/complete',{parts:[last,first]})).status,400);
 const before=Date.now(),response=await f.call('/'+id+'/complete',{parts:[first,last]});assert.equal(response.status,201);
 const {document}=await response.json();assert.equal(document.size,PART_SIZE+3);assert.ok(document.createdAt>=before);assert.equal(document.expiresAt-document.createdAt,600000);
 const repeated=await(await f.call('/'+id+'/complete',{parts:[first,last]})).json();assert.equal(repeated.document.expiresAt,document.expiresAt);
 assert.equal(f.uploads.size,0);
});
test('multipart rejects oversized and malformed metadata and abort removes partial state',async()=>{
 const f=fixture();
 for(const data of [{filename:'a',size:MAX_LARGE+1,minutes:10},{filename:'a',size:1,minutes:11},{filename:'a',size:-1,minutes:10}])assert.ok((await f.call('',data)).status>=400);
 const {id}=await(await f.call('',{filename:'a',size:1,minutes:1})).json();assert.equal((await f.call('/'+id+'/abort',{})).status,200);assert.equal(f.uploads.size,0);assert.equal(f.objects.size,0);
});

test('archive multipart accepts 5GB boundary, never expires completed files, and supports retry',async()=>{
 const f=fixture(true);
 assert.equal((await f.call('',{filename:'huge',size:MAX_LARGE+1})).status,413);
 const {id}=await(await f.call('',{filename:'5gb.bin',size:MAX_LARGE})).json();
 assert.ok(f.objects.has('archive-uploads/'+id));
 const session=await f.objects.get('archive-uploads/'+id).json();assert.equal(session.key,'archive-files/'+id);
 // Model R2 completion without allocating 5GB in the test process.
 f.objects.set(session.key,{size:MAX_LARGE});
 const parts=Array.from({length:Math.ceil(MAX_LARGE/PART_SIZE)},(_,i)=>({partNumber:i+1,etag:'part-'+i}));
 const first=await f.call('/'+id+'/complete',{parts});assert.equal(first.status,201);
 const {document}=await first.json();assert.equal(document.expiresAt,undefined);assert.equal(document.size,MAX_LARGE);
 const metadata=f.objects.get('archive/'+id).customMetadata;assert.equal(metadata.expiresAt,undefined);assert.equal(metadata.payloadKey,session.key);
 const repeat=await(await f.call('/'+id+'/complete',{parts})).json();assert.equal(repeat.document.createdAt,document.createdAt);
 assert.equal((await f.call('/'+id+'/part?number=1',new Uint8Array(1))).status,400);
});
test('archive multipart streams real parts and abort isolates transfer uploads',async()=>{
 const f=fixture(true),{id}=await(await f.call('',{filename:'archive.bin',size:PART_SIZE+3})).json();
 const first=await(await f.call('/'+id+'/part?number=1',new Uint8Array(PART_SIZE))).json();
 const last=await(await f.call('/'+id+'/part?number=2',new Uint8Array([1,2,3]))).json();
 assert.equal((await f.call('/'+id+'/complete',{parts:[first,last]})).status,201);
 assert.equal(f.objects.get('archive-files/'+id).size,PART_SIZE+3);
 const next=await(await f.call('',{filename:'abort.bin',size:10})).json();await f.call('/'+next.id+'/abort',{});
 assert.equal(f.objects.has('archive-uploads/'+next.id),false);assert.equal(f.objects.has('archive/'+id),true);
});
