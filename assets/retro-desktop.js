(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const start = $('retroStart'), menu = $('retroStartMenu'), panel = $('retroMainWindow');
  if (!start || !menu || !panel) return;
  const closeMenu = () => { menu.hidden = true; start.setAttribute('aria-expanded','false'); };
  const toggleMenu = () => { menu.hidden = !menu.hidden; start.setAttribute('aria-expanded', String(!menu.hidden)); };
  const setMaximized = value => { $('homePage').classList.toggle('retro-maximized',value); document.querySelectorAll('[data-retro-action="maximize"]').forEach(el=>el.setAttribute('aria-pressed',String(value))); };
  const restore = () => { panel.hidden = false; setMaximized(false); };
  const computer=$('retroComputer');let syncingComputer=false;
  const computerStatus=text=>{restore();$('retroHomeStatus').textContent=text;computer.title=text;};
  async function syncComputer(){
    if(syncingComputer)return;
    if(document.documentElement.dataset.readonly==='true'){computerStatus('GitHub sync is unavailable in shared snapshots.');return;}
    if(['localhost','127.0.0.1'].includes(location.hostname)){computerStatus('Open dashboard.3dowon.com to connect to GitHub.');return;}
    syncingComputer=true;computer.disabled=true;computer.setAttribute('aria-busy','true');
    computerStatus('Checking GitHub connection…');
    try{
      const response=await fetch('https://api.3dowon.com/api/me',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(response.status===401){computerStatus('Opening GitHub login…');location.href='https://api.3dowon.com/auth/login';return;}
      if(!response.ok)throw Error('Could not check GitHub connection. Please try again.');
      const sync=$('cloudSave');
      if(typeof sync?.onclick!=='function')throw Error('GitHub sync is not ready. Please reload and try again.');
      computerStatus('Syncing workspace with GitHub…');
      await sync.onclick();
      computerStatus($('cloudStatus').title||$('cloudStatus').textContent||'GitHub sync finished.');
    }catch(error){computerStatus(error.name==='TimeoutError'?'GitHub connection timed out. Please try again.':error instanceof TypeError?'Could not reach GitHub sync. Check your connection and try again.':error.message);}
    finally{syncingComputer=false;computer.disabled=false;computer.setAttribute('aria-busy','false');}
  }
  computer.title='Double-click to sync with GitHub or sign in';
  computer.addEventListener('dblclick',syncComputer);
  // Native button keyboard activation produces a click with detail 0.
  computer.addEventListener('click',event=>{if(event.detail===0)syncComputer();});
  start.addEventListener('click', toggleMenu);
  document.addEventListener('click', e => { if (!menu.contains(e.target) && !start.contains(e.target) && !e.target.closest('[data-retro-action="menu"]')) closeMenu(); });
  document.addEventListener('keydown', e => { if(e.key === 'Escape' && !menu.hidden) { closeMenu(); start.focus(); } });
  document.querySelectorAll('[data-retro-action]').forEach(button => button.addEventListener('click', () => {
    switch(button.dataset.retroAction) {
      case 'menu': toggleMenu(); break;
      case 'restore': restore(); location.hash='home'; break;
      case 'minimize': setMaximized(false); panel.hidden=true; $('retroComputer').focus(); break;
      case 'maximize': setMaximized(!$('homePage').classList.contains('retro-maximized')); break;
      case 'note': $('retroNote').hidden=false; $('retroNoteText').focus(); closeMenu(); break;
      case 'close-note': $('retroNote').hidden=true; break;
      case 'help': $('retroHomeStatus').textContent='Click an icon to open a tool. Use the taskbar to switch pages.'; break;
    }
  }));
  document.querySelectorAll('.retro-taskbar a,.retro-start-menu a').forEach(link => link.addEventListener('click', () => { if(link.hash === '#home') restore(); closeMenu(); }));
  window.addEventListener('hashchange', () => { closeMenu(); if(location.hash === '#home') restore(); });
  const note = $('retroNoteText');
  try { const saved=localStorage.getItem('workspace.retro.quickNote'); if(saved!==null) note.value=saved; } catch {}
  note.addEventListener('input', () => { try { localStorage.setItem('workspace.retro.quickNote',note.value); } catch {} });
  const tick = () => { const now=new Date(); $('retroClock').textContent=now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}); $('retroClock').dateTime=now.toISOString(); };
  tick(); setInterval(tick,30000);
})();
