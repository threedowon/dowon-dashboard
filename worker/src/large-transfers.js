export const MAX_LARGE = 5 * 1024 ** 3;
export const PART_SIZE = 8 * 1024 ** 2;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
async function read(req,limit){
  if(Number(req.headers.get('content-length'))>limit)fail('요청 크기를 초과했습니다.',413);
  const reader=req.body?.getReader();if(!reader)return new Uint8Array();
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail('요청 크기를 초과했습니다.',413);}chunks.push(value);}
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
const body=async req=>JSON.parse(new TextDecoder().decode(await read(req,100000)));
export async function largeTransfers(req,bucket,json,persistent=false){
  const route=persistent?'/api/archive/uploads':'/api/transfers/uploads',records=persistent?'archive/':'transfers/',sessions=persistent?'archive-uploads/':'transfer-uploads/',payloads=persistent?'archive-files/':'transfer-files/';
  const path=new URL(req.url).pathname;
  if(req.method!=='POST')return json({error:'Not found'},404);
  try{
    if(path===route){
      const {filename,size,minutes}=await body(req);
      if(typeof filename!=='string'||!filename||filename.length>240||/[\x00-\x1f\x7f]/.test(filename))fail('파일 이름을 확인해주세요.');
      if(!Number.isSafeInteger(size)||size<1||size>MAX_LARGE)fail('1바이트 이상, 최대 5GB 파일을 선택해주세요.',413);
      if(!persistent&&![1,5,10].includes(minutes))fail('보관 시간을 확인해주세요.');
      const id=crypto.randomUUID(),key=payloads+id;
      const upload=await bucket.createMultipartUpload(key,{httpMetadata:{contentType:'application/octet-stream'}});
      const session={id,key,uploadId:upload.uploadId,filename,size,minutes,expiresAt:Date.now()+24*3600000};
      try{await bucket.put(sessions+id,JSON.stringify(session),{customMetadata:{expiresAt:String(session.expiresAt)}});}catch(e){await upload.abort();throw e;}
      return json({id,partSize:PART_SIZE},201);
    }
    const match=path.startsWith(route+'/')?path.slice(route.length).match(/^\/([a-f0-9-]{36})\/(part|complete|abort)$/):null;
    if(!match)return json({error:'Not found'},404);
    const id=match[1],record=await bucket.get(sessions+id);
    if(!record)fail('업로드가 만료되었습니다. 파일을 다시 선택해주세요.',410);
    const session=await record.json();if(session.expiresAt<=Date.now())fail('업로드가 만료되었습니다.',410);
    const upload=bucket.resumeMultipartUpload(session.key,session.uploadId);
    if(match[2]==='abort'){await upload.abort();if(persistent&&!await bucket.head(records+id))await bucket.delete(session.key);await bucket.delete(sessions+id);return json({ok:true});}
    const count=Math.ceil(session.size/PART_SIZE);
    if(match[2]==='part'){
      const number=Number(new URL(req.url).searchParams.get('number'));
      if(!Number.isInteger(number)||number<1||number>count)fail('조각 번호가 올바르지 않습니다.');
      const expected=number===count?session.size-PART_SIZE*(count-1):PART_SIZE;
      if(!req.body||Number(req.headers.get('content-length'))!==expected)fail('파일 조각 크기가 일치하지 않습니다.');
      // Cloudflare validates Content-Length; stream the fixed-length request directly to R2.
      // Copying multi-MiB chunks in JS can exceed the Workers Free CPU budget.
      return json(await upload.uploadPart(number,req.body));
    }
    const {parts}=await body(req);
    if(!Array.isArray(parts)||parts.length!==count||parts.some((p,i)=>p.partNumber!==i+1||typeof p.etag!=='string'||!p.etag))fail('업로드 조각이 누락되었습니다.');
    // Complete is retryable if the response was lost after R2 committed the object.
    let object=await bucket.head(session.key);
    if(!object)object=await upload.complete(parts);
    if(object.size!==session.size){await bucket.delete(session.key);fail('완료된 파일 크기가 일치하지 않습니다.');}
    const existing=await bucket.head(records+id);
    const createdAt=existing?Number(existing.customMetadata.createdAt):Date.now(),expiresAt=persistent?undefined:createdAt+session.minutes*60000;
    const metadata={filename:session.filename,size:String(session.size),payloadKey:session.key,createdAt:String(createdAt),...(persistent?{}:{expiresAt:String(expiresAt)})};
    await bucket.put(records+id,'',{customMetadata:metadata});
    return json({document:{id,filename:session.filename,size:session.size,createdAt,expiresAt}},201);
  }catch(e){return json({error:e.status?e.message:'대용량 전송에 실패했습니다. 다시 시도해주세요.'},e.status||500);}
}

export async function cleanupLargeUploads(bucket,prefix='transfer-uploads/'){
  let cursor;
  do{
    const page=await bucket.list({prefix,cursor,include:['customMetadata']});
    for(const object of page.objects){
      if(Number(object.customMetadata?.expiresAt)>Date.now())continue;
      const record=await bucket.get(object.key);if(!record)continue;
      const session=await record.json();
      // Completed uploads have no remaining multipart state. Abort is idempotent in R2.
      await bucket.resumeMultipartUpload(session.key,session.uploadId).abort();
      if(prefix==='archive-uploads/'&&!await bucket.head('archive/'+session.id))await bucket.delete(session.key);
      await bucket.delete(object.key);
    }
    cursor=page.truncated?page.cursor:undefined;
  }while(cursor);
}
