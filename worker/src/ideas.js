const root='/repos/threedowon/dowon-dashboard-data',indexPath='ideas/index.json';
export const MAX_IMAGE=20*1024*1024;
const types=['image/png','image/jpeg','image/webp','image/gif','image/avif'];
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
const text=value=>new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\s/g,'')),c=>c.charCodeAt(0)));
const url=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
export async function boardPath(id){return 'ideas/boards/'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(id))),b=>b.toString(16).padStart(2,'0')).join('')+'.json';}
export function validateBoard(value){
 if(!value||typeof value.projectId!=='string'||!value.projectId||value.projectId.length>200||typeof value.name!=='string'||!value.name.trim()||value.name.length>200)fail('프로젝트 이름과 ID를 확인해 주세요.');
 if(!Array.isArray(value.items)||value.items.length>1000)fail('보드에는 최대 1,000개 자료를 저장할 수 있어요.');
 const ids=new Set(),items=value.items.map(item=>{
  if(!item||typeof item.id!=='string'||!item.id||item.id.length>200||ids.has(item.id))fail('카드 ID가 올바르지 않습니다.');ids.add(item.id);
  if(!['note','image','link','embed','video'].includes(item.kind)||typeof item.title!=='string'||item.title.length>200||typeof item.text!=='string'||item.text.length>20000)fail('카드 내용을 확인해 주세요.');
  if(!finite(item.x,-100000,100000)||!finite(item.y,-100000,100000)||!finite(item.width,180,1200)||!finite(item.ratio,.1,10))fail('카드 위치와 크기를 확인해 주세요.');
  const clean={id:item.id,kind:item.kind,title:item.title,text:item.text,x:item.x,y:item.y,width:item.width,ratio:item.ratio};
  if(item.kind==='image'&&item.asset){if(!/^[a-f0-9]{40}$/.test(item.asset.sha)||!types.includes(item.asset.type))fail('이미지 저장 정보를 확인해 주세요.');clean.asset={sha:item.asset.sha,type:item.asset.type};}
  else if(item.kind!=='note'){if(typeof item.url!=='string'||item.url.length>4000||!url(item.url))fail('지원하지 않는 자료 주소입니다.');clean.url=item.url;}
  return clean;
 });
 const view=value.view;
 if(!view||!finite(view.x,-1e7,1e7)||!finite(view.y,-1e7,1e7)||!finite(view.zoom,.2,2))fail('보드 배율을 확인해 주세요.');
 const board={version:1,projectId:value.projectId,name:value.name.trim(),items,view:{x:view.x,y:view.y,zoom:view.zoom},sampleVersion:typeof value.sampleVersion==='string'?value.sampleVersion.slice(0,100):null};
 if(new TextEncoder().encode(JSON.stringify(board)).length>900000)fail('보드의 메모·링크 용량이 너무 큽니다. 프로젝트를 나누어 주세요.',413);
 return board;
}
export function validImage(bytes,type){
 const ascii=(a,b)=>new TextDecoder().decode(bytes.subarray(a,b));
 return type==='image/png'?bytes.length>8&&[137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n):type==='image/jpeg'?bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/gif'?['GIF87a','GIF89a'].includes(ascii(0,6)):type==='image/webp'?ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP':type==='image/avif'?ascii(4,8)==='ftyp'&&/avif|avis/.test(ascii(8,32)):false;
}
export async function ideas(req,token,gh,cors){
 const json=(v,status=200)=>Response.json(v,{status,headers:{...cors,'cache-control':'no-store'}});
 const call=(path,body,method='POST')=>gh(root+path,token,body===undefined?{}:{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const checked=async r=>{if(!r.ok)fail('GitHub 보드 요청에 실패했어요. 잠시 후 다시 시도해 주세요.',502);return r.json();};
 const read=async(path,head)=>{const r=await call('/contents/'+path+'?ref='+head);return r.status===404?null:JSON.parse(text((await checked(r)).content));};
 async function snapshot(){const ref=await checked(await call('/git/ref/heads/main')),head=ref.object.sha,commit=await checked(await call('/git/commits/'+head)),index=await read(indexPath,head)||{version:1,boards:[]};if(index.version!==1||!Array.isArray(index.boards))fail('보드 목록을 읽지 못했어요.',502);return {head,tree:commit.tree.sha,index};}
 async function commit(snap,entries,message){const tree=await checked(await call('/git/trees',{base_tree:snap.tree,tree:entries})),saved=await checked(await call('/git/commits',{message,tree:tree.sha,parents:[snap.head]}));const ref=await call('/git/refs/heads/main',{sha:saved.sha,force:false},'PATCH');if([409,422].includes(ref.status))return false;await checked(ref);return saved.sha;}
 try{
  const path=new URL(req.url).pathname;
  if(path==='/api/ideas'&&req.method==='GET')return json((await snapshot()).index);
  const asset=path.match(/^\/api\/ideas\/images\/([a-f0-9]{40})\/(png|jpeg|gif|webp|avif)$/);
  if(asset&&req.method==='GET'){
   const r=await gh(root+'/contents/ideas/images/'+asset[1]+'.'+asset[2],token,{headers:{accept:'application/vnd.github.raw+json'}});
   if(!r.ok)fail('이미지를 불러오지 못했어요.',r.status===404?404:502);
   return new Response(r.body,{headers:{...cors,'content-type':'image/'+asset[2],'cache-control':'private, max-age=86400','x-content-type-options':'nosniff'}});
  }
  if(path==='/api/ideas/images'&&req.method==='POST'){
   if(Number(req.headers.get('content-length'))>MAX_IMAGE+65536)fail('이미지는 20MB 이하만 지원합니다.',413);
   const form=await req.formData(),file=form.get('file');if(!file||typeof file.arrayBuffer!=='function'||!types.includes(file.type))fail('지원하지 않는 이미지입니다.');
   if(file.size>MAX_IMAGE)fail('이미지는 20MB 이하만 지원합니다.',413);
   const bytes=new Uint8Array(await file.arrayBuffer());if(!validImage(bytes,file.type))fail('올바른 이미지 파일이 아닙니다.');
   const blob=await checked(await call('/git/blobs',{content:encode(bytes),encoding:'base64'})),asset={sha:blob.sha,type:file.type};
   for(let i=0;i<3;i++){const snap=await snapshot(),saved=await commit(snap,[{path:'ideas/images/'+blob.sha+'.'+file.type.split('/')[1],mode:'100644',type:'blob',sha:blob.sha}],'Save reference image');if(saved)return json({asset});}
   fail('다른 저장 작업과 겹쳤어요. 다시 시도해 주세요.',409);
  }
  const match=path.match(/^\/api\/ideas\/boards\/([^/]+)$/);if(!match)return json({error:'Not found'},404);
  const id=decodeURIComponent(match[1]);if(!id||id.length>200)fail('프로젝트 ID를 확인해 주세요.');const file=await boardPath(id);
  if(req.method==='GET'){const snap=await snapshot(),board=await read(file,snap.head);return board?json({board}):json({board:null});}
  if(req.method!=='POST')return json({error:'Not found'},404);
  if(Number(req.headers.get('content-length'))>1100000)fail('보드 용량을 초과했어요.',413);
  const raw=await req.text();if(new TextEncoder().encode(raw).length>1100000)fail('보드 용량을 초과했어요.',413);
  const body=JSON.parse(raw),board=validateBoard(body.board);
  if(board.projectId!==id||!(body.revision===null||typeof body.revision==='string')||typeof body.mutationId!=='string'||!body.mutationId||body.mutationId.length>100)fail('저장 요청 형식을 확인해 주세요.');
  for(let i=0;i<3;i++){
   const snap=await snapshot(),old=snap.index.boards.find(b=>b.projectId===id);
   if(old?.mutationId===body.mutationId)return json({board:await read(file,snap.head)});
   if((old?.revision||null)!==body.revision)fail('다른 컴퓨터에서 수정된 보드입니다. GitHub 내용을 확인해 주세요.',409);
   if(!old&&snap.index.boards.length>=1000)fail('프로젝트 보드는 최대 1,000개까지 가능합니다.');
   const next={...board,revision:crypto.randomUUID(),mutationId:body.mutationId,updatedAt:new Date().toISOString()};
   const summary={projectId:id,name:next.name,revision:next.revision,mutationId:next.mutationId,updatedAt:next.updatedAt,itemCount:next.items.length};
   if(old)Object.assign(old,summary);else snap.index.boards.push(summary);
   const entries=[{path:indexPath,mode:'100644',type:'blob',content:JSON.stringify(snap.index)},{path:file,mode:'100644',type:'blob',content:JSON.stringify(next)}];
   if(await commit(snap,entries,'Save reference board: '+board.name))return json({board:next});
  }
  fail('다른 저장 작업과 겹쳤어요. 다시 시도해 주세요.',409);
 }catch(e){return json({error:e.status?e.message:'보드 요청을 처리하지 못했어요. 다시 시도해 주세요.'},e.status||500);}
}
