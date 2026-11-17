/* A date-led dependency map shared by the page and static exports. */
globalThis.DependencyMap = (() => {
  const DAY = 86400000, key = (projectId, milestoneId) => JSON.stringify([projectId, milestoneId]);
  const esc = value => Roadmap.escape(value);
  const sides = ['top','right','bottom','left'];
  const statuses = {todo:'시작 전',doing:'진행중',done:'완료'};
  const column = value => Number.isInteger(value) && value >= 0 && value < 100 ? value : null;
  const columnCount = value => Number.isInteger(value) && value >= 3 && value <= 100 ? value : 3;
  function normalize(value) {
    const refs = new Map();
    for (const ref of Array.isArray(value) ? value : []) {
      if (ref && typeof ref.projectId === 'string' && typeof ref.milestoneId === 'string') {
        const clean = { projectId: ref.projectId, milestoneId: ref.milestoneId };
        for (const field of ['fromSide','toSide']) if (sides.includes(ref[field])) clean[field] = ref[field];
        refs.set(key(ref.projectId, ref.milestoneId), clean);
      }
    }
    return [...refs.values()];
  }
  function validate(projects, projectId, milestoneId, refs) {
    const target = key(projectId, milestoneId), graph = new Map();
    for (const p of projects) for (const m of p.milestones) graph.set(key(p.id, m.id), normalize(m.dependsOn).map(r => key(r.projectId, r.milestoneId)));
    const pending = normalize(refs).map(r => key(r.projectId, r.milestoneId)), seen = new Set();
    while (pending.length) {
      const id = pending.pop();
      if (id === target) return '일정이 서로를 기다리는 순환 연결은 만들 수 없어요. 선행 일정을 다시 선택해 주세요.';
      if (seen.has(id)) continue;
      seen.add(id); pending.push(...(graph.get(id) || []));
    }
    return '';
  }
  function unlink(projects, projectId, milestoneId) {
    const changed = [];
    for (const p of projects) for (const m of p.milestones) {
      const before = normalize(m.dependsOn);
      const after = before.filter(r => r.projectId !== projectId || (milestoneId !== undefined && r.milestoneId !== milestoneId));
      if (after.length !== before.length) { m.dependsOn = after; if (!changed.includes(p)) changed.push(p); }
    }
    return changed;
  }
  function find(projects, id) {
    for(const project of projects)for(const milestone of project.milestones)if(key(project.id,milestone.id)===id)return {project,milestone};
    return null;
  }
  function creationColumn(model,targetColumn,date){
    if(column(targetColumn)===null||(date!==''&&Roadmap.date(date)===null))return null;
    const time=Roadmap.date(date);
    let col=targetColumn;
    while(col<100&&model.items.some(m=>m.column===col&&(date===''?!m.resizable:m.resizable&&m.startTime<=time&&m.endTime>=time)))col++;
    return col<100?col:null;
  }
  function createLinked(projects,from,{id,column:col,date,side='bottom'}){
    const source=find(projects,from);
    if(!source||!id||source.project.milestones.some(m=>m.id===id)||column(col)===null||(date!==''&&Roadmap.date(date)===null)||!sides.includes(side))return {error:'새 카드를 만들 위치를 확인해 주세요.'};
    const milestone={id,title:'새 일정',details:'',start:date,due:date,status:'todo',group:source.milestone.group||'',color:source.milestone.color||'blue',flowColumn:col,
      dependsOn:[{projectId:source.project.id,milestoneId:source.milestone.id,fromSide:side,toSide:{top:'bottom',bottom:'top',left:'right',right:'left'}[side]}]};
    source.project.milestones.push(milestone);
    return {project:source.project,milestone,source,changed:true};
  }
  function connect(projects, from, to, anchors={}) {
    const source=find(projects,from),target=find(projects,to);
    if(!source||!target)return {error:'연결할 일정을 찾을 수 없어요.'};
    const ref=normalize([{projectId:source.project.id,milestoneId:source.milestone.id,fromSide:anchors.fromSide,toSide:anchors.toSide}])[0];
    const before=normalize(target.milestone.dependsOn),next=before.slice(),index=next.findIndex(r=>key(r.projectId,r.milestoneId)===from);
    if(index<0)next.push(ref);else next[index]=ref;
    const error=validate(projects,target.project.id,target.milestone.id,next);
    if(error)return {error};
    const changed=JSON.stringify(before)!==JSON.stringify(next);
    if(changed)target.milestone.dependsOn=next;
    return {...target,source,changed};
  }
  function disconnect(projects,from,to) {
    const target=find(projects,to);if(!target)return {changed:false};
    const before=normalize(target.milestone.dependsOn),next=before.filter(r=>key(r.projectId,r.milestoneId)!==from);
    if(next.length===before.length)return {...target,changed:false};
    target.milestone.dependsOn=next;return {...target,changed:true};
  }
  function anchor(m,side,top=0) {
    return {top:[m.x+m.width/2,top+m.y],right:[m.x+m.width,top+m.y+m.height/2],bottom:[m.x+m.width/2,top+m.y+m.height],left:[m.x,top+m.y+m.height/2]}[side];
  }
  function placement(model,id,targetColumn) {
    const item=model?.items.find(m=>m.id===id);
    if(!item||column(targetColumn)===null||!model.columns.some(c=>c.index===targetColumn))return '이동할 열을 찾을 수 없어요.';
    const overlap=model.items.some(m=>m.id!==id&&m.column===targetColumn&&m.y<item.y+item.height+4&&m.y+m.height+4>item.y);
    return overlap?'이 열의 같은 기간에 다른 카드가 있어요. 비어 있는 열로 옮겨 주세요.':'';
  }
  function move(projects,id,targetColumn,model) {
    const target=find(projects,id),error=placement(model,id,targetColumn);
    if(!target||error)return {error:error||'이동할 일정을 찾을 수 없어요.'};
    if(model.items.find(m=>m.id===id).column===targetColumn)return {...target,changed:false};
    target.milestone.flowColumn=targetColumn;
    return {...target,changed:true};
  }
  function resize(projects,id,edge,value) {
    const target=find(projects,id),date=Roadmap.date(value);
    if(!target||!['start','due'].includes(edge)||date===null)return {error:'변경할 날짜를 확인해 주세요.'};
    const m=target.milestone,start=Roadmap.date(m.start)??Roadmap.date(m.due),due=Roadmap.date(m.due);
    if(start===null||due===null||start>due)return {error:'일정 수정에서 시작일과 종료일을 먼저 지정해 주세요.'};
    if((edge==='start'&&date>due)||(edge==='due'&&date<start))return {error:'종료일은 시작일보다 빠를 수 없어요.'};
    if(date===(edge==='start'?start:due))return {...target,changed:false};
    // A due-only task starts on that day. Extending its bottom must retain that start.
    if(edge==='due'&&Roadmap.date(m.start)===null)m.start=m.due;
    m[edge]=value;
    return {...target,changed:true};
  }
  function setStatus(projects,id,value) {
    const target=find(projects,id);
    if(!target||!Object.hasOwn(statuses,value))return {error:'변경할 상태를 확인해 주세요.'};
    const changed=target.milestone.status!==value;
    if(changed)target.milestone.status=value;
    return {...target,changed};
  }
  function dayPosition(model,value) {
    const time=Roadmap.date(value),days=model?.days;
    if(time===null||!days?.length)return null;
    const found=days.find(d=>d.time===time);if(found)return found;
    const first=days[0],last=days.at(-1);
    return {time,date:value,y:time<first.time?first.y+(time-first.time)/DAY*22:last.y+last.height+((time-last.time)/DAY-1)*22,height:22};
  }
  function dateAt(model,y) {
    const days=model?.days;if(!days?.length||!Number.isFinite(y))return null;
    const first=days[0],last=days.at(-1);
    if(y<first.y)return new Date(first.time+Math.floor((y-first.y)/22)*DAY).toISOString().slice(0,10);
    if(y>=last.y+last.height)return new Date(last.time+(Math.floor((y-last.y-last.height)/22)+1)*DAY).toISOString().slice(0,10);
    const hit=days.find(d=>y>=d.y&&y<d.y+d.height);
    if(hit)return hit.date;
    // In the gap containing a week heading, snap to the nearest date band.
    return days.reduce((best,d)=>Math.min(Math.abs(y-d.y),Math.abs(y-d.y-d.height))<Math.min(Math.abs(y-best.y),Math.abs(y-best.y-best.height))?d:best).date;
  }
  function wrap(value, width, size) {
    const result = ['']; let used = 0;
    for (const char of String(value || '')) {
      const advance = size * (char.charCodeAt(0) > 255 ? 1 : 0.6);
      if (char === '\n' || used + advance > width) { result.push(''); used = 0; }
      if (char !== '\n') { result[result.length - 1] += char; used += advance; }
    }
    return result;
  }
  function layout(project, today) {
    const items = project.milestones.map(m => ({ ...m, refs: normalize(m.dependsOn).map(r => key(r.projectId, r.milestoneId)) }));
    const byId = new Map(items.map(m => [m.id, m]));
    const calendar = Roadmap.layout(items, today);
    const times = calendar.dated.flatMap(m => [m.startTime, m.endTime]);
    const min = times.length ? Math.min(...times) : Roadmap.date(today), max = times.length ? Math.max(...times) : min;
    const weeks = calendar.months.flatMap(m => m.weeks.map(w => ({ ...w, year:m.year, month:m.month, label:`${m.year}.${String(m.month).padStart(2,'0')} W${w.number}` }))).filter(w => w.end > min && w.start <= max);
    const bucket = value => weeks.findIndex(w => value >= w.start && value < w.end);
    for (const m of items) {
      const end = Roadmap.date(m.due), start = Roadmap.date(m.start) ?? end;
      m.startTime=start;m.endTime=end;
      m.first = start !== null && end !== null && start <= end ? bucket(start) : -1;
      m.last = m.first >= 0 ? bucket(end) : -1;
      m.hiddenRefs = m.refs.filter(id => !byId.has(id)).length;
      m.parents = m.refs.filter(id => byId.has(id));
    }
    if (items.some(m => m.first < 0)) {
      const pendingIndex = weeks.length;
      weeks.push({ label:'일정 조율 중', start:null, end:null });
      for (const m of items) if (m.first < 0) m.first = m.last = pendingIndex;
    }
    // Kahn's algorithm makes same-week dependencies readable; imported cycles remain visible.
    const remaining = new Set(items.map(m => m.id)), ordered = [];
    while (remaining.size) {
      const ready = items.filter(m => remaining.has(m.id) && m.parents.every(id => !remaining.has(id)));
      if (!ready.length) break;
      for (const m of ready) { remaining.delete(m.id); ordered.push(m); }
    }
    for (const m of items) if (remaining.has(m.id)) { m.cycle = true; ordered.push(m); }
    for (const m of ordered) {
      m.rank = 0;
      if (!m.cycle) for (const id of m.parents) {
        const parent = byId.get(id);
        if (parent.last === m.first) m.rank = Math.max(m.rank, (parent.first === parent.last ? parent.rank || 0 : 0) + 1);
      }
      m.titleLines = wrap(m.title, 190, 13);
      m.projectLines = wrap((m.projectName || m.group || '').split('\n')[0], 190, 10);
      m.nodeHeight = Math.max(110, 86 + m.titleLines.length * 18 + m.projectLines.length * 13 + (m.hiddenRefs ? 32 : 0));
    }
    const slot = Math.max(130, ...items.map(m => m.nodeHeight + 20));
    const days=weeks.flatMap(w=>{
      w.days=[];
      if(w.start!==null)for(let time=w.start;time<w.end;time+=DAY)w.days.push({time,date:new Date(time).toISOString().slice(0,10),height:22});
      return w.days;
    });
    // Keep daily bands compact; expand only dates that need space for short task labels.
    for(const m of items.filter(m=>m.last>=0&&m.startTime!==null&&m.endTime!==null&&m.startTime<=m.endTime).sort((a,b)=>(a.endTime-a.startTime)-(b.endTime-b.startTime))){
      const span=days.filter(d=>d.time>=m.startTime&&d.time<=m.endTime);
      const extra=Math.max(0,m.nodeHeight+6-span.reduce((n,d)=>n+d.height,0));
      for(const d of span)d.height+=extra/span.length;
    }
    let y = 0;
    for (let i = 0; i < weeks.length; i++) {
      const week=weeks[i];week.y=y;
      if(week.start!==null){
        let dy=y+42;
        for(const d of week.days){d.y=dy;dy+=d.height;}
        week.height=dy-y+8;
      }else{
        const ranks=items.filter(m=>m.first===i).map(m=>m.rank);
        week.height=(Math.max(0,...ranks)+1)*slot+36;
      }
      y += week.height;
    }
    const lanes = new Map();
    for (const m of items) {
      const first=days.find(d=>d.time===m.startTime),last=days.find(d=>d.time===m.endTime);
      const dated=first&&last&&m.startTime<=m.endTime;
      m.y = dated?first.y+3:weeks[m.first].y+24+m.rank*slot;
      m.height = dated?last.y+last.height-3-m.y:m.nodeHeight;
      m.resizable=!!dated;
      if (!lanes.has(m.projectId)) lanes.set(m.projectId, { id:m.projectId, name:m.projectName || m.group.split('\n')[0], items:[], ends:[] });
      lanes.get(m.projectId).items.push(m);
    }
    const projectColumns=new Map([...lanes.keys()].map((id,i)=>[id,i])),occupied=new Map();
    // Respect explicit placements first; automatically place the remaining cards around them.
    const positioned=items.slice().sort((a,b)=>(column(a.flowColumn)===null)-(column(b.flowColumn)===null)||a.y-b.y||a.height-b.height);
    for(const m of positioned){
      let col=column(m.flowColumn)??projectColumns.get(m.projectId);
      while((occupied.get(col)||[]).some(other=>other.y<m.y+m.height+4&&other.y+other.height+4>m.y))col++;
      m.column=col;m.x=172+col*252;m.width=218;
      if(!occupied.has(col))occupied.set(col,[]);occupied.get(col).push(m);
    }
    // Keep a spare drop column available, even for a single-project map.
    const count=Math.max(columnCount(project.mapColumns),Math.max(-1,...items.map(m=>m.column))+2);
    const columns=Array.from({length:count},(_,index)=>({index,x:160+index*252,width:242}));
    const edges = items.flatMap(to => to.parents.map(id => {
      const from = byId.get(id), start = Roadmap.date(to.start) ?? Roadmap.date(to.due), end = Roadmap.date(from.due);
      const ref=normalize(to.dependsOn).find(r=>key(r.projectId,r.milestoneId)===id);
      return { from, to, fromSide:ref?.fromSide, toSide:ref?.toSide, conflict: start !== null && end !== null && end > start, cycle: !!(from.cycle && to.cycle) };
    }));
    return { items, weeks, days, lanes:[...lanes.values()], columns, edges, width:Math.max(900,160+count*252+28), height:y, hiddenRefs:items.reduce((n,m)=>n+m.hiddenRefs,0) };
  }
  function svg(project, today, { interactive = false, report = false } = {}) {
    const model = layout(project, today), width = model.width;
    const titleLines = wrap(report ? project.name : '프로젝트 연결 맵', width - 56, 24);
    const descLines = wrap(report ? project.description : '선행 일정 → 후속 일정 · 여러 프로젝트의 흐름을 함께 살펴보세요.', width - 56, 12);
    const top = 122 + titleLines.length * 30 + descLines.length * 18, height = top + model.height + 86;
    model.top=top;
    const rect = (x,y,w,h,fill,extra='') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${fill}" ${extra}/>`;
    const text = (x,y,value,size=12,fill='#334b3d',extra='') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${esc(value)}</text>`;
    let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="${interactive?'group':'img'}" aria-label="프로젝트 연결 맵" style="font-family:'Pretendard Variable','Malgun Gothic',sans-serif"><title>${esc(project.name)} — 프로젝트 연결 맵</title>`;
    out += '<defs><marker id="dependency-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#647568"/></marker><marker id="dependency-warning" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#b74736"/></marker></defs>';
    out += rect(0,0,width,height,'#faf8e9');
    out += text(28,30,'CONNECTED MILESTONES',11,'#537264','letter-spacing="2"');
    titleLines.forEach((line,i)=>{out+=text(28,60+i*30,line,24,'#11563f','font-weight="700"');});
    descLines.forEach((line,i)=>{out+=text(28,64+titleLines.length*30+i*18,line,12);});
    out += rect(28,top-42,12,12,'#fffdf2','stroke="#9ca995"') + text(46,top-31,'시작 전',11);
    out += rect(100,top-42,12,12,'#ffe27a','stroke="#9ca995"') + text(118,top-31,'진행중',11);
    out += rect(172,top-42,12,12,'#d5e5fc','stroke="#9ca995"') + text(190,top-31,'완료',11);
    if(report)out += text(252,top-31,'공유 시점 '+today,11);
    for (const col of model.columns) out += text(col.x+12,top-8,`${col.index+1}열`,11,'#537264');
    for (const week of model.weeks) {
      const active = week.start !== null && Roadmap.date(today) >= week.start && Roadmap.date(today) < week.end;
      out += rect(14,top+week.y,width-28,week.height-8,active?'#f5edcb':'#fffdf2',`stroke="${active?'#b74736':'#c5c4af'}" stroke-dasharray="4 5"`);
      out += rect(24,top+week.y+8,120,26,active?'#b74736':'#43594c');
      out += text(84,top+week.y+26,week.label,12,'#fff','text-anchor="middle" font-weight="700"');
      for(const d of week.days){
        const date=new Date(d.time),todayBand=d.date===today;
        out+=`<g class="flow-day" data-date="${d.date}">`;
        out+=rect(24,top+d.y,120,d.height,todayBand?'#f5edcb':'transparent');
        out+=text(132,top+d.y+Math.min(d.height/2,18)+4,`${date.getUTCDate()}일 (${['일','월','화','수','목','금','토'][date.getUTCDay()]})`,11,todayBand?'#b74736':'#537264','text-anchor="end"');
        out+=`<path d="M148 ${top+d.y}H${width-20}" stroke="#c5c4af" stroke-opacity=".28" stroke-dasharray="2 6" pointer-events="none"/></g>`;
      }
    }
    if(interactive)for(const col of model.columns){
      out+=rect(col.x,top,col.width,model.height-8,'transparent',`class="flow-column" data-flow-column="${col.index}" data-x="${col.x}" data-top="${top}" data-width="${col.width}" data-height="${model.height-8}" stroke="#aebca7" stroke-dasharray="3 7" stroke-opacity="0.55"`);
    }
    // Route in column gutters. A date conflict keeps its dates and gets a dashed red edge.
    for (const edge of model.edges) {
      const {from:a,to:b}=edge, sx=a.x+a.width/2, sy=top+a.y+a.height, tx=b.x+b.width/2, ty=top+b.y;
      const direct = a.x===b.x && ty > sy && !model.items.some(m=>m!==a&&m!==b&&m.x<=sx&&m.x+m.width>=sx&&top+m.y<ty&&top+m.y+m.height>sy);
      const gutter=a.x+a.width+12, targetGutter=b.x-12;
      let path=direct?`M${sx} ${sy}V${ty-3}`:`M${sx} ${sy}v10H${gutter}V${ty-12}H${targetGutter}H${tx}V${ty-3}`;
      if(edge.fromSide||edge.toSide){
        const start=anchor(a,edge.fromSide||'bottom',top),end=anchor(b,edge.toSide||'top',top);
        const dirs={top:[0,-1],right:[1,0],bottom:[0,1],left:[-1,0]},sd=dirs[edge.fromSide||'bottom'],td=dirs[edge.toSide||'top'];
        const reach=Math.max(32,Math.min(160,Math.hypot(end[0]-start[0],end[1]-start[1])/2));
        path=`M${start[0]} ${start[1]}C${start[0]+sd[0]*reach} ${start[1]+sd[1]*reach} ${end[0]+td[0]*reach} ${end[1]+td[1]*reach} ${end[0]} ${end[1]}`;
      }
      const warning=edge.conflict||edge.cycle;
      if(interactive)out+=`<g class="flow-edge" data-edge-from="${esc(a.id)}" data-edge-to="${esc(b.id)}" tabindex="0" role="button" aria-label="연결 선택: ${esc(a.title)} → ${esc(b.title)}"><path d="${path}" fill="none" stroke="transparent" stroke-width="18" class="flow-edge-hit"/>`;
      out+=`<path d="${path}" fill="none" stroke="${warning?'#b74736':'#647568'}" stroke-width="1.5" ${warning?'stroke-dasharray="5 4"':''} marker-end="url(#${warning?'dependency-warning':'dependency-arrow'})"><title>${esc(a.title)} → ${esc(b.title)}${edge.cycle?' · 순환 연결 확인':edge.conflict?' · 선행 일정 종료 전 시작':''}</title></path>`;
      if(interactive)out+='</g>';
    }
    for (const m of model.items) {
      const fill=m.status==='done'?'#d5e5fc':m.status==='doing'?'#ffe27a':'#fffdf2', y=top+m.y;
      const label=`${m.projectName} / ${m.title} · ${m.start||m.due||'날짜 미정'} ~ ${m.due||'날짜 미정'} · ${m.parents.length+m.hiddenRefs}개 선행 일정`;
      out+=`<g ${interactive?`class="flow-node" data-m="${esc(m.id)}" data-column="${m.column}" data-x="${m.x}" tabindex="0" role="button" aria-pressed="false" aria-label="${esc(label)} · ${m.column+1}열"`:''}><title>${esc(label)}</title>`;
      out+=rect(m.x,y,m.width,m.height,fill,'stroke="#9ca995"');
      let cy=y+20;
      for(const line of m.projectLines){out+=text(m.x+12,cy,line,10,'#536c5b');cy+=13;}
      for(const line of m.titleLines){out+=text(m.x+12,cy+8,line,13,'#253b30','font-weight="650"');cy+=18;}
      out+=text(m.x+12,y+m.height-34,statuses[m.status]||statuses.todo,11,'#334b3d',interactive?'class="flow-status-print"':'');
      if(interactive){
        out+=`<foreignObject class="flow-status-control" x="${m.x+10}" y="${y+m.height-57}" width="104" height="30"><select xmlns="http://www.w3.org/1999/xhtml" data-flow-status-select="${esc(m.id)}" aria-label="${esc(m.title)} 상태">${Object.entries(statuses).map(([value,label])=>`<option value="${value}" ${m.status===value?'selected="selected"':''}>${label}</option>`).join('')}</select></foreignObject>`;
      }
      out+=text(m.x+12,y+m.height-16,m.start&&m.start!==m.due?`${m.start} ~ ${m.due}`:m.due||'날짜 미정',10);
      if(m.hiddenRefs)out+=text(m.x+12,cy+18,`화면 밖 선행 ${m.hiddenRefs}개`,10,'#a04736');
      if(interactive&&m.resizable)for(const [edge,yy,label]of [['start',y,'시작일'],['due',y+m.height,'종료일']]){
        out+=`<g class="flow-resize" data-resize="${edge}" data-resize-node="${esc(m.id)}" tabindex="0" role="button" aria-label="${esc(m.title)} ${label} 조절. 위아래 화살표로 하루씩 변경"><title>${label}: 테두리를 드래그하거나 ↑ ↓로 하루씩 변경</title><path d="M${m.x+5} ${yy}H${m.x+m.width-5}" stroke="transparent" stroke-width="14"/><path class="flow-resize-line" d="M${m.x+5} ${yy}H${m.x+m.width-5}" stroke="#4265ff" stroke-width="3" opacity="0"/></g>`;
      }
      out+='</g>';
    }
    if(interactive)for(const m of model.items)for(const side of sides){
      const [x,y]=anchor(m,side,top),sideName={top:'위',right:'오른쪽',bottom:'아래',left:'왼쪽'}[side];
      out+=`<g class="flow-port" data-port-node="${esc(m.id)}" data-side="${side}" data-x="${x}" data-y="${y}" role="button" tabindex="-1" aria-label="${esc(m.title)} ${sideName} 연결 핸들"><title>빈 곳으로 드래그: 연결된 새 카드 / 기존 카드로 드래그: 연결</title><rect x="${x-14}" y="${y-14}" width="28" height="28" fill="transparent"/><rect class="flow-port-mark" x="${x-6}" y="${y-6}" width="12" height="12" rx="1" fill="#fff" stroke="#4265ff" stroke-width="2"/></g>`;
    }
    if(!model.items.length)out+=text(170,top+78,'프로젝트에 일정을 추가하고 선행 일정을 연결해 보세요.',15);
    const warnings=model.edges.filter(e=>e.conflict||e.cycle).length;
    out+=text(28,height-48,'일요일–토요일 기준 · 카드 높이는 작업 기간, 화살표는 선행 관계를 나타냅니다.',11);
    out+=text(28,height-27,`빨간 점선: 날짜 또는 연결 확인 ${warnings}건 · 화면 밖 선행 ${model.hiddenRefs}개${report?' (선택한 프로젝트만 포함)':''}`,11);
    return { markup:out+'</svg>',width,height,model };
  }
  return { key, normalize, validate, unlink, layout, svg, find, connect, disconnect, anchor, column, columnCount, creationColumn, createLinked, placement, move, statuses, resize, setStatus, dateAt, dayPosition };
})();
