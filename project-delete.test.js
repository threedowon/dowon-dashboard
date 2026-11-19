import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import './assets/roadmap.js';
import './assets/dependency-map.js';
import './assets/dependency-editor.js';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function deleteSelectedProjects(){'),html.indexOf('$("deleteSelectedProjects").onclick='));
function setup({readonly=false,confirm=true,selected=['a','b']}={}){
 const state={selectedId:'a',roadmapIds:selected,projects:[
  {id:'a',name:'A',milestones:[{id:'one',dependsOn:[]}]},
  {id:'b',name:'B',milestones:[]},
  {id:'c',name:'C',milestones:[{id:'keep',dependsOn:[{projectId:'a',milestoneId:'one'},{projectId:'c',milestoneId:'other'}]},{id:'other',dependsOn:[]}]}
 ]};
 const history=EditHistory.create({projects:state.projects});let saves=0,prompt='',records=0;
 const context=vm.createContext({state,readonly,DependencyMap,selectedProjects:()=>Roadmap.selectedProjects(state.projects,state.roadmapIds),confirm:text=>{prompt=text;return confirm;},flowEditor:{cancel(){}},record:()=>records++,persist:()=>{saves++;history.record({projects:state.projects});},render(){},$:()=>({focus(){}})});
 vm.runInContext(source,context);
 return {state,history,run:()=>context.deleteSelectedProjects(),get saves(){return saves;},get prompt(){return prompt;},get records(){return records;}};
}
test('bulk project deletion removes only checked projects and their incoming references, with atomic undo',()=>{
 const app=setup(),before=JSON.stringify(app.state.projects);app.run();
 assert.deepEqual(app.state.projects.map(p=>p.id),['c']);
 assert.deepEqual(app.state.projects[0].milestones[0].dependsOn,[{projectId:'c',milestoneId:'other'}]);
 assert.equal(app.state.selectedId,'c');assert.equal(app.saves,1);assert.equal(app.records,1);
 assert.match(app.prompt,/A/);assert.match(app.prompt,/B/);assert.match(app.prompt,/일정 1개/);
 assert.equal(JSON.stringify(app.history.undo().projects),before);
 assert.deepEqual(app.history.redo().projects.map(p=>p.id),['c']);
});
test('cancel, read-only mode and empty selection never mutate projects',()=>{
 for(const options of [{confirm:false},{readonly:true},{selected:[]}]){
  const app=setup(options),before=JSON.stringify(app.state);app.run();assert.equal(JSON.stringify(app.state),before);assert.equal(app.saves,0);
 }
});
test('deleting all projects leaves an empty workspace and can be undone',()=>{
 const app=setup({selected:['a','b','c']});app.run();assert.equal(app.state.projects.length,0);assert.equal(app.state.selectedId,null);assert.equal(app.history.undo().projects.length,3);
});
