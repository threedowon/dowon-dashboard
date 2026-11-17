import {test} from 'node:test';
import assert from 'node:assert/strict';
import {library,metadata,MAX_PDF} from './src/library.js';

const origin='https://dashboard.3dowon.com';
function fixture(){
 let index=null,head='h0',tree='t0',pendingIndex,revision=0,race=false;
 const blobs=new Map(),files=new Map(),commits=new Map();let writes=0;
 const gh=async(path,token,options={})=>{
  assert.equal(token,'private-token');const body=options.body&&JSON.parse(options.body);
  if(path.endsWith('/git/ref/heads/main'))return Response.json({object:{sha:head}});
  if(path.includes('/git/commits/')&&!body)return Response.json({tree:{sha:tree}});
  if(path.includes('/contents/library/index.json'))return index?Response.json({content:Buffer.from(JSON.stringify(index)).toString('base64')}):new Response('',{status:404});
  if(path.includes('/contents/library/files/'))return new Response(files.get(path.split('/').pop()),{headers:{'content-type':'application/octet-stream'}});
  if(path.endsWith('/git/blobs')){const sha='blob'+blobs.size;blobs.set(sha,Buffer.from(body.content,'base64'));return Response.json({sha});}
  if(path.endsWith('/git/trees')){assert.equal(body.base_tree,tree);pendingIndex=JSON.parse(body.tree.find(t=>t.path==='library/index.json').content);const pdf=body.tree.find(t=>t.path.endsWith('.pdf'));return Response.json({sha:JSON.stringify({index:pendingIndex,pdf})});}
  if(path.endsWith('/git/commits')){const sha='c'+(++revision);commits.set(sha,JSON.parse(body.tree));return Response.json({sha});}
  if(path.endsWith('/git/refs/heads/main')){assert.equal(body.force,false);if(race){race=false;head='concurrent';tree='concurrent-tree';return new Response('',{status:422});}const commit=commits.get(body.sha);index=commit.index;if(commit.pdf)files.set(commit.pdf.path.split('/').pop(),blobs.get(commit.pdf.sha));head=body.sha;writes++;return Response.json({object:{sha:head}});}
  throw Error('Unexpected '+path);
 };
 const request=(path,options={})=>library(new Request('https://api.3dowon.com/api/library'+path,options),'private-token',gh,{'access-control-allow-origin':origin});
 return {request,get index(){return index;},get writes(){return writes;},race(){race=true;}};
}
function upload(content='%PDF-1.4\nfixture',name='참고 자료.pdf'){
 const form=new FormData();form.set('file',new Blob([content],{type:'application/pdf'}),name);form.set('title','참고 자료');form.set('tags',JSON.stringify(['설계',' 참고 ','설계']));return {method:'POST',body:form};
}
test('PDF upload, list, bytes and metadata round trip; concurrent commits preserve index',async()=>{
 const f=fixture();assert.deepEqual((await(await f.request('')).json()).documents,[]);
 f.race();const r=await f.request('',upload());assert.equal(r.status,200);const {document:d}=await r.json();
 assert.deepEqual(d.tags,['설계','참고']);assert.equal(f.index.documents.length,1);assert.equal(f.writes,1);
 assert.equal((await(await f.request('')).json()).documents[0].title,'참고 자료');
 const pdf=await f.request('/'+d.id+'/file');assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(await pdf.text(),'%PDF-1.4\nfixture');assert.equal(pdf.headers.get('cache-control'),'no-store');
 const change={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'변경한 제목',tags:['회의'],revision:d.revision})};
 assert.equal((await f.request('/'+d.id,change)).status,200);
 assert.equal(f.index.documents[0].title,'변경한 제목');
 assert.equal((await f.request('/'+d.id,change)).status,409);
 assert.equal(f.writes,2);
});
test('invalid PDF, oversized upload, invalid tags and unknown document cannot mutate data',async()=>{
 const f=fixture();assert.equal((await f.request('',upload('not a PDF'))).status,400);
 assert.equal((await f.request('',upload('%PDF-1.4','bad.html'))).status,400);
 assert.equal((await f.request('',{...upload(),headers:{'content-length':String(MAX_PDF+65537)}})).status,413);
 assert.equal((await f.request('/00000000-0000-0000-0000-000000000000/file')).status,404);
 assert.throws(()=>metadata('a',['x'.repeat(41)]));assert.throws(()=>metadata('',[]));assert.equal(f.writes,0);
});
