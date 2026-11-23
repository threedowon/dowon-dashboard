(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('sketchList')) return;
  const api = 'https://api.3dowon.com/api/sketchbook';
  const draftKey = 'dowon-sketchbook-draft-v1';
  const builtins = [
    {id:'fsr-single',title:'FSR · Single sensor (GPIO4)',board:'ESP32 / Arduino',description:'GPIO4 · 10ms 측정 · 100ms JSON 전송 · Serial 115200',paths:['fsr-single.ino']},
    {id:'fsr',title:'FSR · 4-channel',board:'ESP32-S3 / PlatformIO',description:'FSR 센서 4개의 압력 변화와 감지 상태를 읽는 코드입니다.',paths:['src/main.cpp','platformio.ini']},
    {id:'sen0610',title:'SEN0610 · Distance sensor',board:'ESP32-S3 / PlatformIO',description:'I2C 거리 센서의 측정값과 연결 상태를 읽는 코드입니다.',paths:['src/main.cpp','platformio.ini']}
  ];
  let documents = new Map(), loaded = false, loading = false, editing = null, fileIndex = 0, dirty = false, saving = false;
  const element = (tag, text, className) => { const el=document.createElement(tag); if(text!==undefined)el.textContent=text; if(className)el.className=className; return el; };
  const button = (text, fn, primary=false) => {const el=element('button',text,'btn'+(primary?' primary':''));el.type='button';el.onclick=fn;return el;};
  const message = text => {$('sketchStatus').textContent=text;};
  async function request(options) {
    let response;
    try{response=await fetch(api,{credentials:'include',...options,signal:AbortSignal.timeout(20000)});}catch{throw Error(location.hostname==='127.0.0.1'||location.hostname==='localhost'?'로컬 미리보기에서는 계정 저장을 사용할 수 없습니다. 운영 사이트에서 저장해주세요.':'서버에 연결하지 못했습니다. 연결을 확인한 후 다시 시도해주세요.');}
    if(response.status===401) {$('sketchLogin').hidden=false;$('sketchEditorLogin').hidden=false;throw Error('GitHub 연결 후 저장할 수 있습니다. 입력 내용은 이 브라우저에 임시 보관됩니다.');}
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'요청을 처리하지 못했습니다.');
    $('sketchLogin').hidden=true;$('sketchEditorLogin').hidden=true;
    return data;
  }
  function render() {
    const list=$('sketchList');list.replaceChildren();
    for(const doc of documents.values()) {
      const card=element('article',undefined,'sketchbook-card');
      card.append(element('span',doc.board,'small'),element('h2',doc.title),element('p',doc.description));
      const toolbar=element('div',undefined,'sketch-code-toolbar');
      const label=element('label','파일 '), select=element('select');select.setAttribute('aria-label',doc.title+' 파일');
      doc.files.forEach((file,i)=>{const option=element('option',file.name);option.value=i;select.append(option);});label.append(select);
      const code=element('textarea',undefined,'sketch-code');code.readOnly=true;code.spellcheck=false;code.wrap='off';code.value=doc.files[0].code;code.setAttribute('aria-label',doc.title+' 코드');
      const status=element('p',doc.revision?'저장된 코드':'기본 코드 · 수정 후 내 모음집에 저장됩니다.','small');status.setAttribute('role','status');
      select.onchange=()=>{code.value=doc.files[Number(select.value)].code;};
      const tools=element('div',undefined,'tools');
      tools.append(button('코드 복사',async()=>{try{await navigator.clipboard.writeText(code.value);status.textContent='복사했습니다.';}catch{code.focus();code.select();status.textContent='전체 선택했습니다. Ctrl+C 또는 ⌘C로 복사하세요.';}},true),button('수정',()=>openEditor(doc)),button('다운로드',()=>{
        const file=doc.files[Number(select.value)],url=URL.createObjectURL(new Blob([file.code],{type:'text/plain;charset=utf-8'}));
        const link=element('a');link.href=url;link.download=file.name.split('/').pop();link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }));
      toolbar.append(label,tools);card.append(toolbar,code,status);
      if(['fsr','sen0610'].includes(doc.id)){const guide=element('a','배선 및 사용 안내','btn');guide.href=`signal-tester/devices/${doc.id}/README.md`;guide.target='_blank';guide.rel='noopener';card.append(guide);}
      list.append(card);
    }
  }
  async function load() {
    if(loading)return;loading=true;$('sketchRefresh').disabled=true;message('코드를 불러오는 중…');
    try {
      // Refresh failures retain the previously loaded collection.
      let cloud=null,cloudError='';
      try {cloud=await request();}catch(error){cloudError=error.message;}
      const next=new Map(cloud?cloud.documents.map(doc=>[doc.id,doc]):documents);
      const failures=[];
      await Promise.all(builtins.map(async doc=>{
        if(next.has(doc.id))return;
        try {
          const files=await Promise.all(doc.paths.map(async name=>{
            const response=await fetch(`signal-tester/devices/${doc.id}/${name}`);
            if(!response.ok||response.headers.get('content-type')?.includes('text/html'))throw Error();
            return {name,code:await response.text()};
          }));next.set(doc.id,{...doc,files,revision:null});
        }catch{failures.push(doc.title);}
      }));
      documents=next;render();loaded=true;
      message([cloudError||'GitHub에 저장된 코드와 기본 코드를 불러왔습니다.',failures.length?'불러오지 못한 코드: '+failures.join(', ')+'. 새로고침으로 다시 시도하세요.':''].filter(Boolean).join(' '));
    }catch(error){message('목록을 불러오지 못했습니다. 새로고침으로 다시 시도하세요.');}
    finally {loading=false;$('sketchRefresh').disabled=false;}
  }
  function capture() {
    if(!editing)return;
    editing.title=$('sketchTitle').value;editing.board=$('sketchBoard').value;editing.description=$('sketchDescription').value;
    editing.files[fileIndex]={name:$('sketchFilename').value,code:$('sketchSource').value};
  }
  function stash() {
    capture();dirty=true;
    try{localStorage.setItem(draftKey,JSON.stringify(editing));$('sketchRestore').hidden=false;$('sketchEditorStatus').textContent='작성 중 · 이 브라우저에 임시 보관됨. 저장을 눌러 계정에 반영하세요.';}
    catch{$('sketchEditorStatus').textContent='임시 보관 공간이 부족합니다. 창을 닫기 전에 저장하거나 코드를 복사하세요.';}
  }
  function fillFile() {
    const select=$('sketchFileSelect');select.replaceChildren();
    editing.files.forEach((file,i)=>{const option=element('option',file.name||'새 파일');option.value=i;select.append(option);});select.value=String(fileIndex);
    $('sketchFilename').value=editing.files[fileIndex].name;$('sketchSource').value=editing.files[fileIndex].code;
  }
  function openEditor(doc,restored=false) {
    try{if(!restored&&localStorage.getItem(draftKey)&&!confirm('임시 보관한 편집이 있습니다. 이 코드를 편집하면 임시 내용이 교체됩니다. 계속할까요?'))return;}catch{}
    editing=structuredClone(doc);fileIndex=0;dirty=restored;
    $('sketchTitle').value=doc.title;$('sketchBoard').value=doc.board;$('sketchDescription').value=doc.description;
    $('sketchEditorTitle').textContent=doc.title?'코드 수정':'새 코드 추가';
    $('sketchEditorStatus').textContent='저장을 누르면 비공개 코드 모음집에 반영됩니다.';
    fillFile();$('sketchEditor').showModal();$('sketchTitle').focus();
  }
  function closeEditor() {
    if(saving)return;
    if(dirty&&!confirm('저장하지 않은 편집을 닫을까요? 임시 보관한 내용은 복구할 수 있습니다.'))return;
    $('sketchEditor').close();editing=null;dirty=false;
  }
  $('sketchForm').addEventListener('input',stash);
  $('sketchFileSelect').onchange=()=>{capture();fileIndex=Number($('sketchFileSelect').value);fillFile();};
  $('sketchFileAdd').onclick=()=>{capture();if(editing.files.length>=20){$('sketchEditorStatus').textContent='파일은 최대 20개까지 추가할 수 있습니다.';return;}editing.files.push({name:'file-'+(editing.files.length+1)+'.ino',code:''});fileIndex=editing.files.length-1;fillFile();stash();$('sketchFilename').focus();};
  $('sketchFileRemove').onclick=()=>{if(editing.files.length===1){$('sketchEditorStatus').textContent='최소 한 개의 파일이 필요합니다.';return;}if(!confirm('현재 파일을 이 편집에서 제거할까요? 저장할 때 반영됩니다.'))return;editing.files.splice(fileIndex,1);fileIndex=0;fillFile();stash();};
  $('sketchNew').onclick=()=>{
    openEditor({id:crypto.randomUUID(),title:'',board:'',description:'',files:[{name:'sketch.ino',code:''}],revision:null});
  };
  $('sketchCancel').onclick=closeEditor;
  $('sketchEditor').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
  $('sketchRestore').onclick=()=>{try{const doc=JSON.parse(localStorage.getItem(draftKey));if(!doc||!Array.isArray(doc.files)||!doc.files.length)throw Error();openEditor(doc,true);}catch{message('임시 코드를 복구하지 못했습니다.');}};
  $('sketchRefresh').onclick=load;
  $('sketchLogin').onclick=()=>{if(editing){stash();dirty=false;}location.href='https://api.3dowon.com/auth/login';};
  $('sketchEditorLogin').onclick=$('sketchLogin').onclick;
  $('sketchForm').onsubmit=async event=>{
    event.preventDefault();if(saving)return;capture();
    if(!editing.title.trim()||editing.files.some(file=>!file.name.trim()||!file.code.trim())){$('sketchEditorStatus').textContent='제목과 모든 파일의 이름·코드를 입력해주세요.';return;}
    saving=true;
    const controls=[...$('sketchForm').querySelectorAll('input,textarea,select,button')];controls.forEach(el=>el.disabled=true);
    $('sketchEditorStatus').textContent='저장 중…';
    try {
      const {document:doc}=await request({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({document:editing,revision:editing.revision||null})});
      documents.set(doc.id,doc);render();
      try{localStorage.removeItem(draftKey);}catch{}
      $('sketchRestore').hidden=true;dirty=false;editing=null;$('sketchEditor').close();message('저장했습니다. 다른 기기에서도 GitHub에 연결하면 확인할 수 있습니다.');
    }catch(error){$('sketchEditorStatus').textContent=error.message+' 입력한 내용은 그대로 유지됩니다.';}
    finally{saving=false;controls.forEach(el=>el.disabled=false);}
  };
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  const activate=()=>{if(location.hash==='#arduino'&&!loaded)load();};
  window.addEventListener('hashchange',activate);
  try{$('sketchRestore').hidden=!localStorage.getItem(draftKey);}catch{}
  activate();
})();
