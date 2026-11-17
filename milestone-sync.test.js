import {test} from 'node:test';
import assert from 'node:assert/strict';
import './assets/milestone-sync.js';
const M=globalThis.MilestoneCloud,copy=v=>JSON.parse(JSON.stringify(v));
const project=(id='p',title='일정')=>({id,name:'전시',description:'기획',updatedAt:'2026-11-18',history:[],milestones:[{id:'m',title,start:'2026-11-01',due:'2026-11-30',status:'doing',flowColumn:2,dependsOn:[{projectId:'other',milestoneId:'prerequisite',fromPort:'right',toPort:'left'}]}]});
const workspace=()=>({version:1,selectedId:'p',projects:[project(),{...project('other'),milestones:[{id:'prerequisite',title:'선행 일정'}]}],mapColumns:5,mapView:'connections',roadmapIds:['p']});
const fresh=()=>({version:1,selectedId:'new',projects:[{id:'new',name:'첫 번째 프로젝트',description:'프로젝트 목표와 마일스톤을 기록해 보세요.',updatedAt:'today',milestones:[],history:[]}],mapColumns:3,mapView:'connections',roadmapIds:null});
function storage(){const rows=new Map();return {getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v)};}
function server(initial=workspace()){
 let data=initial&&copy(initial),sha=initial?'sha1':null,writes=0,offline=false,drop=false,beforePost=null;
 const fetcher=async(url,options={})=>{
  assert.equal(url,'https://api.3dowon.com/api/backup');assert.equal(options.credentials,'include');
  if(offline)throw Error('offline');
  if(options.method==='POST'){
   const body=JSON.parse(options.body);if(beforePost)await beforePost();
   if(body.sha!==sha)return Response.json({error:'Conflict'},{status:409});
   data=copy(body.data);sha='sha'+(++writes+1);if(drop){drop=false;throw Error('response lost');}
   return Response.json({sha,commit:'commit'+writes});
  }
  return data?Response.json({data,sha}):Response.json({error:'missing'},{status:404});
 };
 return {fetcher,get data(){return copy(data);},get writes(){return writes;},offline(v){offline=v;},drop(){drop=true;},gate(fn){beforePost=fn;}};
}
function device(t,s,initial=fresh(),cache=storage(),options={}){
 let state=copy(initial),info;
 const cloud=M.create({read:()=>state,apply:value=>{cache.setItem('dowon-dashboard:v1',JSON.stringify(value));state=value;},storage:cache,fetcher:s.fetcher,notify:v=>info=v,delay:100000,...options});
 t.after(()=>cloud.close());
 return {cloud,cache,get state(){return state;},get info(){return info;},edit(fn){fn(state);cache.setItem('dowon-dashboard:v1',JSON.stringify(state));cloud.changed();}};
}

