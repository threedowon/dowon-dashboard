import { test } from 'node:test';
import assert from 'node:assert/strict';
import './assets/roadmap.js';
import './assets/dependency-map.js';
import './assets/dependency-editor.js';
const ref=(projectId,milestoneId)=>({projectId,milestoneId});
const task=(id,start,due,dependsOn=[])=>({id,title:id,start,due,dependsOn,status:'todo'});
function fixture(){return [
  {id:'hardware',name:'하드웨어',milestones:[task('design','2026-11-15','2026-11-17'),task('sensor','2026-11-18','2026-11-20',[ref('hardware','design')])]},
  {id:'video',name:'영상',milestones:[task('content','2026-11-15','2026-11-19'),task('integration','2026-11-22','2026-12-11',[ref('hardware','sensor'),ref('video','content')])]},
];}
test('cross-project edges, same-week order, and multi-week height are preserved',()=>{
  const model=DependencyMap.layout(Roadmap.portfolio(fixture()),'2026-11-17');
  assert.equal(model.edges.length,3);
  assert.equal(model.lanes.length,2);
  const design=model.items.find(m=>m.id===DependencyMap.key('hardware','design'));
  const sensor=model.items.find(m=>m.id===DependencyMap.key('hardware','sensor'));
  assert.ok(sensor.y>design.y+design.height);
  assert.ok(model.items.find(m=>m.id===DependencyMap.key('video','integration')).height>300);
  for(const lane of model.lanes)for(const a of lane.items)for(const b of lane.items){
    if(a.id!==b.id&&a.x===b.x)assert.ok(a.y+a.height<=b.y||b.y+b.height<=a.y);
  }
});
test('rejects self-links and indirect cross-project dependency cycles',()=>{
  const projects=fixture();
  assert.ok(DependencyMap.validate(projects,'hardware','design',[ref('hardware','design')]));
  assert.ok(DependencyMap.validate(projects,'hardware','design',[ref('video','integration')]));
  assert.equal(DependencyMap.validate(projects,'video','content',[ref('hardware','design')]),'');
});
test('filtered exports show a count without leaking excluded project names or titles',()=>{
  const projects=fixture();projects[0].name='PRIVATE PROJECT';projects[0].milestones[1].title='PRIVATE TITLE';
  const result=DependencyMap.svg(Roadmap.portfolio([projects[1]]),'2026-11-17',{report:true});
  assert.equal(result.model.hiddenRefs,1);
  assert.ok(!result.markup.includes('PRIVATE'));
  assert.ok(result.markup.includes('화면 밖 선행 1개'));
  assert.ok(!result.markup.includes('data-m='));
});
test('deleting a prerequisite cleans only its inbound references',()=>{
  const projects=fixture();DependencyMap.unlink(projects,'hardware','sensor');
  assert.deepEqual(projects[1].milestones[1].dependsOn,[ref('video','content')]);
  assert.deepEqual(projects[0].milestones[1].dependsOn,[ref('hardware','design')]);
  DependencyMap.unlink(projects,'hardware');
  assert.deepEqual(projects[0].milestones[1].dependsOn,[]);
});
test('imported cycles and undated tasks remain renderable without changing dates',()=>{
  const projects=fixture();projects[0].milestones[0].dependsOn=[ref('hardware','sensor')];
  projects[1].milestones.push(task('pending','','',[ref('video','integration')]));
  const original=JSON.stringify(projects);
  const result=DependencyMap.svg(Roadmap.portfolio(projects),'2026-11-17');
  assert.ok(result.model.items.some(m=>m.cycle));assert.ok(result.model.edges.some(e=>e.conflict));
  assert.ok(result.markup.includes('일정 조율 중'));
  assert.ok(!result.markup.includes('NaN'));assert.equal(JSON.stringify(projects),original);
});
test('untrusted labels are escaped and empty projects render a useful state',()=>{
  const result=DependencyMap.svg({name:'<script>',description:'',milestones:[]},'2026-11-17');
  assert.ok(!result.markup.includes('<script>'));assert.ok(result.markup.includes('선행 일정을 연결'));
});
test('daily bands remain compact for long tasks and card edges align to actual dates',()=>{
  const project=Roadmap.portfolio([{id:'long',name:'장기 작업',milestones:[task('long','2026-08-01','2026-10-04')]}]);
  const model=DependencyMap.layout(project,'2026-09-17'),item=model.items[0];
  assert.ok(model.days.every(d=>d.height===22));
  assert.equal(item.y,model.days.find(d=>d.date==='2026-08-01').y+3);
  const end=model.days.find(d=>d.date==='2026-10-04');
  assert.equal(item.y+item.height,end.y+end.height-3);
  const finalWeek=model.weeks[item.last];
  assert.ok(item.y+item.height<=finalWeek.y+finalWeek.height);
});

