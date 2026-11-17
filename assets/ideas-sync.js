/* Local-first, revision-checked GitHub persistence for reference boards. */
globalThis.IdeaCloud={
 create(local,{fetcher=globalThis.fetch.bind(globalThis),delay=1200,base='https://api.3dowon.com'}={}){
  const jobs=new Map(),assets=new WeakMap(),listeners=new Set();let connected=false,networkError='';
  const clone=r=>({...r,view:{...r.view},items:r.items.map(i=>({...i}))});
  const emit=id=>listeners.forEach(fn=>fn(id));
  const job=r=>{if(!jobs.has(r.projectId))jobs.set(r.projectId,{record:r,revision:r._cloudRevision||null,dirty:!!r._dirty||(!r._cloudRevision&&r.items.length>0),conflict:!!r._conflict,gen:0,timer:null,running:null,error:'',mutation:r._mutationId||crypto.randomUUID()});return jobs.get(r.projectId);};
  async function request(path,options={}){
   let response;try{response=await fetcher(base+path,{credentials:'include',...options});}catch{throw Object.assign(Error('연결을 확인해 주세요. 이 기기의 변경은 보관됩니다.'),{status:0});}
   if(!response.ok){const body=await response.json().catch(()=>({}));if(response.status===401)connected=false;throw Object.assign(Error(body.error||'GitHub 저장에 실패했어요.'),{status:response.status});}
   connected=true;networkError='';return response;
  }
  async function persist(j){j.record={...j.record,_cloudRevision:j.revision,_dirty:j.dirty,_conflict:j.conflict,_mutationId:j.mutation};await local.put(clone(j.record));}
  const path=id=>'/api/ideas/boards/'+encodeURIComponent(id);
  async function hydrate(board,cached){
   const record={...board,items:[],_cloudRevision:board.revision,_dirty:false,_conflict:false};
   // Limit simultaneous image downloads; never discard cached pixels on a transient failure.
   for(let i=0;i<board.items.length;i+=4){const batch=await Promise.all(board.items.slice(i,i+4).map(async item=>{
    if(!item.asset)return IdeaModel.cleanItem(item);
    const previous=cached?.items.find(old=>old.id===item.id&&old.asset?.sha===item.asset.sha);
    const blob=previous?.blob||await(await request('/api/ideas/images/'+item.asset.sha+'/'+item.asset.type.split('/')[1])).blob();
    assets.set(blob,item.asset);return IdeaModel.cleanItem({...item,blob});
   }));record.items.push(...batch);}
   return record;
  }
  function schedule(j){clearTimeout(j.timer);if(j.conflict||!j.dirty||!connected)return;j.timer=setTimeout(()=>{j.timer=null;save(j);},delay);}
  async function save(j){
   if(j.running)return j.running;if(!j.dirty||j.conflict||!connected)return;
   const generation=j.gen,snapshot=clone(j.record),mutationId=j.mutation;
   j.error='';emit(snapshot.projectId);
   j.running=(async()=>{
    try{
     const items=[];
     for(const item of snapshot.items){const {blob,...clean}=item;
      if(blob){let asset=assets.get(blob);if(!asset){const body=new FormData();body.set('file',blob,'image.'+blob.type.split('/')[1]);asset=(await(await request('/api/ideas/images',{method:'POST',body})).json()).asset;assets.set(blob,asset);}clean.asset=asset;item.asset=asset;}
      items.push(clean);
     }
     const board={projectId:snapshot.projectId,name:snapshot.name,items,view:snapshot.view,sampleVersion:snapshot.sampleVersion||null};
     const result=await(await request(path(snapshot.projectId),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({board,revision:j.revision,mutationId})})).json();
     j.revision=result.board.revision;
     if(j.gen===generation){j.record={...snapshot,updatedAt:result.board.updatedAt};j.dirty=false;}else j.dirty=true;
     await persist(j);
    }catch(error){j.error=error.message;j.conflict=error.status===409;j.dirty=true;await persist(j).catch(()=>{});}
    finally{j.running=null;emit(snapshot.projectId);if(j.gen!==generation&&!j.error)schedule(j);}
   })();emit(snapshot.projectId);return j.running;
  }
  async function get(id){
   let j=jobs.get(id);if(!j){const record=await local.get(id);if(record)j=job(record);}
   if(j?.running)await j.running;
   if(!connected)return j?clone(j.record):undefined;
   try{
    const remote=(await(await request(path(id))).json()).board;
    if(!remote){if(j){schedule(j);return clone(j.record);}return undefined;}
    if(j?.dirty&&j.mutation===remote.mutationId){j.revision=remote.revision;j.dirty=false;j.conflict=false;j.error='';await persist(j);emit(id);return clone(j.record);}
    if(j?.dirty&&j.revision&&j.revision!==remote.revision){j.conflict=true;j.error='다른 컴퓨터의 변경이 있습니다.';await persist(j);emit(id);return clone(j.record);}
    if(j?.dirty&&j.revision===remote.revision){schedule(j);return clone(j.record);}
    if(j&&!j.dirty&&j.revision===remote.revision)return clone(j.record);
    const generation=j?.gen,record=await hydrate(remote,j?.record);
    if(j&&j.gen!==generation)return clone(j.record);
    if(j?.dirty&&!j.revision){
     // Migrate pre-sync local cards without losing cloud cards or colliding IDs.
     for(const item of j.record.items){const same=record.items.find(i=>i.id===item.id);if(!same)record.items.push(item);else if(JSON.stringify({...same,blob:undefined})!==JSON.stringify({...item,blob:undefined})||(!item.asset&&item.blob))record.items.push({...item,id:crypto.randomUUID(),title:(item.title+' (이 기기)').slice(0,200)});}
     record.view=j.record.view;record._dirty=true;
    }
    if(!j)j=job(record);j.record=record;j.revision=remote.revision;j.dirty=!!record._dirty;j.conflict=false;j.error='';await persist(j);schedule(j);emit(id);return clone(j.record);
   }catch(error){networkError=error.message;if(j)j.error=error.message;emit(id);if(j)return clone(j.record);throw error;}
  }
  async function all(){
   const stored=await local.all();for(const r of stored)job(r);
   let summaries=[];
   try{summaries=(await(await request('/api/ideas')).json()).boards;}catch(error){networkError=error.message;emit(null);return [...jobs.values()].map(j=>clone(j.record));}
   for(const j of jobs.values())if(j.dirty&&!j.conflict){const remote=summaries.find(r=>r.projectId===j.record.projectId);if(!remote)schedule(j);else if(j.revision===remote.revision)schedule(j);else await get(j.record.projectId);}
   const records=[...jobs.values()].map(j=>clone(j.record));
   for(const s of summaries)if(!jobs.has(s.projectId))records.push({...s,items:[],view:{x:40,y:40,zoom:1},_stub:true});
   emit(null);return records;
  }
  async function put(record){
   let j=jobs.get(record.projectId);if(!j)j=job({...record,items:[]});
   j.record=clone(record);j.gen++;j.dirty=true;j.mutation=crypto.randomUUID();j.error='';await persist(j);schedule(j);emit(record.projectId);
  }
  async function resolve(id){
   const j=jobs.get(id),remote=(await(await request(path(id))).json()).board;if(!remote)throw Error('GitHub에 보드가 없습니다.');
   const record=await hydrate(remote,j?.record);
   if(j?.dirty){const copy={...clone(j.record),projectId:crypto.randomUUID(),name:(j.record.name+' (이 기기 복사)').slice(0,200),_cloudRevision:null,_dirty:true,_conflict:false};const backup=job(copy);await persist(backup);schedule(backup);}
   const next=j||job(record);next.record=record;next.revision=remote.revision;next.dirty=false;next.conflict=false;next.error='';await persist(next);emit(id);return clone(next.record);
  }
  function message(id){const j=jobs.get(id);if(j?.conflict)return '다른 컴퓨터의 변경이 있어요. 내 변경은 이 기기에 보관 중입니다.';if(j?.error)return '이 기기에 저장됨 · '+j.error;if(!connected)return '이 기기에 저장됨 · GitHub 연결 후 자동 동기화됩니다.';if(j?.running)return 'GitHub에 이미지와 보드를 저장 중…';if(j?.dirty)return '이 기기에 저장됨 · GitHub 자동 저장 대기 중';return '● GitHub 자동 저장 · 다른 컴퓨터에서도 이어서 볼 수 있어요.';}
  return {all,get,put,message,isCloud:true,get connected(){return connected;},hasConflict:id=>!!jobs.get(id)?.conflict,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},resolve,
   async retry(id){await all();const j=jobs.get(id);if(j&&!j.conflict){clearTimeout(j.timer);await save(j);}return get(id);},
   async flush(){for(const j of jobs.values()){clearTimeout(j.timer);await save(j);}},
   connect(){sessionStorage.setItem('dowon:open-ideas','1');location.href=base+'/auth/login';}
  };
 }
};

try{if(sessionStorage.getItem('dowon:open-ideas')){sessionStorage.removeItem('dowon:open-ideas');location.hash='ideas';}}catch{}
