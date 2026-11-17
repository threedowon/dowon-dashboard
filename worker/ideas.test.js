import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ideas,boardPath,validateBoard,MAX_IMAGE} from './src/ideas.js';
import '../assets/ideas-board.js';
import '../assets/ideas-sync.js';

function fixture(){
 let head='c0',seq=0,race=false,writes=0;
 const trees=new Map([['t0',{}]]),commits=new Map([['c0','t0']]),parents=new Map(),blobs=new Map();
 const gh=async(path,token,options={})=>{
  assert.equal(token,'test-token');const body=options.body&&JSON.parse(options.body);
  if(path.endsWith('/git/ref/heads/main'))return Response.json({object:{sha:head}});
  if(path.includes('/git/commits/'))return Response.json({tree:{sha:commits.get(path.split('/').pop())}});
  if(path.includes('/contents/')){
   const url=new URL('https://github.test'+path),file=url.pathname.split('/contents/')[1],data=trees.get(commits.get(url.searchParams.get('ref')||head))[file];
   if(data===undefined)return new Response('',{status:404});
   return options.headers?.accept?.includes('raw')?new Response(data):Response.json({content:Buffer.from(data).toString('base64')});
  }
  if(path.endsWith('/git/blobs')){const data=Buffer.from(body.content,'base64'),sha=createHash('sha1').update(data).digest('hex');blobs.set(sha,data);return Response.json({sha});}
  if(path.endsWith('/git/trees')){const sha='t'+(++seq),tree={...trees.get(body.base_tree)};for(const entry of body.tree)tree[entry.path]=entry.content??blobs.get(entry.sha);trees.set(sha,tree);return Response.json({sha});}
  if(path.endsWith('/git/commits')){const sha='c'+(++seq);commits.set(sha,body.tree);parents.set(sha,body.parents[0]);return Response.json({sha});}
  if(path.endsWith('/git/refs/heads/main')){
   assert.equal(body.force,false);
   if(race){race=false;const next='race'+(++seq);commits.set(next,commits.get(head));head=next;return new Response('',{status:422});}
   if(parents.get(body.sha)!==head)return new Response('',{status:422});head=body.sha;writes++;return Response.json({object:{sha:head}});
  }
  throw Error('Unexpected GitHub path '+path);
 };
 const fetcher=(url,options={})=>ideas(new Request(url,options),'test-token',gh,{});
 return {fetcher,request:(path,options={})=>fetcher('https://api.3dowon.com/api/ideas'+path,options),race(){race=true;},get writes(){return writes;}};
}
const note=(id='n')=>({id,kind:'note',title:'메모',text:'원래 내용',x:0,y:0,width:300,ratio:1.5});
const board=(id='p')=>({projectId:id,name:'첫 번째 프로젝트',items:[note()],view:{x:40,y:40,zoom:.8}});
const post=(board,revision=null,mutationId=crypto.randomUUID())=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({board,revision,mutationId})});
function local(records=[]){const rows=new Map(records.map(r=>[r.projectId,structuredClone(r)]));return {async all(){return [...rows.values()].map(r=>structuredClone(r));},async get(id){const r=rows.get(id);return r&&structuredClone(r);},async put(r){rows.set(r.projectId,structuredClone(r));}};}
const client=(f,cache=local())=>IdeaCloud.create(cache,{fetcher:f.fetcher,delay:100000});
const png=new Blob([Buffer.from('89504e470d0a1a0a0000000000000000','hex')],{type:'image/png'});

