export const MAX_TRANSFER = 25 * 1024 * 1024;
const prefix = 'transfers/';
const active = object => Number(object.customMetadata?.expiresAt) > Date.now();
const describe = object => ({id:object.key.slice(prefix.length),filename:object.customMetadata.filename,size:object.size,createdAt:Number(object.customMetadata.createdAt),expiresAt:Number(object.customMetadata.expiresAt)});

export async function cleanupTransfers(env) {
  if (!env.TRANSFERS) return;
  let cursor;
  do {
    const page = await env.TRANSFERS.list({prefix,cursor,include:['customMetadata']});
    const expired = page.objects.filter(o=>!active(o)).map(o=>o.key);
    if(expired.length) await env.TRANSFERS.delete(expired);
    cursor = page.truncated ? page.cursor : undefined;
  } while(cursor);
}

export async function transfers(req, env, cors) {
  const json=(data,status=200)=>Response.json(data,{status,headers:{...cors,'cache-control':'no-store'}});
  if(!env.TRANSFERS)return json({error:'파일 전달 저장소 연결이 필요합니다. 관리자 설정에서 R2를 연결해주세요.'},503);
  const bucket=env.TRANSFERS, url=new URL(req.url);
  try {
    if(url.pathname==='/api/transfers' && req.method==='GET') {
      const documents=[];let cursor;
      do {
        const page=await bucket.list({prefix,cursor,include:['customMetadata']});
        documents.push(...page.objects.filter(active).map(describe));
        cursor=page.truncated?page.cursor:undefined;
      }while(cursor);
      return json({documents:documents.sort((a,b)=>b.createdAt-a.createdAt)});
    }
    if(url.pathname==='/api/transfers' && req.method==='POST') {
      // Bound the request before parsing multipart so forged/missing Content-Length cannot exhaust memory.
      if(Number(req.headers.get('content-length'))>MAX_TRANSFER+65536)return json({error:'파일 한 개당 최대 25MB입니다.'},413);
      if(!req.body)return json({error:'파일을 선택해주세요.'},400);
      const reader=req.body.getReader(),chunks=[];let size=0;
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_TRANSFER+65536){await reader.cancel();return json({error:'파일 한 개당 최대 25MB입니다.'},413);}chunks.push(value);}
      const form=await new Response(new Blob(chunks),{headers:{'content-type':req.headers.get('content-type')||''}}).formData();
      const file=form.get('file'),minutes=Number(form.get('minutes'));
      if(!file || typeof file.arrayBuffer!=='function' || !file.name || file.name.length>240 || /[\x00-\x1f\x7f]/.test(file.name))return json({error:'파일 이름을 확인해주세요. (최대 240자)'},400);
      if(file.size>MAX_TRANSFER)return json({error:'파일 한 개당 최대 25MB입니다.'},413);
      if(![1,5,10].includes(minutes))return json({error:'보관 시간을 확인해주세요.'},400);
      const createdAt=Date.now(),expiresAt=createdAt+minutes*60000,id=crypto.randomUUID();
      await bucket.put(prefix+id,file.stream(),{customMetadata:{filename:file.name,createdAt:String(createdAt),expiresAt:String(expiresAt)},httpMetadata:{contentType:'application/octet-stream'}});
      return json({document:{id,filename:file.name,size:file.size,createdAt,expiresAt}},201);
    }
    const match=url.pathname.match(/^\/api\/transfers\/([a-f0-9-]{36})\/(file|delete)$/);
    if(match && match[2]==='delete' && req.method==='POST'){await bucket.delete(prefix+match[1]);return json({ok:true});}
    if(match && match[2]==='file' && req.method==='GET'){
      const object=await bucket.get(prefix+match[1]);
      if(!object)return json({error:'삭제되었거나 만료된 파일입니다.'},404);
      if(!active(object)){await object.body.cancel();await bucket.delete(object.key);return json({error:'보관 시간이 지나 받을 수 없습니다.'},410);}
      return new Response(object.body,{headers:{...cors,'content-type':'application/octet-stream','content-disposition':"attachment; filename=download; filename*=UTF-8''"+encodeURIComponent(object.customMetadata.filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16)),'cache-control':'no-store','x-content-type-options':'nosniff'}});
    }
    return json({error:'Not found'},404);
  }catch{return json({error:'파일 전달 요청에 실패했습니다. 잠시 후 다시 시도해주세요.'},500);}
}
