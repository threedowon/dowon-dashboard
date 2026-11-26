(() => {
  'use strict';
  const configs = {
    archive: ['File Cabinet','cabinet',['archiveUpload','archiveRefresh','archiveConnect'],'파일당 최대 5GB. 직접 삭제할 때까지 보관됩니다. 보관량 10GB 이상이면 경고합니다.'],
    arduino: ['Arduino Sketchbook','arduino',['sketchNew','sketchRefresh','sketchLogin'],'Browse sensor code, download source files and project settings, and open wiring guides.'],
    milestones: ['Milestones','milestones',['newProject','cloudSave','backup'],'Select projects to explore their roadmap. Open a project for its calendar and connection map.'],
    pdf: ['PDF Library','library',['pdfAdd','pdfRefresh','pdfConnect'],'Upload PDFs, search by title or tag, and select documents to manage their tags.'],
    ideas: ['Reference','ideas',['ideasImage','ideasLink','ideasNote','ideasRefresh'],'Paste images or links into the board. Drag cards to arrange them. Ctrl+wheel zooms; Ctrl+Z undoes.'],
    wirenest: ['WireNest','wirenest',['wnUpload','wnRefresh','wnConnect'],'Open the editor in a separate tab. Upload saved .wnest files here to keep backups.'],
    transfers: ['File Transfer','transfers',['transferUpload','transferRefresh','transferConnect'],'Choose files and a retention period. Downloads expire automatically after that period.'],
    signaltester: ['Signal Tester','signaltester',['signalBackupConnect','signalBackupRefresh'],'Download and run SignalTester.exe. The local testing interface opens automatically.'],
    hardware: ['Hardware Sheet','hardware',[],'Choose a project to edit its shared sheet. Product photos and purchase links appear in each item column. Open in new tab keeps the original green workbook design.']
  };
  const labels = {
    sketchNew:'New sketch',sketchRefresh:'Sync',sketchLogin:'Connect GitHub',newProject:'New project',cloudSave:'Sync',connectGithub:'Connect GitHub',backup:'Export JSON',import:'Import JSON',
    deleteSelectedProjects:'Delete selected',selectAllProjects:'Select all',clearProjects:'Clear selection',share:'Export HTML',exportPng:'Export PNG',printRoadmap:'Print / PDF',
    mapFitWidth:'Fit width',mapFitAll:'Fit all',editProject:'Edit project',addDetailMilestone:'Add milestone',addMilestone:'Add milestone',addOnDate:'Add milestone',addNote:'Add note',today:'Today',
    pdfConnect:'Connect GitHub',pdfAdd:'Upload PDF',pdfRefresh:'Sync',pdfClearSelection:'Clear selection',pdfBulkTags:'Add tags',pdfBulkDelete:'Delete',
    ideasNewProject:'New project',ideasImage:'Image',ideasLink:'Link',ideasNote:'Note',ideasUndo:'Undo',ideasRedo:'Redo',ideasEdit:'Edit',ideasDelete:'Delete',ideasFit:'Fit all',ideasConnect:'Connect GitHub',ideasRefresh:'Sync',ideasExport:'Export board',ideasImport:'Import board',ideasRetry:'Retry save',cardScheduleEdit:'Edit schedule',
    wnConnect:'Connect GitHub',wnRefresh:'Sync',transferConnect:'Connect GitHub',transferUpload:'Add files',transferRefresh:'Refresh',transferRetry:'Retry upload',
    signalBackupConnect:'Connect account',signalBackupRefresh:'Sync',signalPairButton:'Connect',signalForget:'Disconnect',signalRemoteConnect:'Connect',signalRemoteRefresh:'Refresh'
  };
  const $=id=>document.getElementById(id);
  const make=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;};
  const closeMenus=()=>document.querySelectorAll('.retro-page-menu details[open]').forEach(el=>el.open=false);
  const home=()=>{closeMenus();location.hash='home';};
  const help=document.createElement('dialog');help.className='retro-page-help';help.setAttribute('aria-label','Page help');
  const helpTitle=make('h2'),helpText=make('p'),helpClose=make('button','btn','OK');helpClose.type='button';helpClose.onclick=()=>help.close();help.append(helpTitle,helpText,helpClose);document.body.append(help);
  function showHelp(config){closeMenus();helpTitle.textContent=config[0]+' Help';helpText.textContent=config[3];help.showModal();}
  function titleFor(key,config){if(key==='milestones'&&!$('projectDetail').hidden)return 'Milestones — '+($('title').textContent||'Project');if(key==='ideas'&&location.hash.startsWith('#card/'))return $('ideasTitle').textContent||'Reference';return config[0];}
  function localize(){
    Object.entries(labels).forEach(([id,label])=>{const el=$(id);if(el&&el.textContent!==label)el.textContent=label;});
    const placeholders={pdfSearch:'Search documents',wnSearch:'Search backups',signalPairCode:'Port:connection code'};
    Object.entries(placeholders).forEach(([id,value])=>{if($(id))$(id).placeholder=value;});
    const names={pdfTitle:'PDF Library',transfersTitle:'File Transfer',projectsTitle:'Projects',roadmapTitle:'Project roadmap'};
    Object.entries(names).forEach(([id,name])=>{if($(id)&&$(id).textContent!==name)$(id).textContent=name;});
    document.querySelectorAll('[data-tab]').forEach(el=>{const text={calendar:'Calendar',connections:'Connection map'}[el.dataset.tab];if(text&&el.textContent!==text)el.textContent=text;});
    document.querySelectorAll('[data-map-view]').forEach(el=>{const text=el.dataset.mapView==='connections'?'Connection map':'Timeline';if(el.textContent!==text)el.textContent=text;});
  }
  Object.entries(configs).forEach(([key,config])=>{
    const section=document.querySelector('[data-screen="'+key+'"]');if(!section)return;
    section.classList.add('retro-page');
    const body=make('div','retro-page-body');while(section.firstChild)body.append(section.firstChild);
    const header=make('header','retro-titlebar'),icon=make('img');icon.src='assets/dashboard-objects/retro-v1/'+config[1]+(key==='arduino'?'.svg':'.png');icon.alt='';
    const title=make('h2','retro-page-caption',config[0]);const controls=make('div','retro-controls');
    for(const [label,glyph,fn] of [['Minimize','−',home],['Maximize','□',()=>{const max=section.classList.toggle('is-maximized');controls.querySelector('[data-maximize]').setAttribute('aria-pressed',String(max));window.dispatchEvent(new Event('resize'));}],['Close','×',home]]){
      const b=make('button','retro-control',glyph);b.type='button';b.setAttribute('aria-label',label+' '+config[0]);if(label==='Maximize'){b.dataset.maximize='';b.setAttribute('aria-pressed','false');}b.onclick=fn;controls.append(b);
    }
    header.append(icon,title,controls);
    const menu=make('nav','retro-page-menu');menu.setAttribute('aria-label',config[0]+' menu');
    function addMenu(name,actions){const d=make('details'),s=make('summary',null,name),p=make('div','retro-menu-popup');for(const [label,fn,target] of actions){const b=make('button',null,label);b.type='button';b.onclick=()=>{closeMenus();fn();};if(target)b.dataset.target=target;p.append(b);}d.append(s,p);d.addEventListener('toggle',()=>{if(d.open){menu.querySelectorAll('details').forEach(other=>{if(other!==d)other.open=false;});d.querySelectorAll('[data-target]').forEach(b=>{b.disabled=!$(b.dataset.target)||$(b.dataset.target).disabled;});}});menu.append(d);return p;}
    addMenu('File',[...config[2].map(id=>[labels[id]||'Open',()=>$(id)?.click(),id]),['Back to Home',home]]);
    const editMenu=key==='arduino'?addMenu('Edit',[['Copy code',()=>$('sketchCopy')?.click(),'sketchCopy'],['Edit sketch',()=>$('sketchEdit')?.click(),'sketchEdit']]):key==='wirenest'?addMenu('Edit',[['Delete selected backup',()=>$('wnDeleteBackup').click(),'wnDeleteBackup']]):key==='ideas'?addMenu('Edit',[['Undo',()=>$('ideasUndo').click(),'ideasUndo'],['Redo',()=>$('ideasRedo').click(),'ideasRedo']]):key==='transfers'?addMenu('Edit',[['Retry upload',()=>$('transferRetry').click(),'transferRetry']]):key==='pdf'?addMenu('Edit',[['Select all',()=>{if(!$('pdfSelectAll').checked)$('pdfSelectAll').click();},'pdfSelectAll'],['Clear selection',()=>$('pdfClearSelection').click(),'pdfClearSelection'],['Add tags',()=>$('pdfBulkTags').click(),'pdfBulkTags'],['Delete',()=>$('pdfBulkDelete').click(),'pdfBulkDelete']]):null;
    const viewMenu=addMenu('View',[...(key==='pdf'?[['Grid view',()=>$('pdfGridView').click()],['List view',()=>$('pdfListView').click()]]:[]),['Maximize / Restore',()=>controls.querySelector('[data-maximize]').click()],['Back to Home',home]]);
    addMenu('Help',[[config[0]+' Help',()=>showHelp(config)]]);
    const status=make('footer','retro-page-status');status.append(make('span',null,config[0]),make('span',null,'Workspace'));
    section.append(header,menu,body,status);
    if(key==='ideas'){
      // Move the existing controls, retaining their listeners and selection state.
      const toolbar=body.querySelector('.ideas-toolbar'),projects=body.querySelector('.ideas-project-row');
      toolbar.prepend(projects);projects.querySelector('label').firstChild.textContent='Project: ';
      const group=(className,ids)=>{const g=make('div','reference-tool-group '+className);ids.forEach(id=>g.append($(id)));toolbar.append(g);return g;};
      group('reference-insert',['ideasImage','ideasLink','ideasNote']);
      group('reference-history',['ideasUndo','ideasRedo']);
      const zoomTools=body.querySelector('.ideas-zoom-tools');toolbar.append(zoomTools);
      editMenu.append(make('hr'),$('ideasEdit'),$('ideasDelete'));
      const syncEditLabel=()=>{$('ideasEdit').textContent='Edit selected';};
      editMenu.parentElement.addEventListener('toggle',()=>{if(editMenu.parentElement.open)syncEditLabel();});
      viewMenu.append(make('hr'),body.querySelector('.ideas-snap-tools'),make('hr'));
      $('ideasZoomOut').textContent='Zoom out';$('ideasZoomIn').textContent='Zoom in';$('ideasZoomOut').setAttribute('aria-label','Zoom out');$('ideasZoomIn').setAttribute('aria-label','Zoom in');$('ideasImage').classList.remove('primary');
      viewMenu.append($('ideasZoomIn'),$('ideasZoomOut'));
      for(const id of ['ideasEdit','ideasDelete','ideasZoomIn','ideasZoomOut'])$(id).addEventListener('click',closeMenus);
      for(const id of ['ideasNewProject','ideasImage','ideasLink','ideasNote','ideasUndo','ideasRedo','ideasFit'])$(id).classList.add('reference-icon-button');
      $('ideasCount').classList.add('reference-count');status.firstChild.replaceWith($('ideasCount'));
    }

    const update=()=>{const next=titleFor(key,config);if(title.textContent!==next)title.textContent=next;};
    window.addEventListener('hashchange',()=>{closeMenus();update();});
    if(key==='milestones')new MutationObserver(update).observe($('title'),{childList:true,subtree:true,characterData:true});
    if(key==='ideas')new MutationObserver(update).observe($('ideasTitle'),{childList:true,subtree:true,characterData:true});
    update();
  });
  document.addEventListener('click',e=>{if(!e.target.closest('.retro-page-menu'))closeMenus();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenus();});
  // Explorer-style tag rail uses the existing filter and file nodes with their handlers intact.
  const pdfBody=$('pdfPage')?.querySelector('.retro-page-body');
  if(pdfBody){
    const layout=make('div','retro-library-layout'),aside=make('aside','retro-library-sidebar'),files=make('div','retro-library-main');
    aside.append(make('h2',null,'Tags'),$('pdfTags'));
    const toolbar=pdfBody.querySelector('.library-toolbar'),search=toolbar.querySelector('label');
    search.classList.add('pdf-search-control');search.firstChild.textContent='';$('pdfSearch').setAttribute('aria-label','Search documents');
    const searchButton=make('button','btn pdf-search-button');searchButton.type='button';searchButton.setAttribute('aria-label','Search documents');searchButton.onclick=()=>{$('pdfSearch').focus();$('pdfSearch').oninput();};search.append(searchButton);
    toolbar.prepend($('pdfAdd'),$('pdfRefresh'),$('pdfBulkDelete'));toolbar.append(search);
    files.append($('pdfBulkbar'),$('pdfDropzone'),$('pdfList'));layout.append(aside,files);toolbar.after(layout);
    $('pdfClearSelection').hidden=true;
    const status=$('pdfPage').querySelector('.retro-page-status');status.replaceChildren($('pdfCount'),make('span',null,'/'),$('pdfSelectionCount'));
    $('pdfPage').querySelector('.retro-titlebar>img').src='assets/pdf-file.svg';
  }
  // Decorative icons reuse the existing desktop artwork; all actions keep their original handlers.
  for(const [page,icon] of [['transfersPage','transfers'],['wirenestPage','wirenest']]){
    const heading=$(page)?.querySelector('.placeholder-heading>div:first-child');if(heading){heading.classList.add('retro-icon-heading');const img=make('img','retro-heading-icon');img.src='assets/dashboard-objects/retro-v1/'+icon+'.png';img.alt='';heading.prepend(img);}
  }
  $('transferUpload')?.classList.remove('primary');
  document.querySelectorAll('#transfersPage .retro-heading-icon,#transfersPage>.retro-titlebar>img').forEach(img=>img.src='assets/transfer-floppies.svg');
  const download=document.querySelector('#signaltesterPage .signal-download');
  const testerWeb='signal-tester/signal_tester_ui/index.html';
  document.querySelectorAll('a[href="http://127.0.0.1:6699/"]').forEach(link=>{link.href=testerWeb;link.title='최신 Signal Tester 웹 화면 열기';});
  const testerNote=download?.querySelector('.signal-note');
  if(testerNote)testerNote.textContent='처음에는 통신 프로그램 v1.3.0 이상을 설치하세요. 웹 화면에서 PC 연결 → 연결 허용을 누르면 됩니다. 이후 디자인 변경은 새로고침으로 적용되며 기존 CMD도 사용할 수 있습니다.';
  const testerFooter=document.querySelector('#signaltesterPage .signal-footer-note');
  if(testerFooter)testerFooter.textContent='센서 값은 PC에서 처리합니다. Serial·UDP·OSC 주소별 값 확인을 지원합니다. 브라우저를 닫아도 통신은 계속되며, 완전히 중지하려면 설정의 프로그램 종료를 누르세요.';
  if(download){const img=make('img','retro-signal-icon');img.src='assets/dashboard-objects/retro-v1/signaltester.png';img.alt='';download.querySelector('strong').after(img);}
  document.querySelectorAll('#signaltesterPage .signal-setup ol li').forEach((li,i)=>{const img=make('img','retro-step-icon');img.src='assets/dashboard-objects/retro-v1/'+['library','computer','wirenest'][i]+'.png';img.alt='';li.prepend(img);});
  localize();window.addEventListener('hashchange',localize);
  // Only labels of known controls are localized; user content and canvas nodes are never visited.
  for(const id of ['projectOverview','projectDetail','pdfPage','wirenestPage','transfersPage']){
    const el=$(id);if(el){let queued=false;new MutationObserver(()=>{if(!queued){queued=true;queueMicrotask(()=>{queued=false;localize();});}}).observe(el,{childList:true,subtree:true});}
  }
})();
