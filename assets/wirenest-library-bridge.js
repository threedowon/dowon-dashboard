const origin='https://threedowon.github.io',channel='wirenest-library',limit=25*1024*1024;
export function installLibraryBridge({win=window,request=fetch,status=()=>{}}={}){
 const nonce=new URLSearchParams(win.location.hash.slice(1)).get('session'),parent=win.opener;
 if(!parent||! /^[a-f0-9-]{36}$/i.test(nonce||'')){status('WireNest의 백업 불러오기에서 연결해주세요.');return;}
 const send=data=>parent.postMessage({channel,nonce,...data},origin);
 const replies=new Map();let saving=false;
 async function api(path,options={}){
  const r=await request('https://api.3dowon.com/api/wirenest'+path,{credentials:'include',...options});
  if(!r.ok){const body=await r.json().catch(()=>({}));throw Error(body.error||'백업 요청에 실패했습니다.');}return r;
 }
 win.addEventListener('message',async event=>{
  const m=event.data;if(event.source!==parent||event.origin!==origin||m?.channel!==channel||m.nonce!==nonce||typeof m.id!=='string'||m.id.length>100)return;
  if(replies.has(m.id)){send(replies.get(m.id));return;}
  let result;
  try{
   if(m.action==='list')result={documents:(await(await api('')).json()).documents};
   else if(m.action==='open'){
    if(!/^[a-f0-9-]{36}$/i.test(m.documentId||''))throw Error('잘못된 백업 ID입니다.');
    const blob=await(await api('/'+m.documentId+'/file')).blob();if(blob.size>limit)throw Error('25MB 이하의 백업만 열 수 있습니다.');result={text:await blob.text()};
   }else if(m.action==='save'){
    if(saving)throw Error('다른 백업을 저장 중입니다.');
    if(typeof m.text!=='string'||new TextEncoder().encode(m.text).length>limit)throw Error('25MB 이하의 프로젝트만 백업할 수 있습니다.');
    const data=JSON.parse(m.text);if(data?.app!=='wirenest'||!data.boards||!data.nodes||!data.wires)throw Error('프로젝트 형식이 올바르지 않습니다.');
    saving=true;
    try{const filename=(String(data.name||'WireNest').replace(/[\/\\:*?"<>|]/g,'_').slice(0,180)||'WireNest')+'.wnest';
     const form=new FormData();form.set('file',new File([m.text],filename,{type:'application/json'}));form.set('title',filename);form.set('tags','[]');
     result=await(await api('',{method:'POST',body:form})).json();
    }finally{saving=false;}
   }else return;
   status('연결되었습니다. WireNest 화면에서 백업을 선택하세요. 이 창은 백업 저장을 위해 열어두세요.');
  }catch(error){result={error:error.message};status(error.message+' 로그인 후 WireNest에서 새로고침을 눌러주세요.');}
  const reply={id:m.id,...result};replies.set(m.id,reply);if(replies.size>100)replies.delete(replies.keys().next().value);send(reply);
 });
 send({type:'ready'});
}