test('fresh computer automatically restores all projects, dependencies, columns and filters without uploading its placeholder',async t=>{
 const s=server(),d=device(t,s);await d.cloud.sync();assert.deepEqual(d.state,s.data);assert.equal(s.writes,0);assert.equal(d.info.dirty,false);
});
test('first sync preserves legacy local work and fills an untouched GitHub starter project',async t=>{
 const initial=fresh();initial.projects[0].id='p';const s=server(initial),local=workspace();local.projects[0].name='첫 번째 프로젝트';
 const d=device(t,s,local);await d.cloud.sync();assert.equal(s.writes,1);assert.deepEqual(s.data,local);assert.equal(d.info.conflict,false);
});
test('different legacy projects are combined, while conflicting copies of the same project require resolution',async t=>{
 const s=server(),legacy={...workspace(),projects:[project('unique','로컬 일정')]},d=device(t,s,legacy);await d.cloud.sync();
 assert.deepEqual(s.data.projects.map(p=>p.id),['p','other','unique']);assert.ok(d.cache.getItem('dowon-dashboard:v1:before-sync'));
 const conflicting=workspace();conflicting.projects[0].milestones[0].title='이 기기의 수정';const other=device(t,s,conflicting);await other.cloud.sync();assert.equal(other.info.conflict,true);
 let backup;await other.cloud.resolve(data=>{backup=data;});assert.equal(backup.projects[0].milestones[0].title,'이 기기의 수정');assert.deepEqual(other.state,s.data);assert.equal(s.writes,1);
});
test('edits debounce into an automatic upload, navigation alone makes no commit',async t=>{
 const s=server(),d=device(t,s,workspace(),storage(),{delay:10});await d.cloud.sync();d.edit(v=>{v.selectedId='other';});await new Promise(r=>setTimeout(r,30));assert.equal(s.writes,0);
 d.edit(v=>{v.mapColumns=6;v.projects[0].milestones[0].status='done';});await new Promise(r=>setTimeout(r,50));assert.equal(s.writes,1);assert.equal(s.data.mapColumns,6);assert.equal(s.data.projects[0].milestones[0].status,'done');
});
test('offline edits survive a reload and upload on reconnect',async t=>{
 const s=server(),d=device(t,s);await d.cloud.sync();s.offline(true);d.edit(v=>{v.projects[0].milestones[0].due='2026-12-20';});await d.cloud.sync();assert.equal(d.info.dirty,true);d.cloud.close();
 const reloaded=device(t,s,JSON.parse(d.cache.getItem('dowon-dashboard:v1')),d.cache);s.offline(false);await reloaded.cloud.sync();assert.equal(s.data.projects[0].milestones[0].due,'2026-12-20');assert.equal(reloaded.info.dirty,false);
});
test('another computer receives changes and deletions automatically; simultaneous edits never overwrite',async t=>{
 const s=server(),a=device(t,s),b=device(t,s);await a.cloud.sync();await b.cloud.sync();a.edit(v=>{v.projects[0].milestones=[];});await a.cloud.sync();await b.cloud.sync();assert.equal(b.state.projects[0].milestones.length,0);
 a.edit(v=>{v.projects[0].name='A 수정';});b.edit(v=>{v.projects[0].name='B 수정';});await a.cloud.sync();await b.cloud.sync();assert.equal(b.info.conflict,true);assert.equal(b.state.projects[0].name,'B 수정');assert.equal(s.data.projects[0].name,'A 수정');
});
test('edits made during an upload remain pending and are saved next',async t=>{
 const s=server(),d=device(t,s);await d.cloud.sync();let release,started;const begin=new Promise(r=>started=r),gate=new Promise(r=>release=r);s.gate(async()=>{started();await gate;});
 d.edit(v=>{v.mapColumns=6;});const pending=d.cloud.sync();await begin;d.edit(v=>{v.mapColumns=7;});release();await pending;assert.equal(d.info.dirty,true);await d.cloud.sync();assert.equal(s.data.mapColumns,7);assert.equal(d.info.dirty,false);
});
test('lost upload response is acknowledged on retry without duplicating commits',async t=>{
 const s=server(),d=device(t,s);await d.cloud.sync();s.drop();d.edit(v=>{v.mapColumns=8;});await d.cloud.sync();assert.equal(d.info.dirty,true);await d.cloud.sync();assert.equal(d.info.conflict,false);assert.equal(d.info.dirty,false);assert.equal(s.writes,1);
});
test('remote updates wait while a form or drag is active',async t=>{
 const s=server(),a=device(t,s);let editing=false;const b=device(t,s,fresh(),storage(),{canApply:()=>!editing});await a.cloud.sync();await b.cloud.sync();editing=true;a.edit(v=>{v.mapColumns=9;});await a.cloud.sync();await b.cloud.sync();assert.equal(b.state.mapColumns,5);assert.match(b.info.message,/편집을 마치면/);editing=false;await b.cloud.sync();assert.equal(b.state.mapColumns,9);
});
test('new repository file is created with null revision and authentication failures keep local work',async t=>{
 const s=server(null),d=device(t,s,workspace());await d.cloud.sync();assert.equal(s.writes,1);
 const denied=device(t,s,workspace(),storage(),{fetcher:async()=>Response.json({error:'로그인 만료'},{status:401})});denied.edit(v=>{v.mapColumns=10;});await denied.cloud.sync();assert.equal(denied.info.connected,false);assert.equal(denied.state.mapColumns,10);assert.match(denied.info.message,/로그인 만료/);
});
