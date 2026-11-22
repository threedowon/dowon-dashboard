// Native credentials are scoped to Signal Tester. GitHub tokens never leave the Worker.
const root='/repos/threedowon/dowon-dashboard-data/contents/signal-tester/';
const idPattern=/^[a-f0-9]{32}$/;
const secretPattern=/^[A-Za-z0-9_-]{43}$/;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'cache-control':'no-store',...headers}});
const encode=value=>btoa(Array.from(new TextEncoder().encode(JSON.stringify(value)),b=>String.fromCharCode(b)).join(''));
const decode=value=>JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\s/g,'')),c=>c.charCodeAt(0))));
const random=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
async function challenge(value){return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function body(req,limit=1000000){
 if(!(req.headers.get('content-type')||'').startsWith('application/json'))fail('JSON required',415);
 const reader=req.body?.getReader();if(!reader)fail('JSON required');let size=0,chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail('설정 파일은 1MB 이하여야 합니다.',413);}chunks.push(value);}
 try{return JSON.parse(await new Blob(chunks).text());}catch{fail('Invalid JSON');}
}
export function desktopLogin(url){
 if(url.searchParams.get('app')!=='signal-tester')return null;
 const data=Object.fromEntries(['port','state','challenge','device','name'].map(k=>[k,url.searchParams.get(k)]));
 if(!/^\d{1,5}$/.test(data.port||'')||+data.port<1||+data.port>65535||!secretPattern.test(data.state||'')||!secretPattern.test(data.challenge||'')||!idPattern.test(data.device||'')||!data.name?.trim()||data.name.length>80)fail('Invalid desktop login');
 return data;
}
export async function desktopGrant(env,desktop,auth,login,seal){
 const code=random(),key='signal-tester/auth/grants/'+await digest(code);
 await env.TRANSFERS.put(key,await seal(env,{...desktop,auth,login,accessExpires:Date.now()+(auth.expires_in??180*86400)*1000,expires:Date.now()+300000}),{customMetadata:{expires:String(Date.now()+300000)}});
 return 'http://127.0.0.1:'+Number(desktop.port)+'/cloud/callback?'+new URLSearchParams({code,state:desktop.state});
}
// Only settings fields can be stored; activity, measurements and credentials are excluded.
export function settings(raw){
 const pick=(item,keys)=>{if(!item||typeof item!=='object'||Array.isArray(item))fail('Invalid settings');const out={};for(const k of keys.split(' '))if(Object.hasOwn(item,k)){if(item[k]!==null&& !['string','number','boolean'].includes(typeof item[k]))fail('Invalid setting value');out[k]=item[k];}return out;};
 if(!raw||raw.version!==1||!Array.isArray(raw.targets)||raw.targets.length>100||!Array.isArray(raw.signals)||raw.signals.length>500)fail('Invalid workspace');
 const data={version:1,targets:raw.targets.map(t=>pick(t,'id name type host port device baudrate dataBits parity stopBits bindHost bindPort remoteHost remotePort broadcast')),signals:raw.signals.map(s=>pick(s,'id name key value cooldown shortcut')),activeTarget:typeof raw.activeTarget==='string'?raw.activeTarget:null};
 if(raw.sensors!==undefined){if(!Array.isArray(raw.sensors)||raw.sensors.length>32)fail('Invalid sensors');data.sensors=raw.sensors.map(s=>{const out=pick(s,'id name sourceId parser field unit staleSeconds');if(!Array.isArray(s.rules)||s.rules.length>16)fail('Invalid rules');out.rules=s.rules.map(r=>pick(r,'id signalId targetId op threshold hysteresis hold valueMode enabled repeatSeconds'));return out;});}
 return data;
}
async function readBackup(id,token,gh){
 if(!idPattern.test(id))fail('Invalid backup ID');const r=await gh(root+id+'.json',token);
 if(r.status===404)return {backup:null,sha:null};if(r.status===401)fail('대시보드 계정을 다시 연결하세요.',401);if(!r.ok)fail('백업을 읽지 못했습니다. 잠시 후 다시 시도하세요.',502);
 const file=await r.json(),backup=decode(file.content);return {backup,sha:file.sha};
}
export async function signalBackups(req,token,gh,{device=null,headers={}}={}){
 try{
 const path=new URL(req.url).pathname.replace(/^\/(?:native|api)\/signal-tester/,'');
 if(path==='/backups'&&req.method==='GET'){
  const r=await gh(root.slice(0,-1),token);if(r.status===404)return json({backups:[]},200,headers);if(!r.ok)fail('백업 목록을 읽지 못했습니다.',502);
  const files=await r.json();if(!Array.isArray(files))fail('Invalid backup directory',502);
  const ids=files.filter(f=>/^[a-f0-9]{32}\.json$/.test(f.name)).slice(0,100).map(f=>f.name.slice(0,-5));
  const backups=[];
  // Bound GitHub concurrency for accounts with several PCs.
  for(let i=0;i<ids.length;i+=5)for(const entry of await Promise.all(ids.slice(i,i+5).map(id=>readBackup(id,token,gh))))if(entry.backup){const {id,name,updatedAt}=entry.backup;backups.push({id,name,updatedAt,sha:entry.sha});}
  return json({backups:backups.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))},200,headers);
 }
 const match=path.match(/^\/backups\/([a-f0-9]{32})$/);
 if(!match)return json({error:'Not found'},404,headers);
 const id=match[1];
 if(req.method==='GET')return json(await readBackup(id,token,gh),200,headers);
 if(req.method!=='POST'||device!==id)return json({error:'이 PC의 백업만 변경할 수 있습니다.'},403,headers);
 const input=await body(req);if(typeof input.name!=='string'||!input.name.trim()||input.name.length>80||!(input.sha===null||typeof input.sha==='string'))fail('Invalid backup metadata');
 const data=settings(input.data),previous=await readBackup(id,token,gh);
 if(previous.sha!==input.sha)return json({error:'백업이 변경되었습니다. 저장된 백업을 확인하세요.',conflict:true},409,headers);
 const backup={version:1,id,name:input.name.trim(),updatedAt:new Date().toISOString(),data};
 const r=await gh(root+id+'.json',token,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({message:'Signal Tester settings backup',content:encode(backup),...(previous.sha?{sha:previous.sha}:{})})});
 if([409,422].includes(r.status))return json({error:'백업이 변경되었습니다. 다시 확인하세요.',conflict:true},409,headers);
 if(!r.ok)fail('자동 백업에 실패했습니다. 이 PC의 설정은 유지됩니다.',502);
 const saved=await r.json();return json({sha:saved.content.sha,updatedAt:backup.updatedAt},200,headers);
 }catch(e){return json({error:e.status?e.message:'백업 처리에 실패했습니다.'},e.status||502,headers);}
}
export async function signalNative(req,env,{seal,unseal,gh}){
 try{
 if(req.headers.has('origin'))return json({error:'Origin denied'},403);
 if(!env.TRANSFERS)fail('서비스 저장소가 준비되지 않았습니다.',503);
 const path=new URL(req.url).pathname,bucket=env.TRANSFERS;
 if(path==='/native/signal-tester/exchange'&&req.method==='POST'){
  const input=await body(req,4096);if(!secretPattern.test(input.code||'')||!secretPattern.test(input.verifier||''))fail('Invalid authorization',403);
  const key='signal-tester/auth/grants/'+await digest(input.code),object=await bucket.get(key);if(!object)fail('로그인을 다시 시작하세요.',401);
  const grant=await unseal(env,await object.text());if(grant.expires<Date.now()||grant.challenge!==await challenge(input.verifier))fail('로그인 확인에 실패했습니다.',403);
  // Conditional claim prevents two exchanges from redeeming the same grant.
  if(!await bucket.put(key,'used',{onlyIf:{etagMatches:object.etag},customMetadata:{expires:String(Date.now())}}))fail('이미 사용된 로그인입니다.',401);
  const secret=random(),session={login:grant.login,device:grant.device,name:grant.name,auth:grant.auth,expires:Date.now()+180*86400000,accessExpires:grant.accessExpires};
  await bucket.put('signal-tester/auth/sessions/'+await digest(secret),await seal(env,session),{customMetadata:{expires:String(session.expires)}});
  await bucket.delete(key);return json({credential:secret,login:session.login,device:session.device});
 }
 const secret=(req.headers.get('authorization')||'').replace(/^Bearer /,'');if(!secretPattern.test(secret))fail('대시보드 계정을 연결하세요.',401);
 const key='signal-tester/auth/sessions/'+await digest(secret),object=await bucket.get(key);if(!object)fail('대시보드 계정을 다시 연결하세요.',401);
 let session=await unseal(env,await object.text());
 if(session.expires<Date.now()||session.login?.toLowerCase()!==(env.ALLOWED_GITHUB_LOGIN||'threedowon').toLowerCase())fail('로그인 만료',401);
 if(path==='/native/signal-tester/disconnect'&&req.method==='POST'){await bucket.delete(key);return json({ok:true});}
 if(session.accessExpires<Date.now()+60000){
  if(!session.auth.refresh_token)fail('대시보드 계정을 다시 연결하세요.',401);
  if(session.refreshingUntil>Date.now())fail('로그인을 갱신하고 있습니다. 잠시 후 다시 시도하세요.',503);
  const locked=await bucket.put(key,await seal(env,{...session,refreshingUntil:Date.now()+30000}),{onlyIf:{etagMatches:object.etag},customMetadata:{expires:String(session.expires)}});
  if(!locked)fail('로그인을 갱신하고 있습니다.',503);
  const r=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{'accept':'application/json','content-type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET.trim(),grant_type:'refresh_token',refresh_token:session.auth.refresh_token})});
  const auth=await r.json();if(!auth.access_token)fail('대시보드 계정을 다시 연결하세요.',401);
  session={...session,auth,refreshingUntil:0,accessExpires:Date.now()+(auth.expires_in||28800)*1000};
  if(!await bucket.put(key,await seal(env,session),{onlyIf:{etagMatches:locked.etag},customMetadata:{expires:String(session.expires)}}))fail('연결이 해제되었습니다.',401);
 }
 if(path==='/native/signal-tester/me'&&req.method==='GET')return json({login:session.login,device:session.device});
 return signalBackups(req,session.auth.access_token,gh,{device:session.device});
 }catch(e){return json({error:e.status?e.message:'대시보드 연결을 확인하세요.'},e.status||401);}
}
export async function cleanupSignalAuth(env){
 if(!env.TRANSFERS)return;let cursor;
 do{const page=await env.TRANSFERS.list({prefix:'signal-tester/auth/',cursor,include:['customMetadata']});const keys=page.objects.filter(o=>Number(o.customMetadata?.expires)<Date.now()).map(o=>o.key);if(keys.length)await env.TRANSFERS.delete(keys);cursor=page.truncated?page.cursor:undefined;}while(cursor);
}
