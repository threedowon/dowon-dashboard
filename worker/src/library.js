const root = '/repos/threedowon/dowon-dashboard-data';
export const MAX_PDF = 10 * 1024 * 1024;
const fail = (message, status=400) => { throw Object.assign(new Error(message), {status}); };
const base64 = bytes => { let s=''; for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(s); };
export function metadata(title, tags) {
  if(typeof title!=='string'||!title.trim()||title.trim().length>200)fail('제목은 1~200자로 입력해주세요.');
  if(!Array.isArray(tags)||tags.length>20||tags.some(t=>typeof t!=='string'||t.trim().length>40))fail('태그는 40자 이하, 최대 20개까지 가능합니다.');
  return {title:title.trim(),tags:[...new Set(tags.map(t=>t.trim().normalize('NFC')).filter(Boolean))]};
}
export async function library(req, token, gh, cors, kind='pdf') {
  const backup=kind==='wnest', collection=backup?'wirenest':'library', extension=backup?'wnest':'pdf';
  const indexPath=collection+'/index.json', api='/api/'+collection, limit=backup?25*1024*1024:MAX_PDF;
  const sizeError=backup?'백업 한 개당 25MB 이하로 올려주세요.':'PDF 한 개당 10MB 이하로 올려주세요.';
  const json=(v,status=200)=>Response.json(v,{status,headers:{...cors,'cache-control':'no-store'}});
  const call=(path,body,method='POST')=>gh(root+path,token,body===undefined?{}:{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const checked=async r=>{if(!r.ok)fail('GitHub 자료실 요청 실패 ('+r.status+'). 다시 연결하거나 잠시 후 시도해주세요.',502);return r.json();};
  async function snapshot(){
    // Pin reads to a commit so a concurrent writer cannot mix index and tree versions.
    const ref=await checked(await call('/git/ref/heads/main'));
    const head=await checked(await call('/git/commits/'+ref.object.sha));
    const r=await call('/contents/'+indexPath+'?ref='+ref.object.sha);
    let data={version:1,documents:[]};
    if(r.status!==404){const f=await checked(r);data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(f.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));}
    if(data.version!==1||!Array.isArray(data.documents))fail('자료실 목록 형식을 확인해주세요.',502);
    return {head:ref.object.sha,tree:head.tree.sha,data};
  }
  try {
    const path=new URL(req.url).pathname;
    if(path===api&&req.method==='GET')return json((await snapshot()).data);
    const match=path.match(new RegExp('^'+api+'/([a-f0-9-]{36})(/file|/delete)?$'));
    if(match&&match[2]==='/file'&&req.method==='GET'){
      const {data}=await snapshot(),doc=data.documents.find(d=>d.id===match[1]);
      if(!doc)fail('문서를 찾을 수 없습니다.',404);
      const r=await gh(root+'/contents/'+collection+'/files/'+doc.id+'.'+extension,token,{headers:{accept:'application/vnd.github.raw+json'}});
      if(!r.ok)fail('파일을 불러오지 못했습니다.',502);
      return new Response(r.body,{headers:{...cors,'content-type':backup?'application/octet-stream':'application/pdf','content-disposition':"attachment; filename=\"download\"; filename*=UTF-8''"+encodeURIComponent(doc.filename),'cache-control':'no-store','x-content-type-options':'nosniff'}});
    }
    let upload=null,edit=null,blob=null,remove=null;
    if(path===api&&req.method==='POST'){
      if(Number(req.headers.get('content-length'))>limit+65536)fail(sizeError,413);
      const form=await req.formData(),file=form.get('file');
      if(!file||typeof file.arrayBuffer!=='function'||!file.name.toLowerCase().endsWith('.'+extension))fail(backup?'.wnest 파일을 선택해주세요.':'PDF 파일을 선택해주세요.');
      if(file.size>limit)fail(sizeError,413);
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(backup)validateWireNest(bytes);
      else if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')fail('올바른 PDF 파일이 아닙니다.');
      upload={id:crypto.randomUUID(),...metadata(form.get('title'),JSON.parse(form.get('tags')||'[]')),filename:file.name.slice(0,200),size:file.size,createdAt:new Date().toISOString(),revision:crypto.randomUUID()};
      blob=await checked(await call('/git/blobs',{content:base64(bytes),encoding:'base64'}));
    }else if(match&&match[2]==='/delete'&&req.method==='POST'){
      const body=await req.json();
      if(typeof body.revision!=='string'||!body.revision)fail('문서 버전을 확인한 뒤 다시 삭제해주세요.');
      remove={id:match[1],revision:body.revision};
    }else if(match&&!match[2]&&req.method==='POST'){
      const body=await req.json();edit={id:match[1],...metadata(body.title,body.tags),revision:body.revision};
    }else return json({error:'Not found'},404);
    for(let attempt=0;attempt<3;attempt++){
      const snap=await snapshot();let doc;
      if(upload){if(snap.data.documents.length>=1000)fail('자료실은 최대 1,000개 문서를 지원합니다.');doc=upload;snap.data.documents.unshift(doc);}
      else {
        const change=remove||edit;doc=snap.data.documents.find(d=>d.id===change.id);
        if(!doc)fail('문서를 찾을 수 없습니다.',404);
        if(doc.revision!==change.revision)fail('다른 기기에서 수정된 문서입니다. 새로고침 후 다시 시도해주세요.',409);
        if(remove)snap.data.documents=snap.data.documents.filter(d=>d.id!==remove.id);
        else Object.assign(doc,{title:edit.title,tags:edit.tags,revision:crypto.randomUUID(),updatedAt:new Date().toISOString()});
      }
      const content=JSON.stringify(snap.data);
      if(new TextEncoder().encode(content).length>900000)fail('자료실 목록 저장 용량을 초과했습니다.');
      const tree=[{path:indexPath,mode:'100644',type:'blob',content}];
      if(upload)tree.push({path:collection+'/files/'+upload.id+'.'+extension,mode:'100644',type:'blob',sha:blob.sha});
      if(remove)tree.push({path:collection+'/files/'+remove.id+'.'+extension,mode:'100644',type:'blob',sha:null});
      const built=await checked(await call('/git/trees',{base_tree:snap.tree,tree}));
      const commit=await checked(await call('/git/commits',{message:(upload?'Add ':remove?'Delete ':'Update ')+(backup?'WireNest backup':'PDF library document'),tree:built.sha,parents:[snap.head]}));
      const saved=await call('/git/refs/heads/main',{sha:commit.sha,force:false},'PATCH');
      if(saved.status===409||saved.status===422)continue;
      await checked(saved);return json(remove?{deleted:remove.id,commit:commit.sha}:{document:doc,commit:commit.sha});
    }
    fail('다른 저장 작업과 겹쳤습니다. 잠시 후 다시 저장해주세요.',409);
  }catch(e){return json({error:e.status?e.message:'자료실 요청을 처리하지 못했습니다. 다시 시도해주세요.'},e.status||500);}
}

export function validateWireNest(bytes) {
  let data;
  try { data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
  catch { fail('올바른 WireNest JSON 파일이 아닙니다.'); }
  const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
  if(!record(data)||data.app!=='wirenest'||!Number.isInteger(data.v)||data.v<1||
     !record(data.boards)||!record(data.nodes)||!record(data.wires))fail('WireNest에서 저장한 .wnest 파일을 선택해주세요.');
  return data;
}
