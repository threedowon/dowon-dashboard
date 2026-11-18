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
  if(path.endsWith('/git/trees')){assert.equal(body.base_tree,tree);pendingIndex=JSON.parse(body.tree.find(t=>t.path==='library/index.json').content);const pdfs=body.tree.filter(t=>t.path.endsWith('.pdf'));return Response.json({sha:JSON.stringify({index:pendingIndex,pdfs})});}
  if(path.endsWith('/git/commits')){const sha='c'+(++revision);commits.set(sha,JSON.parse(body.tree));return Response.json({sha});}
  if(path.endsWith('/git/refs/heads/main')){assert.equal(body.force,false);if(race){race=false;head='concurrent';tree='concurrent-tree';return new Response('',{status:422});}const commit=commits.get(body.sha);index=commit.index;for(const pdf of commit.pdfs){const name=pdf.path.split('/').pop();if(pdf.sha===null)files.delete(name);else files.set(name,blobs.get(pdf.sha));}head=body.sha;writes++;return Response.json({object:{sha:head}});}
  throw Error('Unexpected '+path);
 };
 const request=(path,options={})=>library(new Request('https://api.3dowon.com/api/library'+path,options),'private-token',gh,{'access-control-allow-origin':origin});
 return {request,files,get index(){return index;},get writes(){return writes;},race(){race=true;}};
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

test('delete removes only the selected PDF atomically and rejects stale revisions',async()=>{
 const f=fixture();
 const first=(await(await f.request('',upload())).json()).document;
 const second=(await(await f.request('',upload('%PDF-1.4\nother','other.pdf'))).json()).document;
 const deletion=revision=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision})});
 assert.equal((await f.request('/'+first.id+'/delete',deletion('stale'))).status,409);
 assert.equal(f.files.size,2);
 f.race();
 assert.equal((await f.request('/'+first.id+'/delete',deletion(first.revision))).status,200);
 assert.equal(f.files.has(first.id+'.pdf'),false);
 assert.equal(f.files.has(second.id+'.pdf'),true);
 assert.deepEqual(f.index.documents.map(d=>d.id),[second.id]);
 assert.equal((await f.request('/'+first.id+'/file')).status,404);
 assert.equal((await f.request('/'+first.id+'/delete',deletion(first.revision))).status,404);
});

test('batch tags merge without duplicates and batch deletion removes only selected files in one commit',async()=>{
 const f=fixture(),docs=[];
 for(let i=0;i<3;i++)docs.push((await(await f.request('',upload())).json()).document);
 const batch=(action,documents,tags)=>f.request('/batch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,documents,tags})});
 const tagged=await batch('tags',docs.slice(0,2),['설계','공통']);
 assert.equal(tagged.status,200);
 const updated=(await tagged.json()).documents;
 assert.equal(f.writes,4);
 for(const d of updated){assert.deepEqual(d.tags,['설계','참고','공통']);assert.notEqual(d.revision,docs.find(x=>x.id===d.id).revision);}
 assert.equal((await batch('delete',docs.slice(0,2))).status,409);
 assert.equal(f.files.size,3);assert.equal(f.writes,4);
 f.race();
 assert.equal((await batch('delete',updated)).status,200);
 assert.equal(f.writes,5);assert.equal(f.files.size,1);
 assert.deepEqual(f.index.documents.map(d=>d.id),[docs[2].id]);
 assert.ok(f.files.has(docs[2].id+'.pdf'));
});
test('batch invalid selection and tag overflow never partially save',async()=>{
 const f=fixture(),docs=[];
 for(let i=0;i<2;i++)docs.push((await(await f.request('',upload())).json()).document);
 const batch=(action,documents,tags)=>f.request('/batch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,documents,tags})});
 assert.equal((await batch('delete',[docs[0],docs[0]])).status,400);
 assert.equal((await batch('tags',docs,['x'.repeat(41)])).status,400);
 assert.equal((await batch('tags',docs,Array.from({length:20},(_,i)=>'tag'+i))).status,400);
 assert.equal((await batch('tags',[docs[0],{...docs[1],revision:'stale'}],['common'])).status,409);
 assert.equal(f.writes,2);assert.equal(f.files.size,2);
 assert.ok(f.index.documents.every(d=>d.tags.length===2));
});
