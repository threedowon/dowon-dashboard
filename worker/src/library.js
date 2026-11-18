const root = '/repos/threedowon/dowon-dashboard-data';
const indexPath = 'library/index.json';
export const MAX_PDF = 10 * 1024 * 1024;
const fail = (message, status=400) => { throw Object.assign(new Error(message), {status}); };
const base64 = bytes => { let s=''; for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(s); };
export function metadata(title, tags) {
  if(typeof title!=='string'||!title.trim()||title.trim().length>200)fail('제목은 1~200자로 입력해주세요.');
  if(!Array.isArray(tags)||tags.length>20||tags.some(t=>typeof t!=='string'||t.trim().length>40))fail('태그는 40자 이하, 최대 20개까지 가능합니다.');
  return {title:title.trim(),tags:[...new Set(tags.map(t=>t.trim().normalize('NFC')).filter(Boolean))]};
}
export async function library(req, token, gh, cors) {
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
    if(path==='/api/library'&&req.method==='GET')return json((await snapshot()).data);
    const match=path.match(/^\/api\/library\/([a-f0-9-]{36})(\/file|\/delete)?$/);
    if(match&&match[2]==='/file'&&req.method==='GET'){
      const {data}=await snapshot(),doc=data.documents.find(d=>d.id===match[1]);
      if(!doc)fail('문서를 찾을 수 없습니다.',404);
      const r=await gh(root+'/contents/library/files/'+doc.id+'.pdf',token,{headers:{accept:'application/vnd.github.raw+json'}});
      if(!r.ok)fail('PDF를 불러오지 못했습니다.',502);
      return new Response(r.body,{headers:{...cors,'content-type':'application/pdf','content-disposition':"attachment; filename=\"document.pdf\"; filename*=UTF-8''"+encodeURIComponent(doc.filename),'cache-control':'no-store','x-content-type-options':'nosniff'}});
    }
    let upload=null,edit=null,blob=null,remove=null,batch=null;
    if(path==='/api/library/batch'&&req.method==='POST'){
      const body=await req.json();
      if(!['delete','tags'].includes(body.action)||!Array.isArray(body.documents)||!body.documents.length||body.documents.length>1000)fail('선택한 문서를 확인해주세요.');
      if(body.documents.some(d=>!d||typeof d.id!=='string'||!/^([a-f0-9-]{36})$/.test(d.id)||typeof d.revision!=='string'||!d.revision)||new Set(body.documents.map(d=>d.id)).size!==body.documents.length)fail('선택한 문서 정보가 올바르지 않습니다.');
      batch={action:body.action,documents:body.documents,tags:body.action==='tags'?metadata('tags',body.tags).tags:[]};
      if(batch.action==='tags'&&!batch.tags.length)fail('추가할 태그를 입력해주세요.');
    }else if(path==='/api/library'&&req.method==='POST'){
      if(Number(req.headers.get('content-length'))>MAX_PDF+65536)fail('PDF 한 개당 10MB 이하로 올려주세요.',413);
      const form=await req.formData(),file=form.get('file');
      if(!file||typeof file.arrayBuffer!=='function'||!file.name.toLowerCase().endsWith('.pdf'))fail('PDF 파일을 선택해주세요.');
      if(file.size>MAX_PDF)fail('PDF 한 개당 10MB 이하로 올려주세요.',413);
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')fail('올바른 PDF 파일이 아닙니다.');
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
      const snap=await snapshot();let doc,changed=[];
      if(batch){
        changed=batch.documents.map(item=>{
          const found=snap.data.documents.find(d=>d.id===item.id);
          if(!found||found.revision!==item.revision)fail('선택한 문서 중 변경되거나 삭제된 파일이 있습니다. 새로고침 후 다시 선택해주세요. 아무 문서도 변경하지 않았습니다.',409);
          return found;
        });
        if(batch.action==='delete'){const ids=new Set(changed.map(d=>d.id));snap.data.documents=snap.data.documents.filter(d=>!ids.has(d.id));}
        else for(const d of changed){const merged=[...new Set([...d.tags,...batch.tags])];if(merged.length>20)fail('“'+d.title+'”의 태그가 20개를 초과합니다. 아무 문서도 변경하지 않았습니다.');Object.assign(d,{tags:metadata(d.title,merged).tags,revision:crypto.randomUUID(),updatedAt:new Date().toISOString()});}
      }else if(upload){if(snap.data.documents.length>=1000)fail('자료실은 최대 1,000개 문서를 지원합니다.');doc=upload;snap.data.documents.unshift(doc);}
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
      if(upload)tree.push({path:'library/files/'+upload.id+'.pdf',mode:'100644',type:'blob',sha:blob.sha});
      if(remove)tree.push({path:'library/files/'+remove.id+'.pdf',mode:'100644',type:'blob',sha:null});
      if(batch?.action==='delete')for(const d of changed)tree.push({path:'library/files/'+d.id+'.pdf',mode:'100644',type:'blob',sha:null});
      const built=await checked(await call('/git/trees',{base_tree:snap.tree,tree}));
      const commit=await checked(await call('/git/commits',{message:batch?'Bulk PDF '+batch.action:upload?'Add PDF to library':remove?'Delete PDF from library':'Update PDF title and tags',tree:built.sha,parents:[snap.head]}));
      const saved=await call('/git/refs/heads/main',{sha:commit.sha,force:false},'PATCH');
      if(saved.status===409||saved.status===422)continue;
      await checked(saved);return json(batch?{documents:batch.action==='tags'?changed:[],deleted:batch.action==='delete'?changed.map(d=>d.id):[],commit:commit.sha}:remove?{deleted:remove.id,commit:commit.sha}:{document:doc,commit:commit.sha});
    }
    fail('다른 저장 작업과 겹쳤습니다. 잠시 후 다시 저장해주세요.',409);
  }catch(e){return json({error:e.status?e.message:'자료실 요청을 처리하지 못했습니다. 다시 시도해주세요.'},e.status||500);}
}
