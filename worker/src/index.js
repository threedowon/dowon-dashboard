import {archive} from './archive.js';
import {sketchbook} from './sketchbook.js';

import {library} from './library.js';
import {ideas} from './ideas.js';
import {transfers, cleanupTransfers} from './transfers.js';
import {desktopLogin, desktopGrant, signalNative, signalBackups, cleanupSignalAuth} from './signal-tester.js';
import {hardware,hardwareProjects} from './hardware.js';
const repo="threedowon/dowon-dashboard-data",file="projects.json";
const j=(v,s=200,h={})=>new Response(JSON.stringify(v),{status:s,headers:{"content-type":"application/json","cache-control":"no-store",...h}});
const ck=r=>Object.fromEntries((r.headers.get("cookie")||"").split(";").map(x=>x.trim().split("=")).filter(x=>x.length>1).map(([k,...v])=>[k,decodeURIComponent(v.join("="))]));
const cookie=(k,v,extra)=>k+"="+encodeURIComponent(v)+"; Path=/; Secure; HttpOnly; "+extra;
const b64=v=>btoa(String.fromCharCode(...new Uint8Array(v))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const deb64=v=>Uint8Array.from(atob(v.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
const rand=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
async function aes(env){return crypto.subtle.importKey("raw",deb64(env.SESSION_KEY),{name:"AES-GCM"},false,["encrypt","decrypt"])}
async function seal(env,obj){const iv=crypto.getRandomValues(new Uint8Array(12)),out=await crypto.subtle.encrypt({name:"AES-GCM",iv},await aes(env),new TextEncoder().encode(JSON.stringify(obj)));return b64(iv)+"."+b64(out)}
async function unseal(env,enc){const [iv,v]=String(enc||"").split(".");if(!iv||!v)throw Error("Missing session");return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:deb64(iv)},await aes(env),deb64(v))))}
async function gh(path,token,options={}){return fetch("https://api.github.com"+path,{...options,headers:{"accept":"application/vnd.github+json","authorization":"Bearer "+token,"user-agent":"dowon-dashboard","x-github-api-version":"2022-11-28",...(options.headers||{})}})}
export default {async scheduled(event,env,ctx){ctx.waitUntil(Promise.all([cleanupTransfers(env),cleanupSignalAuth(env)]));},async fetch(req,env){
 const u=new URL(req.url),origin=req.headers.get("origin"),site=env.DASHBOARD_ORIGIN||"https://threedowon.github.io",home=env.DASHBOARD_URL||"https://threedowon.github.io/dowon-dashboard/";
 const cors=origin===site?{"access-control-allow-origin":site,"access-control-allow-credentials":"true","access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type","vary":"Origin"}:{};
 const cb=u.origin+"/auth/callback";
 try{
 const cookies=ck(req);
 if(u.pathname.startsWith('/native/signal-tester/'))return signalNative(req,env,{seal,unseal,gh});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 // Public team workbook, deliberately separate from owner-only dashboard APIs.
 if(u.pathname==='/api/hardware-sheet'||u.pathname.startsWith('/api/hardware-sheet/')){
   if(req.method!=='GET'&&origin!==site)return j({error:'Origin denied'},403,cors);
   return hardware(req,env,cors);
 }
 if(u.pathname==="/health")return j({ok:true,configured:!!(env.GITHUB_CLIENT_ID&&env.GITHUB_CLIENT_SECRET&&env.SESSION_KEY)});
 if(u.pathname==="/auth/login"){
 if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET||!env.SESSION_KEY)return j({error:"Secrets missing"},503);
 const desktop=desktopLogin(u);
 const state=rand(),verifier=rand(),digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(verifier));
 const qs=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,state,redirect_uri:cb,code_challenge:b64(digest),code_challenge_method:"S256"});
 const res=new Response(null,{status:302,headers:{location:"https://github.com/login/oauth/authorize?"+qs,"cache-control":"no-store"}});
 res.headers.append("Set-Cookie",cookie("__Host-dowon_oauth",await seal(env,{state,verifier,desktop,expires:Date.now()+600000}),"SameSite=Lax; Max-Age=600"));return res;
 }
 if(u.pathname==="/auth/callback"){
 const data=await unseal(env,cookies["__Host-dowon_oauth"]);
 if(data.expires<Date.now()||data.state!==u.searchParams.get("state"))return j({error:"OAuth state mismatch"},403);
 const tr=await fetch("https://github.com/login/oauth/access_token",{method:"POST",headers:{"accept":"application/json","content-type":"application/json"},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET.trim(),code:u.searchParams.get("code"),redirect_uri:cb,code_verifier:data.verifier})});
 const auth=await tr.json();if(!auth.access_token){const known=["incorrect_client_credentials","redirect_uri_mismatch","bad_verification_code","incorrect_code_verifier","expired_token","access_denied"];return j({error:"OAuth exchange failed",reason:known.includes(auth.error)?auth.error:"upstream_error",secretFormatValid:/^[a-f0-9]{40}$/i.test(env.GITHUB_CLIENT_SECRET.trim())},502);}
 const who=await gh("/user",auth.access_token);if(!who.ok)throw Error("User verification failed");
 const user=await who.json();if(user.login.toLowerCase()!==(env.ALLOWED_GITHUB_LOGIN||"threedowon").toLowerCase())return j({error:"Access denied"},403);
 if(data.desktop){
 const location=await desktopGrant(env,data.desktop,auth,user.login,seal);
 // Desktop refresh tokens must not rotate a token also stored in a browser session.
 const res=new Response(null,{status:302,headers:{location,'cache-control':'no-store','referrer-policy':'no-referrer'}});
 res.headers.append('Set-Cookie',cookie('__Host-dowon_oauth','','SameSite=Lax; Max-Age=0'));return res;
 }
 const res=new Response(null,{status:302,headers:{location:home,"cache-control":"no-store"}});
 res.headers.append("Set-Cookie",cookie("__Host-dowon_session",await seal(env,{token:auth.access_token,login:user.login,expires:Date.now()+Math.min((auth.expires_in||28800)*1000,28800000)}),"SameSite=Lax; Max-Age=28800"));
 res.headers.append("Set-Cookie",cookie("__Host-dowon_oauth","","SameSite=Lax; Max-Age=0"));return res;
 }
 if(u.pathname==="/auth/logout"&&req.method==="POST"){
 if(origin!==site)return j({error:"Origin denied"},403,cors);
 return j({ok:true},200,{"set-cookie":cookie("__Host-dowon_session","","SameSite=Lax; Max-Age=0"),...cors});
 }
 if(u.pathname.startsWith("/api/")){
 const nativeDownload=req.method==='GET'&&/^\/api\/(?:transfers|archive)\/[a-f0-9-]{36}\/file$/.test(u.pathname)&&!origin&&req.headers.get('sec-fetch-site')==='same-site'&&req.headers.get('referer')?.startsWith(site+'/');
 if(origin!==site&&!nativeDownload)return j({error:"Origin denied"},403,cors);
 let session;try{session=await unseal(env,cookies["__Host-dowon_session"])}catch{return j({error:"로그인이 필요합니다."},401,cors)}
 if(session.expires<Date.now()||session.login.toLowerCase()!==(env.ALLOWED_GITHUB_LOGIN||"threedowon").toLowerCase())return j({error:"로그인 만료"},401,cors);
 if(u.pathname==="/api/me")return j({login:session.login},200,cors);
 if(u.pathname.startsWith('/api/signal-tester/'))return signalBackups(req,session.token,gh,{headers:cors});
 if(u.pathname==='/api/hardware-projects')return hardwareProjects(req,env,cors);
 if(u.pathname==='/api/archive'||u.pathname.startsWith('/api/archive/'))return archive(req,env,cors);
 if(u.pathname==='/api/transfers'||u.pathname.startsWith('/api/transfers/'))return transfers(req,env,cors);
 if(u.pathname==='/api/wirenest'||u.pathname.startsWith('/api/wirenest/'))return library(req,session.token,gh,cors,'wnest');
 if(u.pathname==='/api/library'||u.pathname.startsWith('/api/library/'))return library(req,session.token,gh,cors);
 if(u.pathname==='/api/sketchbook')return sketchbook(req,session.token,gh,cors);
 if(u.pathname==='/api/ideas'||u.pathname.startsWith('/api/ideas/'))return ideas(req,session.token,gh,cors);
 if(u.pathname==="/api/backup"&&req.method==="GET"){
 const r=await gh("/repos/"+repo+"/contents/"+file,session.token);
 if(r.status===404)return j({error:"백업 파일 또는 저장소 접근 권한을 확인해주세요."},404,cors);
 if(!r.ok)return j({error:"GitHub read failed ("+r.status+")"},502,cors);
 const f=await r.json(),bytes=Uint8Array.from(atob(f.content.replace(/\s/g,"")),c=>c.charCodeAt(0));
 return j({data:JSON.parse(new TextDecoder().decode(bytes)),sha:f.sha},200,cors);
 }
 if(u.pathname==="/api/backup"&&req.method==="POST"){
 if(!(req.headers.get("content-type")||"").includes("application/json"))return j({error:"JSON required"},415,cors);
 const body=await req.json(),raw=JSON.stringify(body.data);
 if(!body.data||!Array.isArray(body.data.projects)||raw.length>1000000)return j({error:"Invalid or too large"},400,cors);
 const r=await gh("/repos/"+repo+"/contents/"+file,session.token);
 if(!r.ok&&r.status!==404)return j({error:"GitHub read failed ("+r.status+")"},502,cors);
 const old=r.ok?await r.json():null;
 if((old?.sha||null)!==(body.sha||null))return j({error:"GitHub 백업이 변경됐습니다. 최신 백업을 확인해주세요.",conflict:true},409,cors);
 const content=btoa(Array.from(new TextEncoder().encode(raw)).map(x=>String.fromCharCode(x)).join(""));
 const put=await gh("/repos/"+repo+"/contents/"+file,session.token,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({message:"Dashboard backup "+new Date().toISOString(),content,...(old?{sha:old.sha}:{})})});
 if(put.status===409||put.status===422)return j({error:"백업이 변경되었습니다. 최신 백업을 다시 확인해주세요.",conflict:true},409,cors);
 if(!put.ok)return j({error:"GitHub write failed ("+put.status+")"},502,cors);
 const result=await put.json();return j({ok:true,sha:result.content.sha,commit:result.commit.sha},200,cors);
 }
 }
 return j({error:"Not found"},404,cors);
 }catch(e){return j({error:e.message||String(e)},e.status||500,cors)}
}};
