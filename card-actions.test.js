import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import './assets/roadmap.js';
import './assets/dependency-map.js';
import './assets/dependency-editor.js';

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function deleteMapMilestone('),html.indexOf('flowEditor=DependencyEditor.attach('));
function setup(readonly=false){
  const state={projects:[
    {id:'a',history:[],milestones:[{id:'same',title:'Delete me',dependsOn:[]},{id:'keep',title:'Keep me',dependsOn:[{projectId:'a',milestoneId:'same'}]}]},
    {id:'b',history:[],milestones:[{id:'same',title:'Other project',dependsOn:[{projectId:'a',milestoneId:'same'},{projectId:'a',milestoneId:'keep'}]}]},
  ]};
  const history=EditHistory.create(state);let saves=0;
  const context=vm.createContext({state,readonly,DependencyMap,flowEditor:{cancel(){}},record:(p,title)=>p.history.push({title}),persist:()=>{saves++;history.record(state);},render(){},$:()=>({focus(){}})});
  vm.runInContext(source,context);
  return {state,history,remove:context.deleteMapMilestone,get saves(){return saves;}};
}

test('card deletion cleans cross-project references and can be undone atomically',()=>{
  const app=setup(),before=JSON.stringify(app.state);
  assert.equal(app.remove(DependencyMap.key('a','same')),true);
  assert.deepEqual(app.state.projects[0].milestones.map(m=>m.id),['keep']);
  assert.equal(app.state.projects[1].milestones[0].title,'Other project');
  assert.deepEqual(app.state.projects[0].milestones[0].dependsOn,[]);
  assert.deepEqual(app.state.projects[1].milestones[0].dependsOn,[{projectId:'a',milestoneId:'keep'}]);
  assert.equal(app.saves,1);
  assert.equal(JSON.stringify(app.history.undo()),before);
  assert.equal(app.history.redo().projects[0].milestones.length,1);
});

test('read-only and stale card deletion do not modify data or history',()=>{
  for(const readonly of [false,true]){
    const app=setup(readonly),before=JSON.stringify(app.state);
    assert.equal(app.remove(DependencyMap.key(readonly?'a':'missing','same')),false);
    assert.equal(JSON.stringify(app.state),before);
    assert.equal(app.saves,0);
  }
});

test('detail icons target their own card and are excluded from shared diagrams',()=>{
  const project=Roadmap.portfolio([{id:'p',name:'Project',milestones:[{id:'one',title:'<name>',due:'2026-11-22',status:'todo'}]}]);
  const interactive=DependencyMap.svg(project,'2026-11-22',{interactive:true}).markup;
  assert.match(interactive,/data-open-board="\[&quot;p&quot;,&quot;one&quot;\]"/);
  assert.match(interactive,/aria-label="&lt;name&gt; 상세 보드 열기"/);
  assert.ok(!DependencyMap.svg(project,'2026-11-22',{report:true}).markup.includes('data-open-board'));
});
