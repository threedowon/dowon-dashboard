import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../assets/wirenest.js',import.meta.url),'utf8');
function app({readonly=false,hostname='dashboard.3dowon.com'}={}){
 const listeners=new Map(),sent=[],popup={closed:false,postMessage:(data,origin)=>sent.push({data,origin})};
 const elements=new Map(),uploads=[],stored=[];let failName=null,requests=0,id=0;
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',classList:{toggle(){}},addEventListener(name,fn){this[name]=fn;}});return elements.get(id);};
 const context={document:{documentElement:{dataset:{readonly:String(readonly)}},getElementById:el},window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),open:()=>popup},location:{hash:'#wirenest',hostname},sessionStorage:{getItem:()=>null},crypto:{randomUUID:()=>String(++id)},FormData,URL,console,File,TextEncoder,setInterval:()=>1,clearInterval(){},
 fetch:async(url,options)=>{
  requests++;assert.equal(options.credentials,'include');assert.match(url,/\/api\/wirenest/);
  if(url.endsWith('/file'))return Response.json({app:'wirenest',v:2,name:'test',boards:{},nodes:{},wires:{}});
  if(options.method!=='POST')return Response.json({documents:stored});
  const name=options.body.get('file').name;uploads.push(name);
  if(name===failName)return Response.json({error:'업로드 실패'},{status:500});
  const document={id:'doc-'+uploads.length,filename:name,size:100,createdAt:'2026-11-18T03:00:00Z'};stored.push(document);return Response.json({document});
 }};
 vm.runInNewContext(source,context);
 return {el,uploads,sent,popup,send:event=>listeners.get('message')?.(event),open:id=>el('wnList').onclick({target:{closest:()=>({dataset:{open:id}})}}),get requests(){return requests;},fail:name=>{failName=name;},
  drop:files=>el('wirenestPage').drop({dataTransfer:{types:['Files'],files},preventDefault(){}}),
  retry:id=>el('wnList').onclick({target:{closest:()=>({dataset:{retry:id}})}})};
}
const file=name=>new File(['{}'],name),settle=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
test('WireNest only shows uploaded files and retries failures without duplicating successes',async()=>{
 const a=app();await settle();assert.match(a.el('wnList').innerHTML,/아직 업로드한 백업이 없습니다/);
 a.fail('second.wnest');a.drop([file('first.wnest'),file('second.wnest')]);await settle();
 assert.match(a.el('wnList').innerHTML,/data-download="doc-1"/);
 assert.match(a.el('wnList').innerHTML,/data-retry="2"/);
 a.fail(null);await a.retry('2');
 assert.deepEqual(a.uploads,['first.wnest','second.wnest','second.wnest']);
 assert.equal((a.el('wnList').innerHTML.match(/data-download=/g)||[]).length,2);
 a.drop([file('first.wnest')]);await settle();
 assert.equal((a.el('wnList').innerHTML.match(/data-download=/g)||[]).length,3);
 a.el('wnSearch').value='second';a.el('wnSearch').oninput();
 assert.equal((a.el('wnList').innerHTML.match(/data-download=/g)||[]).length,1);
});
test('WireNest prevents invalid uploads and escapes filenames in backup cards',async()=>{
 const a=app();await settle();a.drop([file('wrong.pdf'),file('<img onerror=alert(1)>.wnest')]);await settle();
 assert.deepEqual(a.uploads,['<img onerror=alert(1)>.wnest']);
 assert.match(a.el('wnList').innerHTML,/&lt;img onerror=alert\(1\)&gt;/);
 assert.ok(!a.el('wnList').innerHTML.includes('<img'));
});
test('shared documents and local previews never fetch or upload private backups',async()=>{
 for(const config of [{readonly:true},{hostname:'127.0.0.1'}]){
  const a=app(config);await settle();a.drop([file('private.wnest')]);await settle();
  assert.equal(a.requests,0);assert.equal(a.el('wnUpload').disabled,true);
 }
});


test('direct open sends only to the selected editor and authenticated save appends a new backup',async()=>{
 const a=app();await settle();a.drop([file('work.wnest')]);await settle();await a.open('doc-1');await settle();
 const first=a.sent[0];assert.equal(first.origin,'https://threedowon.github.io');assert.equal(first.data.type,'project');assert.equal(a.uploads.length,1);
 const envelope={channel:'wirenest-dashboard',nonce:first.data.nonce};
 await a.send({source:a.popup,origin:'https://attacker.example',data:{...envelope,type:'ready'}});assert.equal(a.sent.length,1);
 await a.send({source:{},origin:first.origin,data:{...envelope,type:'ready'}});assert.equal(a.sent.length,1);
 await a.send({source:a.popup,origin:first.origin,data:{...envelope,type:'loaded'}});
 const save={source:a.popup,origin:first.origin,data:{...envelope,type:'save',requestId:'r1',text:first.data.text}};
 await a.send(save);assert.equal(a.uploads.length,2);assert.equal(a.sent.at(-1).data.type,'save-result');
 await a.send(save);assert.equal(a.uploads.length,2,'duplicate request must not create a duplicate backup');
 assert.match(a.el('wnList').innerHTML,/data-open=/);
});
