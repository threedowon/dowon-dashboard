(() => {
  'use strict';
  const $=id=>document.getElementById(id),page=$('milestonesPage');if(!page)return;
  const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  const overview=$('projectOverview'),detail=$('projectDetail'),list=$('projectList');
  const toolbar=make('div','milestone-toolbar');
  toolbar.append($('newProject'),$('cloudSave'));
  const search=make('label','milestone-search'),searchIcon=make('span','milestone-search-icon','⌕'),input=make('input');
  input.type='search';input.placeholder='Search projects…';input.setAttribute('aria-label','Search projects');search.append(searchIcon,input);toolbar.append(search);
  overview.prepend(toolbar);
  $('newProject').classList.remove('primary');
  const table=make('div','milestone-table'),header=make('div','milestone-table-header'),select=make('input');
  select.type='checkbox';select.setAttribute('aria-label','Select all projects');
  const selectCell=make('label','milestone-select-all');selectCell.append(select);
  header.append(selectCell,make('span',null,'Project'),make('span',null,'Progress'),make('span',null,'Updated'));
  list.before(table);table.append(header,list);
  const noResults=make('p','milestone-no-results','No matching projects.');noResults.hidden=true;table.append(noResults);
  const footer=page.querySelector('.retro-page-status');footer.replaceChildren(make('span','milestone-selection-status'),$('saveState'));
  function refresh(){
    const rows=[...list.querySelectorAll('.project-list-row')],query=input.value.trim().toLocaleLowerCase();let visible=0;
    for(const row of rows){row.hidden=!(row.querySelector('.project-summary')?.textContent||'').toLocaleLowerCase().includes(query);if(!row.hidden)visible++;}
    const checked=rows.filter(row=>row.querySelector('input').checked).length;
    select.checked=rows.length>0&&checked===rows.length;select.indeterminate=checked>0&&checked<rows.length;select.disabled=!rows.length;
    noResults.hidden=!rows.length||visible>0;
    footer.firstChild.textContent=detail.hidden?`${checked} / ${rows.length} projects selected${query?` · ${visible} shown`:''}`:'Milestones';
  }
  input.addEventListener('input',refresh);
  select.addEventListener('change',()=>$(select.checked?'selectAllProjects':'clearProjects').click());
  new MutationObserver(refresh).observe(list,{childList:true});window.addEventListener('hashchange',refresh);
  const menu=page.querySelector('.retro-page-menu');
  const fileMenu=[...menu.querySelectorAll('details')].find(el=>el.querySelector('summary').textContent==='File').querySelector('.retro-menu-popup');
  for(const id of ['connectGithub','cloudRestore','import','cloudBackup','share','printRoadmap'])fileMenu.append($(id));
  const editMenu=make('details'),editLabel=make('summary',null,'Edit'),editPopup=make('div','retro-menu-popup');
  editPopup.append($('selectAllProjects'),$('clearProjects'),$('deleteSelectedProjects'));editMenu.append(editLabel,editPopup);menu.children[0].after(editMenu);
  editMenu.addEventListener('toggle',()=>{if(editMenu.open)menu.querySelectorAll('details').forEach(el=>{if(el!==editMenu)el.open=false;});});
  editPopup.addEventListener('click',()=>editMenu.open=false);
  const viewMenu=[...menu.querySelectorAll('details')].find(el=>el.querySelector('summary').textContent==='View').querySelector('.retro-menu-popup');
  const roadmapToggle=make('button',null,'Show project roadmap');roadmapToggle.type='button';roadmapToggle.setAttribute('aria-pressed','false');
  roadmapToggle.onclick=()=>{const shown=overview.classList.toggle('show-roadmap');roadmapToggle.setAttribute('aria-pressed',String(shown));roadmapToggle.textContent=shown?'Hide project roadmap':'Show project roadmap';viewMenu.parentElement.open=false;window.dispatchEvent(new Event('resize'));};viewMenu.prepend(roadmapToggle);
  // Keep the map tools identical in the overview and project detail.
  const mapTools=page.querySelector('.map-zoom');mapTools.append($('exportPng'));
  const mapHelp=page.querySelector('.roadmap-controls>p');if(mapHelp)$('roadmapBoard').after(mapHelp);
  for(const id of ['mapZoomOut','mapZoomIn','mapFitWidth'])viewMenu.append($(id));
  const detailToolbar=make('div','milestone-detail-toolbar');detailToolbar.append(detail.querySelector('.milestone-back'),$('editProject'),$('addDetailMilestone'));detail.prepend(detailToolbar);
  const summary=make('div','milestone-summary'),head=detail.querySelector('.head'),stats=detail.querySelector('.stats'),icon=make('img','milestone-project-icon');
  icon.src='assets/dashboard-objects/retro-v1/milestones.png';icon.alt='';head.before(summary);summary.append(icon,head,stats);
  stats.querySelectorAll('.stat .small').forEach((el,i)=>el.textContent=['Progress','Completed','Updated'][i]);
  const dayPanel=detail.querySelector('.daydetails'),dayHeading=make('h2','milestone-day-heading');
  dayPanel.prepend(dayHeading);
  function updateDay(){const today=new Date(),localDate=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');dayHeading.textContent=detail.querySelector('[data-day].selected')?.dataset.day===localDate?'Today':'Selected day';}
  new MutationObserver(updateDay).observe($('dayTitle'),{childList:true});
  $('prevMonth').setAttribute('aria-label','Previous month');$('nextMonth').setAttribute('aria-label','Next month');
  $('calendarView').querySelector('[role="group"]').setAttribute('aria-label','Calendar navigation');
  refresh();updateDay();
})();