test('daily geometry handles leap days, short tasks, week boundaries, and undated work',()=>{
  const projects=[{id:'p',name:'P',milestones:[task('leap','2028-02-28','2028-03-02'),task('one','','2028-02-29'),task('pending','','')]}];
  const result=DependencyMap.svg(Roadmap.portfolio(projects),'2028-02-29',{interactive:true});
  const model=result.model,leap=model.days.find(d=>d.date==='2028-02-29'),march=model.days.find(d=>d.date==='2028-03-01');
  assert.ok(leap);assert.ok(march);assert.ok(leap.height>=116);
  assert.equal(DependencyMap.dateAt(model,leap.y+leap.height/2),'2028-02-29');
  assert.equal(DependencyMap.dateAt(model,march.y+1),'2028-03-01');
  assert.ok(model.items.filter(m=>m.resizable).every(m=>m.height>=m.nodeHeight-0.001));
  assert.equal(model.items.find(m=>m.id===DependencyMap.key('p','pending')).resizable,false);
  assert.match(result.markup,/29일 \(화\)/);
  assert.match(result.markup,/data-resize="start"/);assert.match(result.markup,/data-flow-status-select=/);
  const exported=DependencyMap.svg(Roadmap.portfolio(projects),'2028-02-29',{report:true}).markup;
  assert.ok(!exported.includes('foreignObject'));assert.ok(!exported.includes('data-resize='));assert.ok(exported.includes('시작 전'));
});

test('date resize retains the opposite endpoint, columns and dependency refs, and rejects reversed ranges',()=>{
  const projects=fixture(),id=DependencyMap.key('hardware','sensor'),m=projects[0].milestones[1];
  m.flowColumn=2;const refs=structuredClone(m.dependsOn);
  assert.equal(DependencyMap.resize(projects,id,'start','2026-11-17').changed,true);
  assert.equal(m.due,'2026-11-20');assert.equal(m.flowColumn,2);assert.deepEqual(m.dependsOn,refs);
  assert.equal(DependencyMap.resize(projects,id,'due','2026-12-02').changed,true);
  assert.equal(m.start,'2026-11-17');
  const before=JSON.stringify(projects);
  assert.ok(DependencyMap.resize(projects,id,'due','2026-11-16').error);
  assert.ok(DependencyMap.resize(projects,id,'start','2026-12-03').error);
  assert.ok(DependencyMap.resize(projects,id,'due','2026-02-30').error);
  assert.equal(JSON.stringify(projects),before);
  m.start='';m.due='2026-12-31';
  assert.equal(DependencyMap.resize(projects,id,'due','2027-01-03').changed,true);
  assert.equal(m.start,'2026-12-31');
});

test('status updates preserve scheduling and accept only the three supported values',()=>{
  const projects=fixture(),id=DependencyMap.key('hardware','sensor'),original=structuredClone(projects[0].milestones[1]);
  for(const value of ['doing','done','todo']){
    assert.equal(DependencyMap.setStatus(projects,id,value).changed,true);
    assert.deepEqual(projects[0].milestones[1],{...original,status:value});
  }
  assert.equal(DependencyMap.setStatus(projects,id,'todo').changed,false);
  assert.ok(DependencyMap.setStatus(projects,id,'invalid').error);
  assert.equal(projects[0].milestones[1].status,'todo');
});
test('direct connections persist chosen ports, prevent duplicates and cycles, and disconnect only the selected edge',()=>{
  const projects=fixture(),from=DependencyMap.key('hardware','design'),to=DependencyMap.key('video','content');
  assert.equal(DependencyMap.connect(projects,from,to,{fromSide:'right',toSide:'left'}).changed,true);
  assert.deepEqual(projects[1].milestones[0].dependsOn,[{projectId:'hardware',milestoneId:'design',fromSide:'right',toSide:'left'}]);
  assert.equal(DependencyMap.connect(projects,from,to,{fromSide:'right',toSide:'left'}).changed,false);
  assert.ok(DependencyMap.connect(projects,to,from).error);
  const model=DependencyMap.layout(Roadmap.portfolio(projects),'2026-11-17');
  const edge=model.edges.find(e=>e.from.id===from&&e.to.id===to);
  assert.equal(edge.fromSide,'right');assert.equal(edge.toSide,'left');
  const html=DependencyMap.svg(Roadmap.portfolio(projects),'2026-11-17',{interactive:true}).markup;
  assert.ok(html.includes('data-port-node='));assert.ok(html.includes('data-edge-from='));
  const exported=DependencyMap.svg(Roadmap.portfolio(projects),'2026-11-17',{report:true}).markup;
  assert.ok(!exported.includes('data-port-node='));assert.ok(!exported.includes('data-edge-from='));
  assert.equal(DependencyMap.disconnect(projects,from,to).changed,true);
  assert.equal(projects[1].milestones[0].dependsOn.length,0);
  assert.equal(projects[1].milestones[1].dependsOn.length,2);
});

