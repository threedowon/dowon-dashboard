(() => {
  'use strict';
  const mount=document.getElementById('hardwareMount'),help=document.getElementById('hardwareHelp');
  const page=document.getElementById('hardwarePage'),open=page.querySelector('a[target="_blank"]');
  const readonly=document.documentElement.dataset.readonly==='true';
  const base=['localhost','127.0.0.1'].includes(location.hostname)?'http://127.0.0.1:8787':'https://api.3dowon.com';
  let loaded=false,loading=false,selected='',projects=[];
  const controls=document.createElement('div');controls.className='hardware-projects';controls.setAttribute('aria-label','하드웨어 프로젝트');
  const message=document.createElement('span');message.className='small';message.setAttribute('role','status');
  page.querySelector('.page-intro').replaceWith(controls);
  help.replaceChildren(message);
  const dialog=document.createElement('dialog');dialog.className='hardware-project-dialog';
  dialog.innerHTML='<form><h2>새 프로젝트</h2><label>프로젝트명<input name="projectName" required maxlength="80" placeholder="예: 인터랙티브 전시" autocomplete="off"></label><p class="small" role="alert"></p><div><button type="button" class="btn">취소</button><button type="submit" class="btn primary">프로젝트 만들기</button></div></form>';
  page.append(dialog);
  const form=dialog.querySelector('form'),cancel=form.querySelector('[type="button"]'),submit=form.querySelector('[type="submit"]');
  let creating=false;
  cancel.onclick=()=>dialog.close();dialog.addEventListener('cancel',e=>{if(creating)e.preventDefault();});
  async function api(options){const response=await fetch(base+'/api/hardware-projects',{credentials:'include',...options});if(!response.ok){const error=new Error(response.status===401?'프로젝트 관리는 본인 로그인이 필요합니다.':await response.text());error.status=response.status;throw error;}return response.json();}
  function choose(id){selected=id;const url='./hardware/'+(id?'?project='+encodeURIComponent(id):'');open.href=url;
    const frame=document.createElement('iframe');frame.title=(projects.find(p=>p.id===id)?.name||'기존 신청표')+' · Hardware Sheet';frame.src=url+(id?'&':'?')+'theme=retro';frame.className='hardware-frame';mount.replaceChildren(frame);render();}
  function button(label,click){const b=document.createElement('button');b.type='button';b.className='btn';b.textContent=label;b.onclick=click;return b;}
  function render(){controls.replaceChildren();const label=document.createElement('strong');label.textContent='Project';controls.append(label);
    for(const project of projects){const b=button(project.name,()=>choose(project.id));b.setAttribute('aria-pressed',String(project.id===selected));if(project.id===selected)b.classList.add('primary');controls.append(b);}
    controls.append(button('+ New project',()=>{form.reset();form.querySelector('[role="alert"]').textContent='';dialog.showModal();form.elements.projectName.focus();}));
  }
  async function load(){if(loading)return;loading=true;message.textContent='Loading projects…';
    try{const data=await api();projects=data.projects;loaded=true;if(!projects.some(p=>p.id===selected))selected='';render();message.textContent='Choose a project to view its sheet. Open in new tab to share the original workbook.';}
    catch(error){controls.replaceChildren(button(error.status===401?'Sign in to manage projects':'Reload projects',()=>{if(error.status===401){sessionStorage.setItem('dowon:open-hardware','1');location.href=base+'/auth/login';}else load();}));message.textContent=error.message;}
    finally{loading=false;}
  }
  form.onsubmit=async e=>{e.preventDefault();if(creating)return;creating=true;submit.disabled=cancel.disabled=true;form.querySelector('[role="alert"]').textContent='만드는 중…';
    try{const project=await api({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:form.elements.projectName.value.trim()})});projects.push(project);choose(project.id);dialog.close();}
    catch(error){form.querySelector('[role="alert"]').textContent=error.message;}
    finally{creating=false;submit.disabled=cancel.disabled=false;}
  };
  function show(){if(location.hash!=='#hardware')return;if(readonly){controls.replaceChildren();message.textContent='공유 HTML에는 프로젝트 관리 기능이 포함되지 않습니다.';return;}
    if(!mount.firstElementChild)choose('');if(!loaded)load();}
  if(sessionStorage.getItem('dowon:open-hardware')){sessionStorage.removeItem('dowon:open-hardware');location.hash='hardware';}
  window.addEventListener('hashchange',show);show();
})();
