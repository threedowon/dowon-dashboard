// Key bindings are page-local. No global hooks or background keyboard capture.
const keyboardCodes = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(c=>'Key'+c)
  .concat(Array.from({length:10},(_,i)=>'Digit'+i),['Space','Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'],
    Array.from({length:12},(_,i)=>'F'+(i+1)),['Backspace','Delete','Insert','Home','End','PageUp','PageDown'],
    Array.from({length:10},(_,i)=>'Numpad'+i),['NumpadAdd','NumpadSubtract','NumpadMultiply','NumpadDivide','NumpadDecimal','NumpadEnter']);
let keyboardEnabled=false, keyboardTarget=null, keyPickerOpen=false, shortcutDraft=null;
const heldKeys=new Set();
function keyLabel(code){return code?.replace(/^Key/,'').replace(/^Digit/,'').replace(/^Arrow/,'Arrow ').replace(/^Numpad/,'Num ')||'Not assigned';}
function closeKeyPicker(){keyPickerOpen=false;const list=$('shortcutChoices');if(list)list.hidden=true;const b=$('shortcutPicker');if(b){b.textContent=shortcutDraft?keyLabel(shortcutDraft):'Choose key…';b.setAttribute('aria-expanded','false');}}
function renderKeyPicker(item){
  shortcutDraft=item?.shortcut||null;keyPickerOpen=false;
  const block=el('div','field keyboard-field'),label=el('label','','Keyboard test key');label.htmlFor='shortcutPicker';
  const row=el('div','keyboard-picker-row'),pick=button('button key-picker','',()=>{
    if(keyPickerOpen){closeKeyPicker();return;}
    keyPickerOpen=true;$('shortcutChoices').hidden=false;pick.textContent='Press a key…';pick.setAttribute('aria-expanded','true');
  });pick.id='shortcutPicker';pick.setAttribute('aria-controls','shortcutChoices');pick.setAttribute('aria-expanded','false');
  const clear=button('button quiet','Clear',()=>{shortcutDraft=null;closeKeyPicker();});clear.id='clearShortcut';row.append(pick,clear);
  const choices=el('div','key-choices');choices.id='shortcutChoices';choices.hidden=true;
  choices.append(el('p','field-help','Press a key now, or click one below. Escape cancels. No modifiers.'));
  const grid=el('div','key-grid');for(const code of keyboardCodes){const option=button('key-option',keyLabel(code),()=>{shortcutDraft=code;closeKeyPicker();});option.dataset.key=code;grid.append(option);}choices.append(grid);
  block.append(label,row,choices,el('p','field-help','Sends this Signal’s saved value while Keyboard test is enabled and this page has focus. Typing in a field never sends.'));
  $('editFields').append(block);closeKeyPicker();
}
function renderKeyboard(){
  if(!workspace)return;
  const targets=workspace.targets.filter(t=>kind(t)==='http'),select=$('keyboardTarget');
  if(!targets.some(t=>t.id===keyboardTarget)){keyboardEnabled=false;keyboardTarget=targets.find(t=>t.id===workspace.activeTarget)?.id||targets[0]?.id||null;}
  const signature=JSON.stringify(targets.map(t=>[t.id,t.name]));
  if(select.dataset.signature!==signature){select.replaceChildren();for(const t of targets){const option=el('option','',t.name);option.value=t.id;select.append(option);}select.dataset.signature=signature;}
  select.value=keyboardTarget||'';select.disabled=keyboardEnabled||!targets.length;
  $('keyboardToggle').disabled=!targets.length||engineOffline;$('keyboardToggle').checked=keyboardEnabled;
  const count=workspace.signals.filter(s=>s.shortcut).length;
  document.querySelector('.keyboard-bar').classList.toggle('on',keyboardEnabled);$('signals').classList.toggle('keyboard-live',keyboardEnabled);
  $('keyboardHint').textContent=keyboardEnabled?`${count} keys live · press them on this page`:count?`${count} keys assigned`:'Assign keys in Edit signal';
}
function keyboardSetup(){
  $('keyboardToggle').onchange=e=>{keyboardEnabled=e.target.checked;e.target.blur();renderKeyboard();};
  $('keyboardTarget').onchange=e=>{keyboardTarget=e.target.value;};
  $('editDialog').addEventListener('close',closeKeyPicker);
  window.addEventListener('blur',()=>{heldKeys.clear();});
  document.addEventListener('keyup',e=>heldKeys.delete(e.code),true);
  document.addEventListener('keydown',e=>{
    if(keyPickerOpen&&$('editDialog').open){
      if(e.key==='Tab')return;
      e.preventDefault();e.stopImmediatePropagation();
      if(e.key==='Escape'){closeKeyPicker();return;}
      if(e.repeat||heldKeys.has(e.code))return;
      heldKeys.add(e.code);
      if(e.ctrlKey||e.altKey||e.metaKey||e.shiftKey||!keyboardCodes.includes(e.code)){
        $('formError').textContent='Choose a single listed key without Ctrl, Alt, Shift or Windows.';return;
      }
      const duplicate=workspace.signals.find(s=>s.id!==editing?.id&&s.shortcut===e.code);
      if(duplicate){$('formError').textContent=`${keyLabel(e.code)} is already used by ${duplicate.name}.`;return;}
      shortcutDraft=e.code;$('formError').textContent='';closeKeyPicker();return;
    }
    if(e.repeat||heldKeys.has(e.code))return;
    heldKeys.add(e.code);
    if(!keyboardEnabled||engineOffline||!workspace||e.ctrlKey||e.altKey||e.metaKey||e.shiftKey||e.isComposing||document.querySelector('dialog[open]'))return;
    if(e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
    if(['Space','Enter'].includes(e.code)&&e.target.closest('button,a'))return;
    const signal=workspace.signals.find(s=>s.shortcut===e.code);
    if(!signal)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(!workspace.targets.some(t=>t.id===keyboardTarget&&kind(t)==='http')){toast('Choose a Player for Keyboard test.',true);return;}
    safe(()=>sendOnce({targetId:keyboardTarget,key:signal.key,value:clone(signal.value),origin:'Keyboard · '+keyLabel(e.code)}))();
  },true);
}
