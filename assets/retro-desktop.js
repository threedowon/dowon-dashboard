(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const start = $('retroStart'), menu = $('retroStartMenu'), panel = $('retroMainWindow');
  if (!start || !menu || !panel) return;
  const closeMenu = () => { menu.hidden = true; start.setAttribute('aria-expanded','false'); };
  const toggleMenu = () => { menu.hidden = !menu.hidden; start.setAttribute('aria-expanded', String(!menu.hidden)); };
  const setMaximized = value => { $('homePage').classList.toggle('retro-maximized',value); document.querySelectorAll('[data-retro-action="maximize"]').forEach(el=>el.setAttribute('aria-pressed',String(value))); };
  const restore = () => { panel.hidden = false; setMaximized(false); };
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
