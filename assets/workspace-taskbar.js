(() => {
  'use strict';
  // Embedded tools use their host's taskbar; standalone windows get their own.
  if (window.top !== window.self || document.querySelector('.retro-taskbar')) return;
  const script = document.currentScript;
  const base = new URL('../', script.src);
  const page = script.dataset.page || 'home';
  const items = [
    ['home','Home','computer'], ['milestones','Milestones','milestones'],
    ['pdf','PDF Library','library'], ['ideas','Reference','ideas'],
    ['wirenest','WireNest','wirenest'], ['transfers','File Transfer','transfers'], ['archive','파일 보관함','transfers'], ['signaltester','Signal Tester','signaltester'],
    ['hardware','Hardware Sheet','hardware'], ['arduino','Arduino Sketchbook','arduino']
  ];
  const image = name => {
    const img = document.createElement('img');
    img.src = new URL(`assets/dashboard-objects/retro-v1/${name}.${name==='arduino'?'svg':'png'}`,base).href;
    img.alt = ''; img.decoding = 'async'; return img;
  };
  const link = ([key,label,icon], task) => {
    const a = document.createElement('a');
    a.href = new URL(`#${key}`,base).href;
    if (task) a.className='retro-task';
    if (key===page) a.setAttribute('aria-current','page');
    const text = document.createElement('span'); text.textContent=label;
    a.append(image(icon),text); return a;
  };
  const css=document.createElement('link'); css.rel='stylesheet';
  css.href=new URL('assets/workspace-taskbar.css?v=20261124-taskbar-nine',base).href;
  document.head.append(css);
  document.documentElement.dataset.workspaceTool=page;
  document.body.classList.add('workspace-taskbar-host');
  const bar=document.createElement('div'); bar.className='retro-taskbar'; bar.lang='en';
  const start=document.createElement('button'); start.type='button'; start.className='retro-start';
  start.setAttribute('aria-expanded','false'); start.setAttribute('aria-controls','workspaceStartMenu');
  const label=document.createElement('span'); label.textContent='Start';start.append(image('computer'),label);
  const nav=document.createElement('nav');nav.setAttribute('aria-label','Taskbar navigation');
  nav.append(...items.map(item=>link(item,true)));
  const clock=document.createElement('time'); clock.className='retro-clock';clock.setAttribute('aria-label','Current time');
  const menu=document.createElement('nav');menu.id='workspaceStartMenu';menu.className='retro-start-menu';menu.lang='en';menu.hidden=true;menu.setAttribute('aria-label','Start menu');
  menu.append(...items.map(item=>link(item,false)));
  const close=()=>{menu.hidden=true;start.setAttribute('aria-expanded','false');};
  start.addEventListener('click',()=>{menu.hidden=!menu.hidden;start.setAttribute('aria-expanded',String(!menu.hidden));});
  document.addEventListener('click',e=>{if(!menu.contains(e.target)&&!start.contains(e.target))close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){close();start.focus();}});
  menu.addEventListener('click',e=>{if(e.target.closest('a'))close();});
  const tick=()=>{const now=new Date();clock.textContent=now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});clock.dateTime=now.toISOString();};
  tick();setInterval(tick,30000);bar.append(start,nav,clock);document.body.append(bar,menu);
})();
