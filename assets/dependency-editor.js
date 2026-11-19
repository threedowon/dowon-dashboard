/* Session undo snapshots include data changes, not navigation or transient drag previews. */
globalThis.EditHistory = {
  create(initial,limit=50){
    let current=JSON.stringify(initial);const past=[],future=[];
    return {
      record(value){const next=JSON.stringify(value);if(next===current)return false;past.push(current);if(past.length>limit)past.shift();current=next;future.length=0;return true;},
      undo(){if(!past.length)return null;future.push(current);current=past.pop();return JSON.parse(current);},
      redo(){if(!future.length)return null;past.push(current);current=future.pop();return JSON.parse(current);},
      get canUndo(){return past.length>0;},get canRedo(){return future.length>0;}
    };
  }
};
/* Direct manipulation for the SVG map; exported diagrams contain no editor controls. */
globalThis.DependencyEditor = {
  attach({ board, toolbar, getProjects, getModel, isActive, commit, edit, navigate, createId }) {
    let selected=null,edge=null,pending=null,drag=null,suppressClickUntil=0;
    const status=toolbar.querySelector('[data-flow-status]');
    const control=name=>toolbar.querySelector(`[data-flow-action="${name}"]`);
    const tell=text=>{status.textContent=text;};
    const lookup=id=>DependencyMap.find(getProjects(),id);
    const hasNode=id=>[...board.querySelectorAll('[data-m]')].some(n=>n.dataset.m===id);
    const portInfo=el=>({id:el.dataset.portNode,side:el.dataset.side,x:Number(el.dataset.x),y:Number(el.dataset.y)});
    function clearPreview(){board.querySelector('.flow-new-preview')?.remove();board.querySelector('.flow-preview')?.remove();board.querySelector('.flow-drag-ghost')?.remove();board.querySelector('.flow-resize-preview')?.remove();board.dataset.moving='false';board.querySelectorAll('.is-target,.is-dragging,.is-drop-target,.is-blocked,.is-date-target').forEach(el=>el.classList.remove('is-target','is-dragging','is-drop-target','is-blocked','is-date-target'));}
    function decorate(){
      toolbar.hidden=!isActive();board.dataset.connecting=String(!!pending);
      for(const node of board.querySelectorAll('.flow-node')){
        const active=node.dataset.m===selected;node.classList.toggle('is-selected',active);node.setAttribute('aria-pressed',String(active));
      }
      for(const port of board.querySelectorAll('.flow-port')){
        const active=port.dataset.portNode===selected||!!pending;
        port.classList.toggle('is-visible',active);port.setAttribute('tabindex',active?'0':'-1');
      }
      for(const line of board.querySelectorAll('.flow-edge'))line.classList.toggle('is-selected',!!edge&&line.dataset.edgeFrom===edge.from&&line.dataset.edgeTo===edge.to);
      drawEdgeControls();
      control('edit').disabled=!selected;control('detail').disabled=!selected;control('unlink').disabled=!edge;
      const item=getModel()?.items?.find(m=>m.id===selected);
      control('left').disabled=!item||item.column===0;
      control('right').disabled=!item||item.column>=getModel().columns.length-1;
      control('cancel').hidden=!pending;
      for(const select of board.querySelectorAll('[data-flow-status-select]'))select.disabled=!isActive();
    }
    function selectedEdge(){return getModel()?.edges?.find(item=>item.from.id===edge?.from&&item.to.id===edge?.to);}
    function drawEdgeControls(preview){
      board.querySelector('.flow-edge-controls')?.remove();
      const item=selectedEdge(),svg=board.querySelector('svg');if(!item||!svg||!isActive())return;
      const model=getModel(),route=DependencyMap.routeEdge(model,preview?{...item,...preview}:item);
      const line=[...board.querySelectorAll('.flow-edge')].find(el=>el.dataset.edgeFrom===edge.from&&el.dataset.edgeTo===edge.to);
      line?.querySelectorAll('path').forEach(path=>path.setAttribute('d',route.path));
      const ns='http://www.w3.org/2000/svg',group=document.createElementNS(ns,'g');group.setAttribute('class','flow-edge-controls');
      const points=route.points;if(points.length<2)return;
      const handles=[['start',points[0]],...points.slice(1).map((p,i)=>[String(i),[(p[0]+points[i][0])/2,(p[1]+points[i][1])/2]]),['end',points.at(-1)]];
      for(const [index,[x,y]]of handles){
        const endpoint=index==='start'||index==='end',handle=document.createElementNS(ns,'g');
        for(const [name,value]of Object.entries({'data-edge-handle':index,tabindex:0,role:'button','aria-label':endpoint?'연결 끝점 이동':'연결선 구간 이동. 방향키로 조절',class:'flow-edge-handle'}))handle.setAttribute(name,value);
        const hit=document.createElementNS(ns,'circle');for(const [name,value]of Object.entries({cx:x,cy:y+model.top,r:12,fill:'transparent'}))hit.setAttribute(name,value);
        const mark=document.createElementNS(ns,'circle');for(const [name,value]of Object.entries({cx:x,cy:y+model.top,r:5,fill:endpoint?'#fff':'#4265ff',stroke:endpoint?'#4265ff':'#fff','stroke-width':2,'pointer-events':'none'}))mark.setAttribute(name,value);
        handle.append(hit,mark);group.append(handle);
      }
      svg.append(group);
    }
    function edgePosition(clientX,clientY){const p=svgPoint(clientX,clientY);return p?[p.x,p.y-getModel().top]:null;}
    function previewEdge(clientX,clientY){
      const point=edgePosition(clientX,clientY);if(!point)return;
      drag.updates=DependencyMap.adjustRoute(drag.item,drag.points,drag.handle,point);
      drawEdgeControls(drag.updates);tell('놓으면 연결선 위치가 저장됩니다. Esc로 취소합니다.');
    }
    function saveEdge(updates){
      if(!edge||!updates)return;
      const item=selectedEdge(),route=item&&DependencyMap.routeEdge(getModel(),{...item,...updates});
      if(!route||route.blocked){decorate();tell('이 위치에는 연결선을 배치할 공간이 없어요.');return;}
      updates={...updates,route:route.points.slice(1,-1).map(([x,y])=>[x-item.from.x,y-item.from.y])};
      const result=DependencyMap.setRoute(getProjects(),edge.from,edge.to,updates);
      if(result.changed)commit(result.project,`연결선 위치 변경: ${result.milestone.title}`);
      decorate();tell('연결선 위치를 저장했어요. Ctrl+Z로 되돌릴 수 있습니다.');
    }
    function refresh(){
      drag=null;pending=null;clearPreview();
      if(!isActive()||!hasNode(selected))selected=null;
      if(edge&&(!hasNode(edge.from)||!hasNode(edge.to)||!DependencyMap.normalize(lookup(edge.to)?.milestone.dependsOn).some(r=>DependencyMap.key(r.projectId,r.milestoneId)===edge.from)))edge=null;
      decorate();
      if(edge)tell('연결선의 동그란 조절점을 드래그해 위치를 바꿀 수 있습니다.');
      else if(selected)tell(`${lookup(selected)?.milestone.title||'일정'} · 네모 핸들을 빈 곳으로 끌면 연결된 새 카드가 생깁니다.`);
      else tell('카드 위·아래 테두리를 끌어 날짜를 조절하고, 카드 안에서 상태를 선택하세요.');
    }
    function selectNode(id){selected=id;edge=null;decorate();tell(`${lookup(id)?.milestone.title||'일정'} · 네모 핸들: 새 카드 만들기 / 기존 카드에 놓기: 연결`);}
    function start(port){
      pending=port;selected=port.id;edge=null;clearPreview();decorate();
      tell(`${lookup(port.id)?.milestone.title||'이 일정'} → 빈 곳에 놓으면 새 카드, 기존 카드에 놓으면 연결합니다. Esc로 취소합니다.`);
    }
    function cancel(){pending=null;drag=null;clearPreview();decorate();tell('작업을 취소했어요.');}
    function moveCard(id,targetColumn){
      const result=DependencyMap.move(getProjects(),id,targetColumn,getModel());
      drag=null;clearPreview();selected=id;edge=null;
      if(result.error){decorate();tell(result.error);return;}
      if(result.changed)commit(result.project,`연결 맵 배치: ${result.milestone.title} → ${targetColumn+1}열`);
      [...board.querySelectorAll('.flow-node')].find(node=>node.dataset.m===id)?.focus({preventScroll:true});
      decorate();tell(result.changed?`${targetColumn+1}열로 옮겼어요. 날짜와 선행 연결은 유지됩니다.`:'현재 열입니다.');
    }
    function svgPoint(clientX,clientY){
      const svg=board.querySelector('svg'),bounds=svg?.getBoundingClientRect();
      if(!bounds?.width||!bounds.height)return null;
      return {x:(clientX-bounds.left)*Number(svg.getAttribute('width'))/bounds.width,y:(clientY-bounds.top)*Number(svg.getAttribute('height'))/bounds.height};
    }
    function resizeValue(id,edge,clientX,clientY){
      const bounds=board.getBoundingClientRect(),point=svgPoint(clientX,clientY),target=lookup(id);
      if(!target||!point||clientX<bounds.left||clientX>bounds.right||clientY<bounds.top||clientY>bounds.bottom)return null;
      const date=DependencyMap.dateAt(getModel(),point.y-getModel().top);
      if(!date)return null;
      const m=target.milestone,start=Roadmap.date(m.start)===null?m.due:m.start;
      return edge==='start'?(date>m.due?m.due:date):(date<start?start:date);
    }
    function resizeCard(id,endpoint,date){
      const result=DependencyMap.resize(getProjects(),id,endpoint,date);
      pending=null;drag=null;clearPreview();selected=id;edge=null;
      if(result.error){decorate();tell(result.error);return;}
      if(result.changed)commit(result.project,`${endpoint==='start'?'시작일':'종료일'} 변경: ${result.milestone.title} → ${date}`);
      [...board.querySelectorAll('[data-resize-node]')].find(el=>el.dataset.resizeNode===id&&el.dataset.resize===endpoint)?.focus({preventScroll:true});
      decorate();tell(result.changed?`${endpoint==='start'?'시작일':'종료일'}을 ${date}로 저장했어요.`:'날짜가 유지됩니다.');
    }
    function previewResize(clientX,clientY){
      const model=getModel(),date=resizeValue(drag.id,drag.edge,clientX,clientY);
      board.dataset.moving='true';
      board.querySelectorAll('.is-date-target').forEach(el=>el.classList.remove('is-date-target'));
      board.querySelector('.flow-resize-preview')?.remove();
      if(!date)return;
      const item=model.items.find(m=>m.id===drag.id),day=DependencyMap.dayPosition(model,date);
      const y=drag.edge==='start'?day.y+DependencyMap.cardInset:item.y;
      const bottom=drag.edge==='due'?day.y+day.height-DependencyMap.cardInset:item.y+item.height;
      const svg=board.querySelector('svg'),ns='http://www.w3.org/2000/svg',group=document.createElementNS(ns,'g');
      group.setAttribute('class','flow-resize-preview');group.setAttribute('pointer-events','none');
      const rect=document.createElementNS(ns,'rect');
      for(const [k,v]of Object.entries({x:item.x,y:model.top+y,width:item.width,height:Math.max(6,bottom-y),rx:5,fill:'#dcebd8','fill-opacity':'.65',stroke:'#11563f','stroke-width':2,'stroke-dasharray':'5 3'}))rect.setAttribute(k,v);
      group.append(rect);
      const label=document.createElementNS(ns,'text');label.textContent=`${drag.edge==='start'?'시작일':'종료일'} ${date}`;
      for(const [k,v]of Object.entries({x:item.x+8,y:model.top+(drag.edge==='start'?y+19:bottom-10),'font-size':12,fill:'#11563f','font-weight':700}))label.setAttribute(k,v);
      group.append(label);svg.append(group);
      board.querySelector(`[data-date="${date}"]`)?.classList.add('is-date-target');
      tell(`${drag.edge==='start'?'시작일':'종료일'} ${date} · 놓으면 저장됩니다. Esc로 취소합니다.`);
    }
    function dropColumn(clientX,clientY){
      const bounds=board.getBoundingClientRect();
      if(clientX<bounds.left||clientX>bounds.right||clientY<bounds.top||clientY>bounds.bottom)return null;
      const point=svgPoint(clientX,clientY);if(!point)return null;
      return [...board.querySelectorAll('[data-flow-column]')].find(el=>point.x>=Number(el.dataset.x)&&point.x<=Number(el.dataset.x)+Number(el.dataset.width)&&point.y>=Number(el.dataset.top)&&point.y<=Number(el.dataset.top)+Number(el.dataset.height))||null;
    }
    function previewMove(clientX,clientY){
      board.dataset.moving='true';
      board.querySelectorAll('.is-drop-target,.is-blocked').forEach(el=>el.classList.remove('is-drop-target','is-blocked'));
      const column=dropColumn(clientX,clientY),svg=board.querySelector('svg');
      const source=[...board.querySelectorAll('.flow-node')].find(el=>el.dataset.m===drag.id);
      if(!source||!svg)return;
      source.classList.add('is-dragging');
      let ghost=svg.querySelector('.flow-drag-ghost');
      if(!ghost){ghost=source.cloneNode(true);ghost.querySelectorAll('foreignObject,.flow-resize').forEach(el=>el.remove());ghost.setAttribute('class','flow-drag-ghost');ghost.removeAttribute('data-m');ghost.removeAttribute('tabindex');ghost.removeAttribute('role');ghost.setAttribute('pointer-events','none');ghost.setAttribute('aria-hidden','true');svg.append(ghost);}
      if(!column){ghost.setAttribute('visibility','hidden');return;}
      const index=Number(column.dataset.flowColumn),error=DependencyMap.placement(getModel(),drag.id,index);
      column.classList.add(error?'is-blocked':'is-drop-target');
      ghost.setAttribute('visibility','visible');ghost.setAttribute('transform',`translate(${Number(column.dataset.x)+12-Number(source.dataset.x)} 0)`);
      ghost.setAttribute('opacity',error?'0.25':'0.65');
      tell(error||`${index+1}열에 놓으면 이동합니다. 날짜는 유지됩니다.`);
    }
    function finish(id,side='top'){
      if(!pending)return;
      const from=pending.id;
      const result=DependencyMap.connect(getProjects(),from,id,{fromSide:pending.side,toSide:side});
      pending=null;drag=null;clearPreview();
      if(result.error){decorate();tell(result.error);return;}
      selected=id;edge={from,to:id};
      if(result.changed)commit(result.project,`일정 연결: ${result.source.milestone.title} → ${result.milestone.title}`);
      decorate();tell(result.changed?'연결을 저장했어요. 선을 선택하면 연결을 해제할 수 있습니다.':'이미 연결되어 있어요.');
    }
    function newCardTarget(clientX,clientY){
      const col=dropColumn(clientX,clientY),point=svgPoint(clientX,clientY),model=getModel();
      if(!col||!point)return null;
      const y=point.y-model.top,week=model.weeks.find(w=>y>=w.y&&y<w.y+w.height);
      const date=week?.start===null?'':DependencyMap.dateAt(model,y);
      if(date===null)return null;
      const column=DependencyMap.creationColumn(model,Number(col.dataset.flowColumn),date);
      const destination=model.columns.find(c=>c.index===column);
      return !destination?null:{column,date,projectId:destination.projectId,projectColumn:destination.localIndex};
    }
    function createLinked(clientX,clientY){
      const target=newCardTarget(clientX,clientY);
      if(!pending||!target){cancel();return;}
      const source=pending,result=DependencyMap.createLinked(getProjects(),source.id,{...target,id:createId(),side:source.side});
      pending=null;clearPreview();
      if(result.error){decorate();tell(result.error);return;}
      selected=DependencyMap.key(result.project.id,result.milestone.id);edge=null;
      commit(result.project,`연결된 일정 추가: ${result.source.milestone.title} → ${result.milestone.title}`);
      [...board.querySelectorAll('.flow-node')].find(el=>el.dataset.m===selected)?.focus({preventScroll:true});
      decorate();tell('연결된 새 카드를 만들었어요. 일정 수정에서 제목을 입력하세요. Ctrl+Z로 되돌릴 수 있습니다.');
    }
    function removeEdge(){
      if(!edge)return;
      const result=DependencyMap.disconnect(getProjects(),edge.from,edge.to);edge=null;
      if(result.changed)commit(result.project,`선행 일정 연결 해제: ${result.milestone.title}`);
      decorate();tell('선택한 연결을 해제했어요. 일정은 그대로 유지됩니다.');
    }
    function activate(target){
      if(!isActive())return;
      if(target.closest('[data-flow-status-select],[data-resize],[data-edge-handle],.flow-add-column'))return;
      const port=target.closest('[data-port-node]'),node=target.closest('[data-m]'),line=target.closest('[data-edge-from]');
      if(port){if(pending&&pending.id!==port.dataset.portNode)finish(port.dataset.portNode,port.dataset.side);else start(portInfo(port));}
      else if(node){if(pending)finish(node.dataset.m);else selectNode(node.dataset.m);}
      else if(line){pending=null;selected=null;edge={from:line.dataset.edgeFrom,to:line.dataset.edgeTo};clearPreview();decorate();tell(`${lookup(edge.from)?.milestone.title} → ${lookup(edge.to)?.milestone.title} · 동그란 조절점을 드래그해 선의 위치를 바꾸세요.`);}
      else {pending=null;selected=null;edge=null;clearPreview();decorate();tell('카드를 선택해 연결점을 표시하세요.');}
    }
    function drawPreview(clientX,clientY){
      const svg=board.querySelector('svg');if(!svg||!pending)return;
      const bounds=svg.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
      const x=(clientX-bounds.left)*Number(svg.getAttribute('width'))/bounds.width;
      const y=(clientY-bounds.top)*Number(svg.getAttribute('height'))/bounds.height;
      let line=svg.querySelector('.flow-preview');
      if(!line){line=document.createElementNS('http://www.w3.org/2000/svg','path');line.setAttribute('class','flow-preview');line.setAttribute('fill','none');line.setAttribute('stroke','#4265ff');line.setAttribute('stroke-width','2');line.setAttribute('stroke-dasharray','5 4');line.setAttribute('pointer-events','none');svg.append(line);}
      line.setAttribute('d',`M${pending.x} ${pending.y}L${x} ${y}`);
      line.setAttribute('marker-end','url(#dependency-arrow)');
      const hit=document.elementFromPoint?.(clientX,clientY);
      board.querySelectorAll('.is-target').forEach(el=>el.classList.remove('is-target'));
      board.querySelector('.flow-new-preview')?.remove();
      const hitNode=hit&&board.contains(hit)?hit.closest('.flow-node,[data-port-node]'):null;
      if(hitNode){
        hitNode.classList.add('is-target');
        const model=getModel(),source=model.items.find(m=>m.id===pending.id),target=model.items.find(m=>m.id===(hitNode.dataset.portNode||hitNode.dataset.m));
        if(source&&target&&source!==target){const route=DependencyMap.routeEdge(model,{from:source,to:target,fromSide:pending.side,toSide:hitNode.dataset.side||'top'});line.setAttribute('d',route.path);}
        tell('기존 카드에 놓으면 두 일정을 연결합니다.');return;
      }
      const target=newCardTarget(clientX,clientY);if(!target)return;
      const model=getModel(),day=target.date?DependencyMap.dayPosition(model,target.date):null;
      const px=172+target.column*252,py=model.top+(day?.y??model.weeks.find(w=>w.start===null)?.y??0)+DependencyMap.cardInset;
      const group=document.createElementNS('http://www.w3.org/2000/svg','g');group.setAttribute('class','flow-new-preview');group.setAttribute('pointer-events','none');
      const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
      for(const [k,v]of Object.entries({x:px,y:py,width:218,height:117,rx:5,fill:'#e4efdf','fill-opacity':'.85',stroke:'#4265ff','stroke-width':2,'stroke-dasharray':'5 3'}))rect.setAttribute(k,v);
      const label=document.createElementNS('http://www.w3.org/2000/svg','text');label.setAttribute('x',px+12);label.setAttribute('y',py+30);label.setAttribute('font-size','13');label.setAttribute('fill','#11563f');label.textContent='＋ 새 일정';group.append(rect,label);svg.append(group);
      tell(`${target.column+1}열 · ${target.date||'일정 조율 중'}에 연결된 새 카드를 만듭니다.`);
    }
    board.addEventListener('pointerdown',e=>{
      if(!isActive()||e.button!==0)return;
      if(e.target.closest('[data-flow-status-select],.flow-add-column'))return;
      const edgeHandle=e.target.closest('[data-edge-handle]');
      if(edgeHandle){
        const item=selectedEdge();if(!item)return;
        e.preventDefault();pending=null;
        drag={type:'edge',item,points:DependencyMap.routeEdge(getModel(),item).points,handle:edgeHandle.dataset.edgeHandle,pointerId:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
        board.setPointerCapture?.(e.pointerId);return;
      }
      const port=e.target.closest('[data-port-node]'),node=e.target.closest('.flow-node'),resize=e.target.closest('[data-resize]');
      if(resize){
        e.preventDefault();pending=null;clearPreview();selectNode(resize.dataset.resizeNode);
        drag={type:'resize',id:resize.dataset.resizeNode,edge:resize.dataset.resize,pointerId:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
        board.setPointerCapture?.(e.pointerId);return;
      }
      if(!port&&(!node||pending))return;
      // An armed click-to-connect operation finishes through the click handler.
      if(port&&pending&&pending.id!==port.dataset.portNode)return;
      e.preventDefault();
      if(port)start(portInfo(port));else selectNode(node.dataset.m);
      drag={type:port?'link':'move',id:node?.dataset.m,pointerId:e.pointerId,x:e.clientX,y:e.clientY,moved:false};
      board.setPointerCapture?.(e.pointerId);
    });
    board.addEventListener('pointermove',e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)drag.moved=true;
      if(!drag.moved)return;
      e.preventDefault();
      const rect=board.getBoundingClientRect();
      if(e.clientY<rect.top+28)board.scrollTop-=18;else if(e.clientY>rect.bottom-28)board.scrollTop+=18;
      if(e.clientX<rect.left+28)board.scrollLeft-=18;else if(e.clientX>rect.right-28)board.scrollLeft+=18;
      if(drag.type==='edge')previewEdge(e.clientX,e.clientY);else if(drag.type==='move')previewMove(e.clientX,e.clientY);else if(drag.type==='resize')previewResize(e.clientX,e.clientY);else drawPreview(e.clientX,e.clientY);
    });
    board.addEventListener('pointerup',e=>{
      if(!drag||e.pointerId!==drag.pointerId)return;
      if(drag.type==='edge'&&drag.moved)previewEdge(e.clientX,e.clientY);
      const {moved,type,id,edge:resizeEdge,updates}=drag;
      const date=type==='resize'?resizeValue(id,resizeEdge,e.clientX,e.clientY):null;
      drag=null;suppressClickUntil=Date.now()+150;
      if(board.hasPointerCapture?.(e.pointerId))board.releasePointerCapture(e.pointerId);
      if(!moved)return; // Keep the source armed for a second click.
      if(type==='edge'){saveEdge(updates);return;}
      if(type==='resize'){if(date)resizeCard(id,resizeEdge,date);else cancel();return;}
      if(type==='move'){
        const column=dropColumn(e.clientX,e.clientY);
        if(column)moveCard(id,Number(column.dataset.flowColumn));else cancel();
        return;
      }
      const hit=document.elementFromPoint?.(e.clientX,e.clientY),port=hit?.closest('[data-port-node]'),node=hit?.closest('[data-m]');
      if(hit&&board.contains(hit)&&(port||node))finish(port?.dataset.portNode||node.dataset.m,port?.dataset.side||'top');
      else if(hit&&board.contains(hit))createLinked(e.clientX,e.clientY);
      else cancel();
    });
    board.addEventListener('pointercancel',cancel);
    board.addEventListener('lostpointercapture',()=>{if(drag)cancel();});
    board.addEventListener('click',e=>{if(!isActive()||Date.now()<suppressClickUntil)return;activate(e.target);});
    board.addEventListener('keydown',e=>{
      if(!isActive())return;
      if(e.target.closest('[data-flow-status-select],.flow-add-column'))return;
      if(e.key==='Escape'){e.preventDefault();cancel();return;}
      const edgeHandle=e.target.closest('[data-edge-handle]');
      if(edgeHandle&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){
        e.preventDefault();e.stopPropagation();const item=selectedEdge();if(!item)return;
        const points=DependencyMap.routeEdge(getModel(),item).points,index=edgeHandle.dataset.edgeHandle;
        const point=index==='start'?points[0].slice():index==='end'?points.at(-1).slice():points[Number(index)].map((v,i)=>(v+points[Number(index)+1][i])/2);
        const step=e.shiftKey?10:2;point[0]+=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0;point[1]+=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;
        saveEdge(DependencyMap.adjustRoute(item,points,index,point));
        board.querySelector(`[data-edge-handle="${index}"]`)?.focus({preventScroll:true});return;
      }
      const handle=e.target.closest('[data-resize]');
      if(handle&&(e.key==='ArrowUp'||e.key==='ArrowDown')){
        e.preventDefault();const m=lookup(handle.dataset.resizeNode)?.milestone;if(!m)return;
        const date=handle.dataset.resize==='start'?(Roadmap.date(m.start)??Roadmap.date(m.due)):Roadmap.date(m.due);
        resizeCard(handle.dataset.resizeNode,handle.dataset.resize,new Date(date+(e.key==='ArrowUp'?-1:1)*(e.shiftKey?7:1)*86400000).toISOString().slice(0,10));return;
      }
      if(e.altKey&&selected&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();const item=getModel()?.items?.find(m=>m.id===selected);if(item)moveCard(selected,item.column+(e.key==='ArrowLeft'?-1:1));return;}
      if((e.key==='Delete'||e.key==='Backspace')&&edge){e.preventDefault();removeEdge();return;}
      if((e.key==='Enter'||e.key===' ')&&e.target.closest('[data-m],[data-port-node],[data-edge-from]')){e.preventDefault();activate(e.target);}
    });
    board.addEventListener('change',e=>{
      const select=e.target.closest('[data-flow-status-select]');if(!select||!isActive())return;
      const id=select.dataset.flowStatusSelect,result=DependencyMap.setStatus(getProjects(),id,select.value);
      if(result.error){tell(result.error);return;}
      pending=null;edge=null;selected=id;clearPreview();
      if(result.changed)commit(result.project,`상태 변경: ${result.milestone.title} → ${DependencyMap.statuses[select.value]}`);
      [...board.querySelectorAll('[data-flow-status-select]')].find(el=>el.dataset.flowStatusSelect===id)?.focus({preventScroll:true});
      decorate();tell(`${result.milestone.title} · ${DependencyMap.statuses[result.milestone.status]}로 저장했어요.`);
    });
    control('cancel').onclick=cancel;
    control('unlink').onclick=removeEdge;
    control('edit').onclick=()=>{const target=lookup(selected);if(target)edit(target);};
    control('detail').onclick=()=>{const target=lookup(selected);if(target)navigate(target);};
    for(const [name,delta]of [['left',-1],['right',1]])control(name).onclick=()=>{const item=getModel()?.items?.find(m=>m.id===selected);if(item)moveCard(selected,item.column+delta);};
    return { refresh, cancel, get busy(){return !!drag||!!pending;} };
  }
};
