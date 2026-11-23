import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sketchbook,validateSketch} from './src/sketchbook.js';
const doc=(id='fsr-single')=>({id,title:'압력 센서',board:'ESP32',description:'GPIO4',files:[{name:'sketch.ino',code:'#include <Arduino.h>\n// 한글\nvoid setup() {}\n'}]});
function fixture(){
 let saved=null,sha=null,writes=0,race=null,upstreamError=false;
 const gh=async(path,token,options={})=>{
  assert.equal(token,'private');assert.ok(path.endsWith('/arduino/sketchbook.json'));
  if(options.method==='PUT'){
   if(upstreamError)return new Response('',{status:500});
   const body=JSON.parse(options.body);
   if(race){saved=race;race=null;sha='raced';return new Response('',{status:409});}
   assert.equal(body.sha||null,sha);
   saved=JSON.parse(Buffer.from(body.content,'base64').toString());sha='sha'+(++writes);
   return Response.json({content:{sha}});
  }
  return saved?Response.json({sha,content:Buffer.from(JSON.stringify(saved)).toString('base64')}):new Response('',{status:404});
 };
 const call=(body)=>sketchbook(new Request('https://api.3dowon.com/api/sketchbook',body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),'private',gh,{});
 return {call,get saved(){return saved;},get writes(){return writes;},race(data){race=data;},fail(){upstreamError=true;}};
}
test('create and edit preserve Unicode and exact source; stale revisions never overwrite',async()=>{
 const f=fixture();assert.deepEqual(await(await f.call()).json(),{documents:[]});
 const first=await(await f.call({document:doc(),revision:null})).json();assert.ok(first.document.revision);
 assert.deepEqual(first.document.files,doc().files);
 const edit={...first.document,title:'수정',files:[{name:'main.cpp',code:'// new\n'}]};
 assert.equal((await f.call({document:edit,revision:first.document.revision})).status,200);
 assert.equal((await f.call({document:edit,revision:first.document.revision})).status,409);
 assert.equal((await f.call({document:doc(),revision:null})).status,409);
 assert.equal(f.writes,2);assert.equal(f.saved.documents[0].title,'수정');
});
test('retry preserves unrelated concurrent additions and rejects same-document races',async()=>{
 const f=fixture();f.race({version:1,documents:[{...doc('other'),revision:'other-v1'}]});
 assert.equal((await f.call({document:doc(),revision:null})).status,200);
 assert.equal(f.saved.documents.length,2);
 const g=fixture();g.race({version:1,documents:[{...doc(),revision:'newer'}]});
 assert.equal((await g.call({document:doc(),revision:null})).status,409);assert.equal(g.writes,0);
});
test('invalid filenames, duplicate files, empty source and oversize source are rejected',()=>{
 for(const name of ['../secret','/absolute','a/../b','x<script>'])assert.throws(()=>validateSketch({...doc(),files:[{name,code:'x'}]}));
 assert.throws(()=>validateSketch({...doc(),files:[doc().files[0],doc().files[0]]}));
 for(const code of ['',' '.repeat(3),'한'.repeat(70000)])assert.throws(()=>validateSketch({...doc(),files:[{name:'a.ino',code}]}));
});
test('malformed requests and failed writes do not report success',async()=>{
 const f=fixture();assert.equal((await f.call(null)).status,400);
 assert.equal((await f.call({document:doc()})).status,400);
 f.fail();assert.equal((await f.call({document:doc(),revision:null})).status,502);assert.equal(f.writes,0);
});
