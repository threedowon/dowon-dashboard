import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../assets/archive.js',import.meta.url),'utf8');
const settle=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};
function app(fetch,{readonly=false,local=false}={}){
 const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{value:'',addEventListener(){}});return elements.get(id);};
 vm.runInNewContext(source,{document:{documentElement:{dataset:{readonly:String(readonly)}},getElementById:el},location:{hostname:local?'localhost':'dashboard.3dowon.com',hash:'#archive'},window:{addEventListener(){}},sessionStorage:{getItem:()=>null},FormData,fetch,confirm:()=>true});return el;
}
test('archive UI uploads files, retains successful files on partial failure, searches and deletes',async()=>{
 let posts=0,deletes=0;const el=app(async(url,options)=>{
  if(url.endsWith('/delete')){deletes++;return Response.json({ok:true});}
  if(options.method!=='POST')return Response.json({documents:[]});
  posts++;if(posts===2)return Response.json({error:'Storage unavailable'},{status:500});
  const file=options.body.get('file');return Response.json({document:{id:'saved',filename:file.name,size:file.size,createdAt:Date.now()}});
 });await settle();
 el('archiveFiles').files=[new File(['ok'],'<한글>.txt'),new File(['fail'],'second.txt')];el('archiveFiles').onchange();await settle();
 assert.equal(posts,2);assert.match(el('archiveStatus').textContent,/1개 파일/);assert.match(el('archiveStatus').textContent,/Storage unavailable/);
 assert.match(el('archiveList').innerHTML,/&lt;한글&gt;.txt/);assert.equal(el('archiveUpload').disabled,false);
 el('archiveSearch').value='missing';el('archiveSearch').oninput();assert.match(el('archiveList').innerHTML,/검색 결과가 없습니다/);
 el('archiveSearch').value='';el('archiveSearch').oninput();await el('archiveList').onclick({target:{closest:()=>({dataset:{delete:'saved'}})}});
 assert.equal(deletes,1);assert.match(el('archiveUsage').textContent,/0개 파일/);
});
test('archive UI blocks oversized files and all network calls in shared or local views',async()=>{
 let calls=0;const fetch=async()=>{calls++;return Response.json({documents:[]});};
 const el=app(fetch);await settle();el('archiveFiles').files=[{name:'too-large.bin',size:26*1024**2}];el('archiveFiles').onchange();await settle();assert.equal(calls,1);assert.match(el('archiveStatus').textContent,/최대 25MB/);
 for(const options of [{readonly:true},{local:true}]){const blocked=app(fetch,options);await settle();assert.equal(blocked('archiveUpload').disabled,true);await blocked('archiveRefresh').onclick();assert.equal(calls,1);}
});