test('board and index commit together, stale updates fail, replay is idempotent, CAS retries',async()=>{
 const f=fixture();f.race();const first=await f.request('/boards/p',post(board(),null,'once'));assert.equal(first.status,200);
 const saved=(await first.json()).board;assert.equal(f.writes,1);
 assert.equal((await f.request('/boards/p',post(board(),null,'once'))).status,200);assert.equal(f.writes,1);
 assert.equal((await f.request('/boards/p',post(board(),null))).status,409);
 const next=board();next.items[0].text='변경';assert.equal((await f.request('/boards/p',post(next,saved.revision))).status,200);
 assert.equal((await(await f.request('/boards/p')).json()).board.items[0].text,'변경');
 assert.equal((await(await f.request('')).json()).boards[0].itemCount,1);
});
test('validation rejects unsafe or oversized data before any commit',async()=>{
 const f=fixture();for(const item of [{...note(),kind:'image',url:'javascript:alert(1)'},{...note(),x:Infinity},{...note(),kind:'image',asset:{sha:'../x',type:'image/svg+xml'}}]){
  assert.throws(()=>validateBoard({...board(),items:[item]}));
 }
 const bad=new FormData();bad.set('file',new Blob(['not png'],{type:'image/png'}),'a.png');
 assert.equal((await f.request('/images',{method:'POST',body:bad})).status,400);
 assert.equal((await f.request('/images',{method:'POST',headers:{'content-length':String(MAX_IMAGE+65537)},body:'x'})).status,413);
 assert.equal(f.writes,0);assert.match(await boardPath('../x'),/^ideas\/boards\/[a-f0-9]{64}\.json$/);
});
test('two computers round trip binary images, video links and layout through private GitHub',async()=>{
 const f=fixture(),a=client(f);await a.all();const r=board();r.items.push({...note('image'),kind:'image',blob:png},{...note('video'),kind:'embed',url:'https://youtu.be/M7lc1UVf-VE'});
 await a.put(r);await a.flush();const b=client(f);assert.equal((await b.all()).length,1);const restored=await b.get('p');
 assert.equal(restored.items.length,3);assert.deepEqual(restored.view,r.view);assert.deepEqual(Buffer.from(await restored.items[1].blob.arrayBuffer()),Buffer.from(await png.arrayBuffer()));
 assert.match(restored.items[1].asset.sha,/^[a-f0-9]{40}$/);assert.match(restored.items[2].embed,/youtube-nocookie/);await b.flush();
});
test('legacy local cards merge with cloud sample cards without replacing either',async()=>{
 const f=fixture();await f.request('/boards/p',post(board()));const existing=board();existing.items=[note('local')];
 const a=client(f,local([existing]));await a.all();await a.flush();const r=(await(await f.request('/boards/p')).json()).board;
 assert.deepEqual(r.items.map(i=>i.id),['n','local']);
});
test('offline changes survive reload and reconnect without losing local image bytes',async()=>{
 const f=fixture(),cache=local();let offline=true;
 const a=IdeaCloud.create(cache,{delay:100000,fetcher:(...args)=>{if(offline)throw Error('offline');return f.fetcher(...args);}});
 await a.all();const r=board();r.items.push({...note('image'),kind:'image',blob:png});await a.put(r);await a.flush();
 assert.equal((await cache.get('p'))._dirty,true);assert.equal(f.writes,0);
 offline=false;const b=client(f,cache);await b.all();await b.flush();assert.equal((await cache.get('p'))._dirty,false);
 assert.equal((await(await f.request('/boards/p')).json()).board.items.length,2);
});
test('simultaneous edits keep local work, resolve creates a separate copy',async()=>{
 const f=fixture();await f.request('/boards/p',post(board()));const a=client(f),b=client(f);await a.all();await b.all();const ar=await a.get('p'),br=await b.get('p');
 ar.items[0].text='A';br.items[0].text='B';await a.put(ar);await b.put(br);await a.flush();await b.flush();
 assert.equal(b.hasConflict('p'),true);assert.equal((await b.get('p')).items[0].text,'B');
 assert.equal((await b.resolve('p')).items[0].text,'A');await b.flush();const rows=(await(await f.request('')).json()).boards;
 assert.equal(rows.length,2);const copy=rows.find(r=>r.projectId!=='p');assert.match(copy.name,/복사/);
 assert.equal((await(await f.request('/boards/'+copy.projectId)).json()).board.items[0].text,'B');
});
test('edits during image upload save the newest board on the next flush',async()=>{
 const f=fixture();let release,started;const gate=new Promise(r=>release=r),begin=new Promise(r=>started=r);
 const a=IdeaCloud.create(local(),{delay:100000,fetcher:async(url,options)=>{if(url.endsWith('/images')&&options.method==='POST'){started();await gate;}return f.fetcher(url,options);}});
 await a.all();const r=board();r.items.push({...note('image'),kind:'image',blob:png});await a.put(r);const saving=a.flush();await begin;
 r.items[0].text='더 최신 내용';await a.put(r);release();await saving;await a.flush();
 assert.equal((await(await f.request('/boards/p')).json()).board.items[0].text,'더 최신 내용');
});
test('lost save response is reconciled by mutation ID without false conflict or duplicate',async()=>{
 const f=fixture();let drop=true;const cache=local();const a=IdeaCloud.create(cache,{delay:100000,fetcher:async(url,options)=>{const result=await f.fetcher(url,options);if(url.includes('/boards/')&&options?.method==='POST'&&drop){drop=false;throw Error('response lost');}return result;}});
 await a.all();await a.put(board());await a.flush();assert.equal((await cache.get('p'))._dirty,true);
 await a.all();await a.flush();assert.equal(a.hasConflict('p'),false);assert.equal((await cache.get('p'))._dirty,false);assert.equal(f.writes,1);
});
