import {test} from 'node:test';
import assert from 'node:assert/strict';
import {library,metadata,MAX_PDF} from './src/library.js';

const origin='https://dashboard.3dowon.com';
function fixture(kind='pdf'){
 const collection=kind==='wnest'?'wirenest':'library',extension=kind==='wnest'?'wnest':'pdf';
 let index=null,head='h0',tree='t0',pendingIndex,revision=0,race=false;
 const blobs=new Map(),files=new Map(),commits=new Map();let writes=0;
 const gh=async(path,token,options={})=>{
  assert.equal(token,'private-token');const body=options.body&&JSON.parse(options.body);
  if(path.endsWith('/git/ref/heads/main'))return Response.json({object:{sha:head}});
  if(path.includes('/git/commits/')&&!body)return Response.json({tree:{sha:tree}});
  if(path.includes('/contents/'+collection+'/index.json'))return index?Response.json({content:Buffer.from(JSON.stringify(index)).toString('base64')}):new Response('',{status:404});
  if(path.includes('/contents/'+collection+'/files/'))return new Response(files.get(path.split('/').pop()),{headers:{'content-type':'application/octet-stream'}});
  if(path.endsWith('/git/blobs')){const sha='blob'+blobs.size;blobs.set(sha,Buffer.from(body.content,'base64'));return Response.json({sha});}
  if(path.endsWith('/git/trees')){assert.equal(body.base_tree,tree);pendingIndex=JSON.parse(body.tree.find(t=>t.path===collection+'/index.json').content);const pdf=body.tree.find(t=>t.path.endsWith('.'+extension));return Response.json({sha:JSON.stringify({index:pendingIndex,pdf})});}
  if(path.endsWith('/git/commits')){const sha='c'+(++revision);commits.set(sha,JSON.parse(body.tree));return Response.json({sha});}
  if(path.endsWith('/git/refs/heads/main')){assert.equal(body.force,false);if(race){race=false;head='concurrent';tree='concurrent-tree';return new Response('',{status:422});}const commit=commits.get(body.sha);index=commit.index;if(commit.pdf){const name=commit.pdf.path.split('/').pop();if(commit.pdf.sha===null)files.delete(name);else files.set(name,blobs.get(commit.pdf.sha));}head=body.sha;writes++;return Response.json({object:{sha:head}});}
  throw Error('Unexpected '+path);
 };
 const request=(path,options={})=>library(new Request('https://api.3dowon.com/api/'+collection+path,options),'private-token',gh,{'access-control-allow-origin':origin},kind);
 return {request,files,get index(){return index;},get writes(){return writes;},race(){race=true;}};
}
function upload(content='%PDF-1.4\nfixture',name='참고 자료.pdf'){
 const form=new FormData();form.set('file',new Blob([content],{type:'application/pdf'}),name);form.set('title','참고 자료');form.set('tags',JSON.stringify(['설계',' 참고 ','설계']));return {method:'POST',body:form};
}

const wnest=JSON.stringify({app:'wirenest',v:2,name:'배선 작업',boards:{},nodes:{},wires:{},nets:{},texts:{},groups:{},uid:0});
test('WireNest backups preserve bytes and duplicate filenames; conflicts retry and stale deletion is rejected',async()=>{
 const f=fixture('wnest');
 assert.deepEqual((await(await f.request('')).json()).documents,[]);
 f.race();
 const firstResponse=await f.request('',upload(wnest,'작업.wnest'));
 assert.equal(firstResponse.status,200);
 const first=(await firstResponse.json()).document;
 const second=(await(await f.request('',upload(wnest,'작업.wnest'))).json()).document;
 assert.notEqual(first.id,second.id);
 assert.equal(f.index.documents.length,2);
 assert.equal(f.files.size,2);
 const download=await f.request('/'+first.id+'/file');
 assert.equal(download.headers.get('content-type'),'application/octet-stream');
 assert.equal(download.headers.get('cache-control'),'no-store');
 assert.match(download.headers.get('content-disposition'),/\.wnest/);
 assert.equal(await download.text(),wnest);
 const remove=revision=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({revision})});
 assert.equal((await f.request('/'+first.id+'/delete',remove('stale'))).status,409);
 assert.equal(f.files.size,2);
 f.race();
 assert.equal((await f.request('/'+first.id+'/delete',remove(first.revision))).status,200);
 assert.equal(f.files.has(second.id+'.wnest'),true);
 assert.equal((await f.request('/'+first.id+'/file')).status,404);
 assert.equal((await(await f.request('')).json()).documents.length,1);
});

test('WireNest rejects renamed PDFs, malformed projects and oversized uploads without saving',async()=>{
 const f=fixture('wnest');
 for(const invalid of ['%PDF-1.4','{}','null','[]','{',JSON.stringify({app:'wirenest',v:2,boards:[],nodes:{},wires:{}})]){
  assert.equal((await f.request('',upload(invalid,'bad.wnest'))).status,400);
 }
 assert.equal((await f.request('',upload(wnest,'bad.json'))).status,400);
 assert.equal((await f.request('',{...upload(wnest,'large.wnest'),headers:{'content-length':String(25*1024*1024+65537)}})).status,413);
 assert.equal(f.writes,0);
 assert.equal(f.files.size,0);
});
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
