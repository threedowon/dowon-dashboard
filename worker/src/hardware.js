// Permanent workbook objects live outside the expiring transfers/ prefix.
export const SHEET_KEY = 'hardware/sheet.json';
export const ORIGINAL_KEY = 'hardware/migration-original.json';
const LEGACY_URL = 'https://supply-sheet-nov17-korea.qkryewon.chatgpt.site/api/sheet';
const MAX_BYTES = 12_000_000;
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
  try {
    if (req.method === 'GET') {
      const current = await currentSheet(env.TRANSFERS);
      return new Response(await current.text(), {headers:{...headers,'content-type':'application/json'}});
    }
    let body;
    try { body = JSON.parse(await limitedText(req.body)); }
    catch (error) { return fail(error.message === '사진 용량이 너무 큽니다.' ? error.message : '입력 내용을 확인해주세요.',400); }
    if (!validSheet(body?.data) || !Number.isSafeInteger(body.version) || body.version < 0) return fail('입력값을 확인해주세요.',400);
    const current = await currentSheet(env.TRANSFERS), previous = await current.json();
    if (previous.version !== body.version) return fail('다른 창에서 변경되었습니다. 새로고침 후 다시 입력해주세요.',409);
    const version = previous.version + 1;
    const result = await env.TRANSFERS.put(SHEET_KEY, JSON.stringify({data:body.data,version}), {onlyIf:{etagMatches:current.etag},httpMetadata:{contentType:'application/json'}});
    if (!result) return fail('다른 창에서 변경되었습니다. 새로고침 후 다시 입력해주세요.',409);
    return Response.json({version},{headers});
  } catch { return fail('신청표를 불러오거나 저장하지 못했습니다. 잠시 후 다시 시도해주세요.',503); }
}
