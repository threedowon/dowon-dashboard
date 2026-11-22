import {validPackSize} from '../../hardware/lib/order-quantity.js';
// Permanent workbook objects live outside the expiring transfers/ prefix.
export const SHEET_KEY = 'hardware/sheet.json';
export const ORIGINAL_KEY = 'hardware/migration-original.json';
const LEGACY_URL = 'https://supply-sheet-nov17-korea.qkryewon.chatgpt.site/api/sheet';
const MAX_BYTES = 12_000_000;
const PROJECT_PREFIX = 'hardware/projects/';
const projectId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// Only called behind the owner's authenticated API routes. Share tokens never list projects.
export async function hardwareProjects(req,env,cors) {
  const headers={...cors,'cache-control':'no-store'};
  if(!env.TRANSFERS)return new Response('저장소 연결이 필요합니다.',{status:503,headers});
  if(req.method==='GET'){
    const projects=[{id:'',name:'기존 신청표'}];let cursor;
    do {const page=await env.TRANSFERS.list({prefix:PROJECT_PREFIX,include:['customMetadata'],cursor});
      for(const object of page.objects)projects.push({id:object.key.slice(PROJECT_PREFIX.length,-5),name:object.customMetadata?.name||'프로젝트'});
      cursor=page.truncated?page.cursor:undefined;
    }while(cursor);
    return Response.json({projects},{headers});
  }
  if(req.method!=='POST')return new Response('Method not allowed',{status:405,headers});
  let body;try{body=JSON.parse(await limitedText(req.body));}catch{return new Response('프로젝트명을 확인해주세요.',{status:400,headers});}
  if(typeof body?.name!=='string'||!body.name.trim()||body.name.trim().length>80)return new Response('프로젝트명은 1~80자로 입력해주세요.',{status:400,headers});
  const id=crypto.randomUUID(),name=body.name.trim();
  const result=await env.TRANSFERS.put(PROJECT_PREFIX+id+'.json',JSON.stringify({name,data:{items:[],people:[],quantities:{}},version:0}),{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{name},httpMetadata:{contentType:'application/json'}});
  if(!result)return new Response('프로젝트를 만들지 못했습니다. 다시 시도해주세요.',{status:409,headers});
  return Response.json({id,name},{status:201,headers});
}
const groups = ['공구','전선·커넥터','보드·모듈','전원·측정','소모품'];
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length <= max;
export function validSheet(data) {
  if (!record(data) || !Array.isArray(data.items) || !Array.isArray(data.people) || !record(data.quantities)) return false;
  if (data.items.length > 100 || data.people.length > 300) return false;
  const ids = values => new Set(values.map(v => v.id)).size === values.length;
  if (data.people.some(p => !record(p) || !text(p.id,100) || !p.id || p.id.includes(':') || !text(p.name,200) || !p.name.trim())) return false;
  if (data.items.some(i => !record(i) || !text(i.id,100) || !i.id || i.id.includes(':') || !text(i.name,200) || !i.name.trim() || !text(i.detail,2000) || !text(i.link,8000) || (i.link && !/^https?:\/\//i.test(i.link)) || !text(i.image,MAX_BYTES) || (i.image && !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(i.image)) || !groups.includes(i.group) || !['공용','개인'].includes(i.usage))) return false;
  if (!ids(data.people) || !ids(data.items)) return false;
  if (data.items.some(item => !validPackSize(item.packSize))) return false;
  const people = new Set(data.people.map(p => p.id)), items = new Set(data.items.map(i => i.id));
  return Object.entries(data.quantities).every(([key,n]) => {
    const parts = key.split(':');
    return parts.length === 2 && people.has(parts[0]) && items.has(parts[1]) && Number.isInteger(n) && n >= 0 && n <= 999;
  });
}
async function limitedText(body) {
  if (!body) throw Error('입력 내용을 확인해주세요.');
  const reader = body.getReader(), chunks = []; let size = 0;
  while (true) {
    const {done,value} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw Error('사진 용량이 너무 큽니다.'); }
    chunks.push(value);
  }
  return new Blob(chunks).text();
}
async function currentSheet(bucket) {
  let current = await bucket.get(SHEET_KEY);
  if (current) return current;
  // Keep a recoverable original snapshot; never re-import over an existing workbook.
  let original = await bucket.get(ORIGINAL_KEY);
  if (!original) {
    const response = await fetch(LEGACY_URL, {signal: AbortSignal.timeout(15000)});
    if (!response.ok) throw Error('기존 신청표를 이전하지 못했습니다. 잠시 후 다시 시도해주세요.');
    const raw = await limitedText(response.body), snapshot = JSON.parse(raw);
    if (!validSheet(snapshot.data) || !Number.isSafeInteger(snapshot.version) || snapshot.version < 0) throw Error('기존 신청표 데이터 확인이 필요합니다.');
    await bucket.put(ORIGINAL_KEY, raw, {onlyIf: {etagDoesNotMatch:'*'}, httpMetadata:{contentType:'application/json'}});
    original = await bucket.get(ORIGINAL_KEY);
  }
  if (!original) throw Error('이전 백업을 저장하지 못했습니다.');
  const raw = await original.text();
  await bucket.put(SHEET_KEY, raw, {onlyIf:{etagDoesNotMatch:'*'}, httpMetadata:{contentType:'application/json'}});
  current = await bucket.get(SHEET_KEY);
  if (!current) throw Error('신청표를 저장하지 못했습니다.');
  return current;
}
export async function hardware(req, env, cors) {
  const headers = {...cors, 'cache-control':'no-store'};
  const fail = (message,status) => new Response(message,{status,headers});
  if (!['GET','POST'].includes(req.method)) return fail('Method not allowed',405);
  if (!env.TRANSFERS) return fail('신청표 저장소 연결이 필요합니다.',503);
  const path=new URL(req.url).pathname;
  const id=path==='/api/hardware-sheet'?'':path.slice('/api/hardware-sheet/'.length);
  if(path!=='/api/hardware-sheet'&&!projectId.test(id))return fail('프로젝트를 찾을 수 없습니다.',404);
  const key=id?PROJECT_PREFIX+id+'.json':SHEET_KEY;
  const getCurrent=()=>id?env.TRANSFERS.get(key):currentSheet(env.TRANSFERS);
  try {
    if (req.method === 'GET') {
      const current = await getCurrent();
      if(!current)return fail('프로젝트를 찾을 수 없습니다. 공유 주소를 확인해주세요.',404);
      return new Response(await current.text(), {headers:{...headers,'content-type':'application/json'}});
    }
    let body;
    try { body = JSON.parse(await limitedText(req.body)); }
    catch (error) { return fail(error.message === '사진 용량이 너무 큽니다.' ? error.message : '입력 내용을 확인해주세요.',400); }
    if (!validSheet(body?.data) || !Number.isSafeInteger(body.version) || body.version < 0) return fail('입력값을 확인해주세요.',400);
    const current = await getCurrent();
    if(!current)return fail('프로젝트를 찾을 수 없습니다.',404);
    const previous = await current.json();
    if (previous.version !== body.version) return fail('다른 창에서 변경되었습니다. 새로고침 후 다시 입력해주세요.',409);
    const version = previous.version + 1;
    const result = await env.TRANSFERS.put(key, JSON.stringify({...(id?{name:previous.name}:{}),data:body.data,version}), {onlyIf:{etagMatches:current.etag},...(id?{customMetadata:{name:previous.name}}:{}),httpMetadata:{contentType:'application/json'}});
    if (!result) return fail('다른 창에서 변경되었습니다. 새로고침 후 다시 입력해주세요.',409);
    return Response.json({version},{headers});
  } catch { return fail('신청표를 불러오거나 저장하지 못했습니다. 잠시 후 다시 시도해주세요.',503); }
}
