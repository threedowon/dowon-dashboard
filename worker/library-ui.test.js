import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../library.js',import.meta.url),'utf8');
function app(){
 const elements=new Map(),events={},uploads=[];
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',elements:[],open:false,classList:{toggle(){},add(){},remove(){}},addEventListener(name,fn){this[name]=fn;},reset(){el('pdfTagInput').value='';},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);};
 let failName=null;
 const context={document:{documentElement:{dataset:{}},getElementById:el},window:{addEventListener:(name,fn)=>events[name]=fn},location:{hash:''},sessionStorage:{getItem:()=>null},URL,FormData,console,
 fetch:async(url,options)=>{
  if(options.method!=='POST')return Response.json({documents:[]});
  const name=options.body.get('file').name;uploads.push(name);
  if(name===failName)return Response.json({error:'시험 실패'},{status:500});
  return Response.json({document:{id:'00000000-0000-0000-0000-000000000001',filename:name,title:name,tags:[],size:100,createdAt:'2026-11-17'}});
 }};
 vm.runInNewContext(source,context);
 const drop=files=>{let prevented=false;el('pdfPage').drop({dataTransfer:{types:['Files'],files},preventDefault(){prevented=true;}});return prevented;};
 return {el,drop,uploads,fail(name){failName=name;},load:()=>el('pdfRefresh').onclick()};
}
const pdf=name=>new File(['%PDF-1.4'],name,{type:'application/pdf'});
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
test('drop requires connection; valid PDF files upload automatically without clicking Save',async()=>{
 const a=app();assert.equal(a.drop([pdf('a.pdf')]),true);assert.equal(a.uploads.length,0);
 await a.load();a.drop([pdf('a.pdf'),pdf('b.pdf')]);await settle();
 assert.deepEqual(a.uploads,['a.pdf','b.pdf']);assert.equal(a.el('pdfModal').open,false);assert.match(a.el('pdfStatus').textContent,/2개 PDF/);
});
test('invalid drops do not upload and interrupted batches retry only remaining files',async()=>{
 const a=app();await a.load();a.drop([pdf('wrong.txt')]);assert.equal(a.uploads.length,0);
 a.fail('b.pdf');a.drop([pdf('a.pdf'),pdf('b.pdf')]);await settle();assert.match(a.el('pdfFormStatus').textContent,/1개 저장 완료/);
 a.fail(null);a.el('pdfForm').onsubmit({preventDefault(){}});await settle();assert.deepEqual(a.uploads,['a.pdf','b.pdf','b.pdf']);
});
