import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './src/index.js';
import {settings,desktopLogin} from './src/signal-tester.js';

class Bucket {
 objects=new Map();sequence=0;
 async get(key){const v=this.objects.get(key);return v?{...v,text:async()=>v.value}:null;}
 async put(key,value,options={}){const old=this.objects.get(key);if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;const v={value,etag:String(++this.sequence),customMetadata:options.customMetadata};this.objects.set(key,v);return v;}
 async delete(keys){for(const key of [].concat(keys))this.objects.delete(key);}
 async list({prefix}){return {objects:[...this.objects].filter(([key])=>key.startsWith(prefix)).map(([key,v])=>({key,...v})),truncated:false};}
}
const origin='https://dashboard.3dowon.com';
function fixture(initialTTL=28800){
 const env={SESSION_KEY:Buffer.alloc(32,7).toString('base64'),GITHUB_CLIENT_ID:'test',GITHUB_CLIENT_SECRET:'test-secret',DASHBOARD_ORIGIN:origin,DASHBOARD_URL:origin+'/',ALLOWED_GITHUB_LOGIN:'threedowon',TRANSFERS:new Bucket()};
 const files=new Map();let seq=0,refreshes=0;
 const call=(path,options={})=>worker.fetch(new Request('https://api.3dowon.com'+path,options),env);
 const send=(path,body,credential)=>call(path,{method:'POST',headers:{'content-type':'application/json',...(credential?{authorization:'Bearer '+credential}:{})},body:JSON.stringify(body)});
 const get=(path,credential)=>call(path,{headers:{authorization:'Bearer '+credential}});
 const fetcher=async(url,options={})=>{
  const u=String(url);
  if(u.includes('/login/oauth/access_token')){const input=JSON.parse(options.body);if(input.grant_type)refreshes++;return Response.json({access_token:'github-secret',refresh_token:'github-refresh-secret',expires_in:input.grant_type?28800:initialTTL});}
  if(u.endsWith('/user'))return Response.json({login:'threedowon'});
  const root='https://api.github.com/repos/threedowon/dowon-dashboard-data/contents/signal-tester';
  assert.ok(u.startsWith(root),u);
  if(u===root)return Response.json([...files].map(([name])=>({name})));
  const name=u.slice(root.length+1);
  if(options.method==='PUT'){const input=JSON.parse(options.body),previous=files.get(name);if(previous?.sha!==input.sha)return new Response('',{status:409});const saved={sha:'sha'+(++seq),content:input.content};files.set(name,saved);return Response.json({content:{sha:saved.sha}});}
  return files.has(name)?Response.json(files.get(name)):new Response('',{status:404});
 };
 async function login(device='a'.repeat(32)){
  const verifier='v'.repeat(43),challenge=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
  const r=await call('/auth/login?'+new URLSearchParams({app:'signal-tester',port:'12345',state:'s'.repeat(43),challenge,device,name:'작업 PC'}));assert.equal(r.status,302);
  const cookie=r.headers.get('set-cookie').split(';')[0],state=new URL(r.headers.get('location')).searchParams.get('state');
  const callback=await call('/auth/callback?'+new URLSearchParams({state,code:'github-code'}),{headers:{cookie}});
  assert.equal(callback.status,302);assert.ok(!callback.headers.get('set-cookie').includes('__Host-dowon_session='));
  const url=new URL(callback.headers.get('location'));assert.equal(url.origin,'http://127.0.0.1:12345');
  assert.equal(url.searchParams.get('state'),'s'.repeat(43));
  return {code:url.searchParams.get('code'),verifier};
 }
 return {env,files,call,send,get,fetcher,login,get refreshes(){return refreshes;}};
}
const workspace={version:1,targets:[{id:'udp',name:'UDP',type:'udp',bindHost:'127.0.0.1',bindPort:9000,remoteHost:'127.0.0.1',remotePort:9001}],signals:[],sensors:[],activeTarget:'udp'};
test('desktop OAuth uses PKCE, single-use exchange and credentials scoped to settings only',async()=>{
 const f=fixture(),original=globalThis.fetch;globalThis.fetch=f.fetcher;
 try{
  const grant=await f.login();assert.equal((await f.send('/native/signal-tester/exchange',{...grant,verifier:'x'.repeat(43)})).status,403);
  const [a,b]=await Promise.all([f.send('/native/signal-tester/exchange',grant),f.send('/native/signal-tester/exchange',grant)]);
  assert.deepEqual([a.status,b.status].sort(),[200,401]);const auth=await(a.status===200?a:b).json();assert.ok(auth.credential);assert.ok(!JSON.stringify(auth).includes('github-secret'));
  assert.equal((await f.get('/native/signal-tester/me',auth.credential)).status,200);
  assert.equal((await f.call('/api/backup',{headers:{origin,authorization:'Bearer '+auth.credential}})).status,401);
  assert.equal((await f.call('/native/signal-tester/me',{headers:{origin,authorization:'Bearer '+auth.credential}})).status,403);
  assert.equal((await f.send('/native/signal-tester/backups/'+'b'.repeat(32),{name:'other',sha:null,data:workspace},auth.credential)).status,403);
  await f.send('/native/signal-tester/disconnect',{},auth.credential);
  assert.equal((await f.get('/native/signal-tester/me',auth.credential)).status,401);
 }finally{globalThis.fetch=original;}
});
test('two PCs keep independent backups, share restore reads and reject stale writes',async()=>{
 const f=fixture(),original=globalThis.fetch;globalThis.fetch=f.fetcher;
 try{
  const a=await(await f.send('/native/signal-tester/exchange',await f.login())).json();
  const b=await(await f.send('/native/signal-tester/exchange',await f.login('b'.repeat(32)))).json();
  const route='/native/signal-tester/backups/'+a.device;
  const saved=await f.send(route,{name:'PC A',sha:null,data:{...workspace,events:['private measurement'],credential:'secret'}},a.credential);assert.equal(saved.status,200);
  const sha=(await saved.json()).sha;
  assert.equal((await f.send(route,{name:'PC A',sha:null,data:workspace},a.credential)).status,409);
  const downloaded=await(await f.get(route,b.credential)).json();assert.deepEqual(downloaded.backup.data,workspace);assert.equal(downloaded.sha,sha);
  assert.equal((await f.send('/native/signal-tester/backups/'+b.device,{name:'PC B',sha:null,data:{...workspace,targets:[]}},b.credential)).status,200);
  const list=await(await f.get('/native/signal-tester/backups',a.credential)).json();assert.equal(list.backups.length,2);
  assert.equal((await f.send(route,{name:'PC A',sha,data:{...workspace,signals:[{value:{token:'never'}}]}},a.credential)).status,400);
  assert.equal((await f.send(route,{name:'PC A',sha,data:workspace,padding:'x'.repeat(1000001)},a.credential)).status,413);
 }finally{globalThis.fetch=original;}
});
test('invalid loopback login inputs and unknown fields cannot widen native access',()=>{
 assert.throws(()=>desktopLogin(new URL('https://api.3dowon.com/auth/login?app=signal-tester&port=evil')));
 assert.deepEqual(settings({...workspace,token:'secret',events:[123]}),workspace);
 assert.throws(()=>settings({...workspace,targets:[{name:{secret:'value'}}]}));
});

test('expired desktop access refreshes server-side without exposing GitHub credentials',async()=>{
 const f=fixture(-1),original=globalThis.fetch;globalThis.fetch=f.fetcher;
 try{
  const auth=await(await f.send('/native/signal-tester/exchange',await f.login())).json();
  const [a,b]=await Promise.all([f.get('/native/signal-tester/me',auth.credential),f.get('/native/signal-tester/me',auth.credential)]);
  assert.ok([200,503].includes(a.status));assert.ok([200,503].includes(b.status));assert.equal(f.refreshes,1);
  const ready=await f.get('/native/signal-tester/me',auth.credential);assert.equal(ready.status,200);
  assert.ok(!(await ready.text()).includes('github-secret'));assert.equal(f.refreshes,1);
 }finally{globalThis.fetch=original;}
});
