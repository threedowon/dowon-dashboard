import {test} from 'node:test';
import assert from 'node:assert/strict';
import './assets/roadmap.js';
import './assets/dependency-map.js';
const M=DependencyMap;
const task=(id,col)=>({id,title:'일정 '+id,start:'2026-11-19',due:'2026-11-20',status:'todo',flowColumn:col});
const fixtures=()=>[{id:'a',name:'전시 시스템 구축',milestones:[task('one',0),task('two',1)]},{id:'b',name:'홍보 · 오픈 준비',milestones:[{...task('three',0),dependsOn:[{projectId:'a',milestoneId:'one',fromSide:'right',toSide:'left'}]}]}];
const layout=projects=>M.layout(Roadmap.portfolio(projects),'2026-11-19');

test('project regions are disjoint and contain only their own cards, including legacy shared columns',()=>{
 const p=fixtures(),original=JSON.stringify(p),model=layout(p);
 assert.equal(model.lanes.length,2);
 for(const lane of model.lanes)for(const m of lane.items){assert.equal(m.projectId,lane.id);assert.ok(m.x>=lane.x);assert.ok(m.x+m.width<=lane.x+lane.width);}
 assert.ok(model.lanes[0].x+model.lanes[0].width<model.lanes[1].x);
 assert.equal(model.edges.length,1);assert.equal(M.routeEdge(model,model.edges[0]).blocked,false);
 assert.equal(JSON.stringify(p),original);
});

test('local positions survive save/reload, project filtering and reordering',()=>{
 const p=fixtures();p[1].flowColumns=3;let model=layout(p);
 const target=model.columns.filter(c=>c.projectId==='b').at(-1),id=M.key('b','three');
 assert.equal(M.move(p,id,target.index,model).changed,true);assert.equal(p[1].milestones[0].flowProjectColumn,2);
 for(const projects of [JSON.parse(JSON.stringify(p)),[p[1]],[p[1],p[0]]]){
  model=layout(projects);const m=model.items.find(m=>m.id===id),lane=model.lanes.find(l=>l.id==='b');
  assert.equal(m.localColumn,2);assert.equal(m.x-lane.x,12+2*252);
 }
});

test('dragging a card cannot silently change its project',()=>{
 const p=fixtures(),model=layout(p),before=JSON.stringify(p);
 assert.ok(M.move(p,M.key('a','one'),model.columns.find(c=>c.projectId==='b').index,model).error);
 assert.equal(JSON.stringify(p),before);
});

test('dragging a connection into another project creates a linked card in that project',()=>{
 const p=fixtures();p[1].flowColumns=2;const model=layout(p),col=model.columns.filter(c=>c.projectId==='b').at(-1);
 const result=M.createLinked(p,M.key('a','one'),{id:'new',column:col.index,projectColumn:col.localIndex,projectId:'b',date:'2026-11-23',side:'right'});
 assert.equal(result.project.id,'b');assert.equal(p[0].milestones.length,2);assert.equal(p[1].milestones.length,2);
 assert.equal(result.milestone.flowProjectColumn,1);assert.equal(result.milestone.dependsOn[0].projectId,'a');
 const restored=layout(JSON.parse(JSON.stringify(p)));assert.equal(restored.items.find(m=>m.id===M.key('b','new')).localColumn,1);
 assert.equal(restored.edges.length,2);
});

test('project headers appear once visually and project names are absent from card text',()=>{
 const p=fixtures();p.push({id:'empty',name:'빈 프로젝트',milestones:[]});
 for(const options of [{interactive:true},{report:true}]){
  const {markup,model}=M.svg(Roadmap.portfolio(p),'2026-11-19',options);
  assert.equal(model.lanes.length,3);assert.ok(markup.includes('0개 일정'));
  for(const project of p)assert.equal([...markup.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].filter(m=>m[1]===project.name).length,1);
  if(options.interactive)for(const node of markup.matchAll(/<g class="flow-node"[\s\S]*?(?=<g class="flow-node"|<g class="flow-port"|<\/svg>)/g)){
   for(const label of node[0].matchAll(/<text\b[^>]*>(.*?)<\/text>/g))assert.ok(!p.some(p=>label[1]===p.name));
  }
  assert.equal(markup.includes('data-add-project-column'),!!options.interactive);
 }
});

test('added project columns and special/long names survive static export without unsafe markup',()=>{
 const p=fixtures();p[0].flowColumns=5;p[0].name='<script> 프로젝트 이름 '.repeat(8);
 const live=M.svg(Roadmap.portfolio(p),'2026-11-19',{interactive:true}),report=M.svg(Roadmap.portfolio(p),'2026-11-19',{report:true});
 assert.equal(live.model.lanes[0].columnCount,5);assert.equal(report.model.lanes[0].columnCount,5);
 assert.ok(!live.markup.includes('<script>'));assert.equal(live.width,report.width);assert.equal(live.height,report.height);
 assert.ok(live.model.top>100);
});
