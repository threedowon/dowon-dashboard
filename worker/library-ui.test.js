import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../library.js',import.meta.url),'utf8');
function app(){
 const elements=new Map(),events={},uploads=[],holds=new Map(),stored=[];
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',elements:[],open:false,opened:0,classList:{toggle(){},add(){},remove(){}},addEventListener(name,fn){this[name]=fn;},reset(){el('pdfTagInput').value='';},showModal(){this.open=true;this.opened++;},close(){this.open=false;}});return elements.get(id);};
 let failName=null,paused=false;
 const context={document:{documentElement:{dataset:{}},getElementById:el},window:{addEventListener:(name,fn)=>events[name]=fn},location:{hash:''},sessionStorage:{getItem:()=>null},URL,FormData,console,
 fetch:async(url,options)=>{
  if(options.method!=='POST')return Response.json({documents:stored});
  const name=options.body.get('file').name;uploads.push(name);
  if(paused)await new Promise(resolve=>holds.set(name,resolve));
  if(name===failName)return Response.json({error:'시험 실패'},{status:500});
  const document={id:'doc-'+uploads.length,filename:name,title:name,tags:[],size:100,createdAt:'2026-11-17'};stored.push(document);return Response.json({document});
 }};
 vm.runInNewContext(source,context);
 const drop=files=>{let prevented=false;el('pdfPage').drop({dataTransfer:{types:['Files'],files},preventDefault(){prevented=true;}});return prevented;};
 return {el,drop,uploads,fail(name){failName=name;},pause(){paused=true;},release(name){holds.get(name)?.();},retry:id=>el('pdfList').onclick({target:{closest:selector=>selector==='[data-upload-retry]'?{dataset:{uploadRetry:id}}:null}}),load:()=>el('pdfRefresh').onclick()};
}
const pdf=name=>new File(['%PDF-1.4'],name,{type:'application/pdf'});
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
test('drop uploads directly in the list without ever opening the upload modal',async()=>{
 const a=app();assert.equal(a.drop([pdf('a.pdf')]),true);assert.equal(a.uploads.length,0);
 await a.load();a.pause();a.el('pdfSearch').value='old filter';a.drop([pdf('a.pdf'),pdf('b.pdf')]);await settle();
 assert.equal(a.el('pdfModal').opened,0);assert.equal(a.el('pdfSearch').value,'');
 assert.equal((a.el('pdfList').innerHTML.match(/<progress/g)||[]).length,2);
 assert.match(a.el('pdfList').innerHTML,/업로드 중/);assert.match(a.el('pdfList').innerHTML,/업로드 대기 중/);
 a.release('a.pdf');await settle();
 assert.match(a.el('pdfList').innerHTML,/data-open="doc-1"/);assert.equal((a.el('pdfList').innerHTML.match(/<progress/g)||[]).length,1);
 a.release('b.pdf');await settle();
 assert.deepEqual(a.uploads,['a.pdf','b.pdf']);assert.equal(a.el('pdfModal').open,false);assert.match(a.el('pdfStatus').textContent,/2개 PDF/);
 assert.equal(a.el('pdfModal').opened,0);assert.ok(!a.el('pdfList').innerHTML.includes('<progress'));
 assert.ok(a.el('pdfList').innerHTML.indexOf('a.pdf')<a.el('pdfList').innerHTML.indexOf('b.pdf'));
});
test('invalid drops do not upload and failed cards retry inline without duplicating successful files',async()=>{
 const a=app();await a.load();a.drop([pdf('wrong.txt')]);assert.equal(a.uploads.length,0);
 a.fail('b.pdf');a.drop([pdf('a.pdf'),pdf('b.pdf'),pdf('c.pdf')]);await settle();assert.match(a.el('pdfStatus').textContent,/2개 PDF.*1개 업로드 실패/);
 assert.equal(a.el('pdfModal').opened,0);assert.match(a.el('pdfList').innerHTML,/data-upload-retry="2"/);
 a.fail(null);await a.retry('2');assert.deepEqual(a.uploads,['a.pdf','b.pdf','c.pdf','b.pdf']);
 assert.ok(!a.el('pdfList').innerHTML.includes('data-upload-retry'));
 assert.equal((a.el('pdfList').innerHTML.match(/data-open=/g)||[]).length,3);
 assert.equal(a.el('pdfModal').opened,0);
});

test('manual file selection keeps its upload form and shares the same upload request',async()=>{
 const a=app();await a.load();a.el('pdfAdd').onclick();assert.equal(a.el('pdfModal').open,true);
 a.el('pdfFiles').files=[pdf('manual.pdf')];a.el('pdfFiles').onchange();a.el('pdfForm').onsubmit({preventDefault(){}});await settle();
 assert.deepEqual(a.uploads,['manual.pdf']);assert.equal(a.el('pdfModal').open,false);assert.match(a.el('pdfList').innerHTML,/manual.pdf/);
});
