const path = '/repos/threedowon/dowon-dashboard-data/contents/arduino/sketchbook.json';
const limit = 800000;
const bytes = value => new TextEncoder().encode(value);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const encode = text => { let value = ''; const data = bytes(text); for (let i=0;i<data.length;i+=8192) value += String.fromCharCode(...data.subarray(i,i+8192)); return btoa(value); };
export function validateSketch(value) {
  if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.id)) fail('코드 ID가 올바르지 않습니다.');
  for (const [key,max] of [['title',120],['board',120],['description',2000]]) {
    if (typeof value[key] !== 'string' || value[key].length > max || (key==='title'&&!value[key].trim())) fail('제목과 설명 길이를 확인해주세요.');
  }
  if (!Array.isArray(value.files) || !value.files.length || value.files.length > 20) fail('파일은 1~20개까지 저장할 수 있습니다.');
  const names = new Set();
  const files = value.files.map(file => {
    if (!file || typeof file.name !== 'string' || !/^[\w.-]+(?:\/[\w.-]+)*$/.test(file.name) || file.name.length > 160 || file.name.split('/').some(p=>p==='.'||p==='..') || names.has(file.name)) fail('파일명은 중복 없이 영문, 숫자, -, _, ., /로 입력해주세요.');
    if (typeof file.code !== 'string' || !file.code.trim() || bytes(file.code).length > 200000) fail('파일 내용은 비워둘 수 없으며 200KB 이하여야 합니다.');
    names.add(file.name); return {name:file.name,code:file.code};
  });
  return {id:value.id,title:value.title.trim(),board:value.board.trim(),description:value.description.trim(),files};
}
export async function sketchbook(req,token,gh,cors) {
  const json = (value,status=200) => Response.json(value,{status,headers:{...cors,'cache-control':'no-store'}});
  async function read() {
    const response = await gh(path,token);
    if (response.status===404) return {sha:null,documents:[]};
    if (!response.ok) fail('코드 모음집을 불러오지 못했습니다.',502);
    const file = await response.json();
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));
    if (data.version!==1 || !Array.isArray(data.documents)) fail('저장된 코드 형식을 확인해주세요.',502);
    return {sha:file.sha,documents:data.documents};
  }
  try {
    if (req.method==='GET') return json({documents:(await read()).documents});
    if (req.method!=='POST') return json({error:'Method not allowed'},405);
    if (!req.headers.get('content-type')?.includes('application/json')) fail('JSON required',415);
    const raw = await req.text(); if (bytes(raw).length > limit) fail('저장 용량을 초과했습니다.',413);
    let body; try { body=JSON.parse(raw); } catch { fail('올바른 JSON이 아닙니다.'); }
    if (!body || (body.revision!==null && (typeof body.revision!=='string'||!body.revision))) fail('코드 버전을 확인해주세요.');
    const input=validateSketch(body.document);
    for (let attempt=0;attempt<3;attempt++) {
      const state=await read(),old=state.documents.find(doc=>doc.id===input.id);
      if ((old?.revision||null)!==body.revision) fail('다른 곳에서 수정된 코드입니다. 입력 내용을 복사한 뒤 목록을 새로고침하고 최신 코드를 확인해주세요.',409);
      if (!old && state.documents.length>=100) fail('코드는 최대 100개까지 저장할 수 있습니다.');
      const document={...input,revision:crypto.randomUUID(),updatedAt:new Date().toISOString()};
      const documents=state.documents.filter(doc=>doc.id!==input.id); documents.unshift(document);
      const content=JSON.stringify({version:1,documents});
      if(bytes(content).length>limit) fail('코드 모음집 전체 저장 용량(800KB)을 초과했습니다.',413);
      const response=await gh(path,token,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({message:'Save Arduino sketch',content:encode(content),...(state.sha?{sha:state.sha}:{})})});
      if ([409,422].includes(response.status)) continue;
      if (!response.ok) fail('저장에 실패했습니다. 입력 내용을 유지했습니다. 다시 시도해주세요.',502);
      return json({document});
    }
    fail('다른 저장 작업과 겹쳤습니다. 다시 저장해주세요.',409);
  } catch(error) { return json({error:error.status?error.message:'코드 모음집 요청을 처리하지 못했습니다.'},error.status||500); }
}
