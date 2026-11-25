import {largeTransfers,cleanupLargeUploads} from './large-transfers.js';
export const cleanupArchiveUploads=env=>env.TRANSFERS?cleanupLargeUploads(env.TRANSFERS,'archive-uploads/'):Promise.resolve();
export const MAX_ARCHIVE_INLINE_FILE = 25 * 1024 * 1024;
const prefix = 'archive/';
const describe = o => ({id:o.key.slice(prefix.length),filename:o.customMetadata.filename,size:Number(o.customMetadata.size??o.size),createdAt:Number(o.customMetadata.createdAt)});

// Files and their metadata live only in R2, outside Git and transfer expiry cleanup.
export async function archive(req, env, cors) {
  const json=(data,status=200)=>Response.json(data,{status,headers:{...cors,'cache-control':'no-store'}});
  const bucket=env.TRANSFERS,path=new URL(req.url).pathname;
  if(!bucket)return json({error:'파일 저장소 연결이 필요합니다.'},503);
  if(path==='/api/archive/uploads'||path.startsWith('/api/archive/uploads/'))return largeTransfers(req,bucket,json,true);
  try {
    if(path==='/api/archive' && req.method==='GET') {
      const documents=[];let cursor;
      do {
        const page=await bucket.list({prefix,cursor,include:['customMetadata']});
        documents.push(...page.objects.map(describe));
        cursor=page.truncated?page.cursor:undefined;
      }while(cursor);
      return json({documents:documents.sort((a,b)=>b.createdAt-a.createdAt),totalBytes:documents.reduce((sum,d)=>sum+d.size,0)});
    }
    if(path==='/api/archive' && req.method==='POST') {
      const limit=MAX_ARCHIVE_INLINE_FILE+65536;
      if(Number(req.headers.get('content-length'))>limit)return json({error:'파일당 최대 25MB입니다.'},413);
      if(!req.body)return json({error:'파일을 선택해주세요.'},400);
      const reader=req.body.getReader(),chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();return json({error:'파일당 최대 25MB입니다.'},413);}chunks.push(value);}
      let form;
      try{form=await new Response(new Blob(chunks),{headers:{'content-type':req.headers.get('content-type')||''}}).formData();}catch{return json({error:'올바른 파일 업로드 형식이 아닙니다.'},400);}
      const file=form.get('file');
      if(!file||typeof file.stream!=='function'||!file.name||file.name.length>240||/[\x00-\x1f\x7f]/.test(file.name))return json({error:'파일 이름을 확인해주세요. (최대 240자)'},400);
      if(file.size>MAX_ARCHIVE_INLINE_FILE)return json({error:'파일당 최대 25MB입니다.'},413);
      const id=crypto.randomUUID(),createdAt=Date.now();
      await bucket.put(prefix+id,file.stream(),{customMetadata:{filename:file.name,createdAt:String(createdAt)},httpMetadata:{contentType:'application/octet-stream'}});
      return json({document:{id,filename:file.name,size:file.size,createdAt}},201);
    }
    const match=path.match(/^\/api\/archive\/([a-f0-9-]{36})\/(file|delete)$/);
    if(match&&match[2]==='delete'&&req.method==='POST'){const object=await bucket.get(prefix+match[1]);if(object?.customMetadata?.payloadKey)await bucket.delete(object.customMetadata.payloadKey);await bucket.delete(prefix+match[1]);await bucket.delete('archive-uploads/'+match[1]);return json({ok:true});}
    if(match&&match[2]==='file'&&req.method==='GET'){
      const object=await bucket.get(prefix+match[1]);
      if(!object)return json({error:'파일을 찾을 수 없습니다.'},404);
      const payload=object.customMetadata.payloadKey?await bucket.get(object.customMetadata.payloadKey):object;
      if(!payload)return json({error:'파일을 찾을 수 없습니다.'},404);
      return new Response(payload.body,{headers:{...cors,'content-length':String(payload.size),'content-type':'application/octet-stream','content-disposition':"attachment; filename=download; filename*=UTF-8''"+encodeURIComponent(object.customMetadata.filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16)),'cache-control':'no-store','x-content-type-options':'nosniff'}});
    }
    return json({error:'Not found'},404);
  }catch{return json({error:'파일 보관 요청에 실패했습니다. 다시 시도해주세요.'},500);}
}