test('moving a card to a spare column preserves dates and dependencies, including on export',()=>{
  const projects=fixture(),id=DependencyMap.key('hardware','sensor');
  const before=structuredClone(projects[0].milestones[1]);
  const initial=DependencyMap.layout(Roadmap.portfolio(projects),'2026-11-17');
  assert.ok(initial.columns.length>=3);
  const target=initial.columns.at(-1).index;
  assert.equal(DependencyMap.move(projects,id,target,initial).changed,true);
  assert.deepEqual(projects[0].milestones[1],{...before,flowColumn:target});
  const restored=JSON.parse(JSON.stringify(projects));
  const result=DependencyMap.svg(Roadmap.portfolio(restored),'2026-11-17',{report:true});
  const moved=result.model.items.find(m=>m.id===id),original=initial.items.find(m=>m.id===id);
  assert.equal(moved.column,target);assert.equal(moved.y,original.y);assert.equal(moved.height,original.height);
  assert.ok(moved.x>original.x);
  assert.equal(result.model.edges.find(e=>e.from.id===id).from.x,moved.x);
  assert.ok(result.model.columns.length>target+1);
  assert.ok(!result.markup.includes('flow-column'));
});

test('occupied columns reject a drop without mutating projects; non-overlapping work can share a column',()=>{
  const projects=fixture(),id=DependencyMap.key('hardware','design');
  let model=DependencyMap.layout(Roadmap.portfolio(projects),'2026-11-17');
  const other=model.items.find(m=>m.id===DependencyMap.key('video','content'));
  const original=JSON.stringify(projects);
  assert.ok(DependencyMap.move(projects,id,other.column,model).error);
  assert.ok(DependencyMap.move(projects,id,-1,model).error);
  assert.equal(JSON.stringify(projects),original);
  assert.equal(DependencyMap.move(projects,id,0,model).changed,false);
  const later=DependencyMap.key('video','integration');
  assert.equal(DependencyMap.move(projects,later,0,model).changed,true);
  model=DependencyMap.layout(Roadmap.portfolio(projects),'2026-11-17');
  assert.equal(model.items.find(m=>m.id===later).column,0);
  assert.equal(model.items.find(m=>m.id===id).column,0);
});

test('explicit empty columns survive layout and exports and invalid counts fall back safely',()=>{
  const project={...Roadmap.portfolio(fixture()),mapColumns:7};
  const rendered=DependencyMap.svg(project,'2026-11-18',{interactive:true});
  assert.equal(rendered.model.columns.length,7);
  assert.match(rendered.markup,/data-flow-column="6"/);
  assert.equal(DependencyMap.svg(project,'2026-11-18',{report:true}).model.columns.length,7);
  for(const n of [-1,101,3.5,'8',null])assert.equal(DependencyMap.columnCount(n),3);
});

test('new linked cards use the source project and chosen date and ports without changing existing cards',()=>{
  for(const side of ['top','bottom','left','right']){
    const projects=fixture(),before=JSON.stringify(projects),id=DependencyMap.key('hardware','sensor');
    const model=DependencyMap.layout(Roadmap.portfolio(projects),'2026-11-18');
    const col=DependencyMap.creationColumn(model,0,'2026-11-19');assert.equal(col,2);
    const result=DependencyMap.createLinked(projects,id,{id:'new',column:col,date:'2026-11-19',side});
    assert.equal(result.changed,true);assert.equal(result.project.id,'hardware');
    assert.equal(result.milestone.start,'2026-11-19');assert.equal(result.milestone.due,'2026-11-19');
    assert.equal(result.milestone.status,'todo');assert.equal(result.milestone.flowColumn,2);
    assert.deepEqual(result.milestone.dependsOn,[{projectId:'hardware',milestoneId:'sensor',fromSide:side,toSide:{top:'bottom',bottom:'top',left:'right',right:'left'}[side]}]);
    assert.ok(DependencyMap.createLinked(projects,id,{id:'new',column:2,date:'2026-11-19',side}).error);
    assert.equal(DependencyMap.validate(projects,'hardware','new',result.milestone.dependsOn),'');
    result.project.milestones.pop();assert.equal(JSON.stringify(projects),before);
  }
});

test('undo and redo restore creation plus its link atomically and a new edit clears redo',()=>{
  const projects=fixture(),initial={projects,mapColumns:3},history=EditHistory.create(initial);
  DependencyMap.createLinked(projects,DependencyMap.key('hardware','sensor'),{id:'new',column:2,date:'2026-11-22'});
  history.record({projects,mapColumns:3});
  const undone=history.undo();assert.equal(undone.projects[0].milestones.length,2);assert.equal(history.canRedo,true);
  assert.equal(history.record(undone),false);assert.equal(history.canRedo,true);
  const redone=history.redo();assert.equal(redone.projects[0].milestones.length,3);assert.equal(redone.projects[0].milestones[2].dependsOn.length,1);
  const previous=history.undo();previous.mapColumns=6;history.record(previous);
  assert.equal(history.canRedo,false);assert.equal(history.redo(),null);
  assert.equal(history.undo().mapColumns,3);
  const bounded=EditHistory.create({n:0},2);for(let n=1;n<=3;n++)bounded.record({n});
  assert.equal(bounded.undo().n,2);assert.equal(bounded.undo().n,1);assert.equal(bounded.undo(),null);
});
