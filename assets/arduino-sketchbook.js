(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('sketchList')) return;
  const api = 'https://api.3dowon.com/api/sketchbook';
  const draftKey = 'dowon-sketchbook-draft-v1';
  const builtins = [
    {id:'fsr-single',title:'FSR · Single sensor (GPIO4)',board:'ESP32 / Arduino',description:'GPIO4 · Sample 10ms · JSON output 100ms · Serial 115200',paths:['fsr-single.ino']},
    {id:'fsr',title:'FSR · 4-channel',board:'ESP32-S3 / PlatformIO',description:'Read pressure changes and detection states from four FSR sensors.',paths:['src/main.cpp','platformio.ini']},
    {id:'sen0610',title:'SEN0610 · Distance sensor',board:'ESP32-S3 / PlatformIO',description:'Read distance measurements and connection status from an I2C sensor.',paths:['src/main.cpp','platformio.ini']}
  ];
  let documents = new Map(), loaded = false, loading = false, editing = null, fileIndex = 0, dirty = false, saving = false;
  let selectedId=null;const selectedFiles=new Map();
  const element = (tag, text, className) => { const el=document.createElement(tag); if(text!==undefined)el.textContent=text; if(className)el.className=className; return el; };
  const button = (text, fn, primary=false) => {const el=element('button',text,'btn'+(primary?' primary':''));el.type='button';el.onclick=fn;return el;};
  const message = text => {$('sketchStatus').textContent=text;};
  async function request(options) {
    let response;
    try{response=await fetch(api,{credentials:'include',...options,signal:AbortSignal.timeout(20000)});}catch{$('sketchConnection').textContent='Connection unavailable';$('sketchConnection').classList.remove('is-connected');throw Error(location.hostname==='127.0.0.1'||location.hostname==='localhost'?'로컬 미리보기에서는 계정 저장을 사용할 수 없습니다. 운영 사이트에서 저장해주세요.':'서버에 연결하지 못했습니다. 연결을 확인한 후 다시 시도해주세요.');}
    if(response.status===401) {$('sketchConnection').textContent='Not connected';$('sketchConnection').classList.remove('is-connected');$('sketchLogin').hidden=false;$('sketchEditorLogin').hidden=false;throw Error('GitHub 연결 후 저장할 수 있습니다. 입력 내용은 이 브라우저에 임시 보관됩니다.');}
    const data=await response.json();
    if(!response.ok)throw Error(data.error||'요청을 처리하지 못했습니다.');
    $('sketchConnection').textContent='GitHub connected';$('sketchConnection').classList.add('is-connected');
    $('sketchLogin').hidden=true;$('sketchEditorLogin').hidden=true;
    return data;
  }
  function highlight(source,host) {
    // Only text nodes are inserted, including unknown syntax and user-supplied HTML.
    const pattern=/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(void|const|int|unsigned|long|float|double|bool|char|if|else|for|while|return|include|define|true|false|INPUT|OUTPUT|HIGH|LOW)\b|\b(0x[\da-fA-F]+|\d+(?:\.\d+)?)\b/g;
    let last=0;
    for(const match of source.matchAll(pattern)){
      host.append(document.createTextNode(source.slice(last,match.index)));
      host.append(element('span',match[0],'sketch-token-'+(match[1]?'comment':match[2]?'string':match[3]?'keyword':'number')));last=match.index+match[0].length;
    }
    host.append(document.createTextNode(source.slice(last)));
  }
  function render() {
    const list=$('sketchList');list.replaceChildren();
    const ordered=[...documents.values()].sort((a,b)=>{
      const index=id=>{const i=builtins.findIndex(d=>d.id===id);return i<0?builtins.length:i;};
      return index(a.id)-index(b.id)||a.title.localeCompare(b.title);
    });
    if(!documents.has(selectedId))selectedId=ordered[0]?.id||null;
    for(const doc of ordered){
      const item=button('',()=>{selectedId=doc.id;render();$('sketchItem-'+doc.id)?.focus();});
      item.id='sketchItem-'+doc.id;item.className='sketch-list-item';item.setAttribute('aria-pressed',String(doc.id===selectedId));
      const icon=element('span',undefined,'sketch-file-icon');icon.setAttribute('aria-hidden','true');
      const text=element('span',undefined,'sketch-list-copy');text.append(element('strong',doc.title),element('span',doc.board));item.append(icon,text);list.append(item);
    }
    $('sketchCount').textContent=documents.size+' sketch'+(documents.size===1?'':'es');
    renderDetail();
  }
  function renderDetail(){
    const pane=$('sketchDetail');pane.replaceChildren();const doc=documents.get(selectedId);
    if(!doc){pane.append(element('p',loading?'Loading sketches…':'No sketches available. Choose New sketch or try Sync.','sketch-empty'));return;}
    const header=element('header',undefined,'sketch-detail-heading');header.append(element('h2',doc.title),element('p',doc.board,'sketch-board'),element('p',doc.description,'sketch-description'));pane.append(header);
    let index=doc.files.findIndex(file=>file.name===selectedFiles.get(doc.id));if(index<0)index=0;
    const file=doc.files[index];selectedFiles.set(doc.id,file.name);
    const tabs=element('div',undefined,'sketch-file-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Sketch files');
    doc.files.forEach((entry,i)=>{
      const tab=button(entry.name,()=>{selectedFiles.set(doc.id,entry.name);renderDetail();$('sketchTab-'+i).focus();});tab.id='sketchTab-'+i;
      tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(i===index));tab.setAttribute('aria-controls','sketchCodePanel');tab.tabIndex=i===index?0:-1;
      tab.onkeydown=event=>{let next;if(event.key==='ArrowRight')next=(i+1)%doc.files.length;else if(event.key==='ArrowLeft')next=(i+doc.files.length-1)%doc.files.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=doc.files.length-1;else return;event.preventDefault();selectedFiles.set(doc.id,doc.files[next].name);renderDetail();$('sketchTab-'+next).focus();};tabs.append(tab);
    });pane.append(tabs);
    const viewport=element('div',undefined,'sketch-code-view');viewport.id='sketchCodePanel';viewport.tabIndex=0;viewport.setAttribute('role','tabpanel');viewport.setAttribute('aria-labelledby','sketchTab-'+index);
    const numbers=element('pre',Array.from({length:file.code.split('\n').length},(_,i)=>i+1).join('\n'),'sketch-line-numbers');numbers.setAttribute('aria-hidden','true');
    const pre=element('pre',undefined,'sketch-code-source'),code=element('code');highlight(file.code,code);pre.append(code);viewport.append(numbers,pre);pane.append(viewport);
    const status=element('p',doc.revision?'Saved to GitHub':'Built-in sketch · Edit to save your own copy','sketch-copy-status');status.setAttribute('role','status');
    const actions=element('div',undefined,'sketch-detail-actions');
    const copy=button('Copy code',async()=>{try{await navigator.clipboard.writeText(file.code);status.textContent='Code copied.';}catch{const range=document.createRange();range.selectNodeContents(code);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);status.textContent='Code selected. Press Ctrl+C or Command+C to copy.';}});copy.id='sketchCopy';
    const edit=button('Edit sketch',()=>openEditor(doc));edit.id='sketchEdit';
    const download=button('Download '+(file.name.includes('.')?'.'+file.name.split('.').pop():'file'),()=>{const url=URL.createObjectURL(new Blob([file.code],{type:'text/plain;charset=utf-8'})),link=element('a');link.href=url;link.download=file.name.split('/').pop();link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});download.id='sketchDownload';
    actions.append(copy,edit,download);pane.append(actions,status);
    if(['fsr','sen0610'].includes(doc.id)){const guide=element('a','Wiring & usage guide ↗','sketch-guide');guide.href=`signal-tester/devices/${doc.id}/README.md`;guide.target='_blank';guide.rel='noopener';pane.append(guide);}
  }
  async function load() {
    if(loading)return;loading=true;$('sketchRefresh').disabled=true;message('Loading sketches…');
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
      message([cloudError||'Saved sketches sync with GitHub.',failures.length?'불러오지 못한 코드: '+failures.join(', ')+'. 새로고침으로 다시 시도하세요.':''].filter(Boolean).join(' '));
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
    editing=structuredClone(doc);fileIndex=Math.max(0,doc.files.findIndex(file=>file.name===selectedFiles.get(doc.id)));dirty=restored;
    $('sketchTitle').value=doc.title;$('sketchBoard').value=doc.board;$('sketchDescription').value=doc.description;
    $('sketchEditorTitle').textContent=doc.title?'Edit sketch':'New sketch';
    $('sketchEditorStatus').textContent='Save to your private GitHub sketchbook.';
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
    $('sketchEditorStatus').textContent='Saving…';
    try {
      const {document:doc}=await request({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({document:editing,revision:editing.revision||null})});
      documents.set(doc.id,doc);selectedId=doc.id;render();
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
