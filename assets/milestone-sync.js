/* Whole-workspace sync. The GitHub blob SHA is the compare-and-swap revision. */
globalThis.MilestoneCloud=(()=>{
 const copy=value=>JSON.parse(JSON.stringify(value));
 const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
 // Opening a project is navigation, not an edit to the shared schedule.
 const fingerprint=value=>{if(!value)return 'null';const {selectedId,...data}=value;return stable(data);};
 const starter=p=>p.name==='첫 번째 프로젝트'&&(!p.description||p.description==='프로젝트 목표와 마일스톤을 기록해 보세요.')&&!p.milestones.length&&!p.history.length;
 const pristine=data=>data.projects.length===1&&starter(data.projects[0])&&(!data.mapColumns||data.mapColumns===3)&&(!data.mapView||data.mapView==='connections')&&data.roadmapIds==null;
 function migrate(local,remote){
  if(pristine(local))return copy(remote);
  const projects=remote.projects.map(copy);
  for(const p of local.projects){
   const index=projects.findIndex(r=>r.id===p.id),r=projects[index];
   if(!r){if(!starter(p))projects.push(copy(p));continue;}
   const comparable=({updatedAt,...rest})=>stable(rest);
   if(comparable(p)===comparable(r)||starter(p))continue;
   if(starter(r)){projects[index]=copy(p);continue;}
   // A pre-sync device has no common baseline. Never guess which edited copy wins.
   return null;
  }
  return {...copy(remote),...copy(local),projects,mapColumns:Math.max(local.mapColumns||3,remote.mapColumns||3)};
 }
 function create({read,apply,normalize=v=>v,storage=globalThis.localStorage,key='dowon-dashboard:v1',fetcher=globalThis.fetch.bind(globalThis),base='https://api.3dowon.com',notify=()=>{},canApply=()=>true,delay=1200}){
  const metaKey=key+':github-sync';let baseline=null,sha=null,known=false,connected=false,conflict=false,error='',running=null,timer=null,closed=false,deferred=false;
  const data=()=>normalize(copy(read()));let observed=fingerprint(data());
  try{const meta=JSON.parse(storage.getItem(metaKey));if(meta?.version===1){baseline=meta.data===null?null:normalize(meta.data);sha=meta.sha;known=true;}}catch{}
  const dirty=()=>known?fingerprint(data())!==fingerprint(baseline):!pristine(data());
  function emit(){
   let message=conflict?'다른 컴퓨터의 변경이 있어요. 내 변경은 이 기기에 보관 중입니다.':error?'이 기기에 보관 중 · '+error:!connected?'GitHub 연결 후 자동 저장됩니다.':running?'GitHub와 일정을 동기화하고 있어요…':deferred?'편집을 마치면 최신 일정을 불러옵니다.':dirty()?'이 기기에 저장됨 · GitHub 자동 저장 대기 중':'● GitHub 자동 저장 · 다른 컴퓨터에서도 이어서 볼 수 있어요.';
   notify({message,connected,conflict,busy:!!running,dirty:dirty(),error});
  }
  function remember(next,nextSha){
   const clean=next===null?null:normalize(copy(next));
   storage.setItem(metaKey,JSON.stringify({version:1,sha:nextSha,data:clean}));baseline=clean;sha=nextSha;known=true;
  }
  async function request(options){
   let response;try{response=await fetcher(base+'/api/backup',{credentials:'include',...options});}catch{throw Error('연결을 확인해 주세요. 연결되면 다시 저장합니다.');}
   if(response.status===404&&!options)return {data:null,sha:null};
   const body=await response.json().catch(()=>({}));
   if(!response.ok){if(response.status===401)connected=false;throw Object.assign(Error(body.error||'GitHub 동기화에 실패했어요.'),{status:response.status});}
   return body;
  }
  function install(next){
   const normalized=normalize(copy(next));apply(normalized);observed=fingerprint(data());
  }
  function schedule(){clearTimeout(timer);if(!closed&&!conflict)timer=setTimeout(()=>sync(),delay);}
  function changed(){const next=fingerprint(data());if(next===observed){emit();return;}observed=next;error='';schedule();emit();}
  async function run(){
   deferred=false;error='';
   const remote=await request();connected=true;
   const latest=remote.data===null?null:normalize(remote.data),local=data();
   if(latest&&fingerprint(local)===fingerprint(latest)){remember(latest,remote.sha);conflict=false;return;}
   if(conflict)return;
   if(!canApply()){deferred=true;return;}
   if(!known){
    if(latest){
     const merged=migrate(local,latest);
     if(!merged){conflict=true;return;}
     if(fingerprint(local)!==fingerprint(merged)){
      if(!pristine(local))storage.setItem(key+':before-sync',JSON.stringify(local));
      install(merged);
     }
     remember(latest,remote.sha);
    }else remember(null,null);
   }else if(sha!==remote.sha){
    if(!latest){conflict=true;error='GitHub의 저장 파일을 찾을 수 없어요.';return;}
    if(dirty()){conflict=true;return;}
    install(latest);remember(latest,remote.sha);return;
   }
   if(!dirty())return;
   const snapshot=data();
   const saved=await request({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:snapshot,sha})});
   remember(snapshot,saved.sha);
  }
  function sync(){
   clearTimeout(timer);if(closed)return Promise.resolve();if(running)return running;
   running=Promise.resolve().then(run).catch(e=>{error=e.message;if(e.status===409)conflict=true;}).finally(()=>{running=null;emit();if(dirty()&&connected&&!conflict&&!error&&!deferred)schedule();});emit();return running;
  }
  async function resolve(backup){
   if(running)await running;if(!canApply())return;
   try{
    const remote=await request();if(!remote.data)throw Error('GitHub에 저장된 일정이 없습니다.');
    const latest=normalize(remote.data),local=data();
    // Both a durable local copy and a user-downloadable copy exist before replacement.
    storage.setItem(key+':before-sync',JSON.stringify(local));backup(copy(local));
    install(latest);remember(latest,remote.sha);connected=true;conflict=false;error='';deferred=false;
   }catch(e){error=e.message;}emit();
  }
  return {changed,sync,resolve,get status(){return {connected,conflict,dirty:dirty(),sha};},close(){closed=true;clearTimeout(timer);},connect(){sessionStorage.setItem('dowon:open-milestones','1');location.href=base+'/auth/login';}};
 }
 return {create,migrate,fingerprint,pristine};
})();
try{if(sessionStorage.getItem('dowon:open-milestones')){sessionStorage.removeItem('dowon:open-milestones');location.hash='milestones';}}catch{}
