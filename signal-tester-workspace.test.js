import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./signal-tester/signal_tester_ui/app.js', import.meta.url), 'utf8');
const apiSource = source.slice(source.indexOf('async function api('), source.indexOf('function safe('));
const saveSource = source.slice(source.indexOf('async function saveWorkspace('), source.indexOf('function render('));
function client(responses, revision='r1') {
  const requests = [], status = {}, runtime = [];
  const context = vm.createContext({AbortSignal, token: 'local-token', initialRevision: revision,
    $: () => status, updateControls() {}, render() {}, applyRuntime: data => runtime.push(data),
    fetch: async (url, options) => {
      requests.push({url, body: options.body && JSON.parse(options.body)});
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    }});
  vm.runInContext(`let workspace={targets:[],signals:[]}, workspaceRevision=initialRevision, saving=false;
    const workspaceError='Not loaded';
    ${apiSource}
    ${saveSource}
    globalThis.client={save:saveWorkspace, state:()=>({workspace,revision:workspaceRevision,saving})};`, context);
  return {client: context.client, requests, status, runtime};
}
test('workspace saves send the read revision and adopt the committed revision', async () => {
  const workspace = {targets: [], signals: [{id: 'new'}]};
  const a = client([Response.json({workspace, revision: 'r2'})]);
  await a.client.save(workspace);
  assert.deepEqual(a.requests[0].body, {...workspace, revision: 'r1'});
  assert.equal(a.client.state().revision, 'r2');
  assert.equal(a.client.state().saving, false);
  assert.equal(a.status.textContent, 'Saved on this PC');
});
test('a stale save reloads current settings without automatically overwriting them', async () => {
  const latest = {targets: [{id: 'second'}], signals: [{id: 'added-elsewhere'}]};
  const a = client([
    Response.json({error: 'Workspace changed'}, {status: 409}),
    Response.json({workspace: latest, revision: 'r2'}),
    Response.json({workspace: {...latest, activeTarget: 'second'}, revision: 'r3'}),
  ]);
  await assert.rejects(a.client.save({targets: [], signals: []}), /Latest settings loaded/);
  assert.equal(a.requests.length, 2);
  assert.equal(a.requests[1].url, '/api/state');
  assert.equal(a.client.state().workspace.signals[0].id, 'added-elsewhere');
  assert.equal(a.client.state().revision, 'r2');
  assert.equal(a.client.state().saving, false);
  assert.equal(a.status.textContent, 'Changes not saved');
  await a.client.save({...a.client.state().workspace, activeTarget: 'second'});
  assert.equal(a.requests[2].body.revision, 'r2');
  assert.equal(a.requests[2].body.signals[0].id, 'added-elsewhere');
  assert.equal(a.client.state().revision, 'r3');
});
test('failed conflict refresh leaves the stale revision intact and unlocks controls', async () => {
  const a = client([Response.json({error: 'Workspace changed'}, {status: 409}), new Error('Offline')]);
  await assert.rejects(a.client.save({targets: [], signals: []}), /Could not reload/);
  assert.equal(a.client.state().revision, 'r1');
  assert.equal(a.client.state().saving, false);
  assert.equal(a.status.textContent, 'Changes not saved');
});
test('an older engine without workspace revisions cannot receive an unsafe replacement', async () => {
  const a = client([], null);
  await assert.rejects(a.client.save({targets: [], signals: []}), /Update and restart the PC tester/);
  assert.equal(a.requests.length, 0);
  assert.equal(a.client.state().saving, false);
});

test('connection editor preserves legacy HTTP profiles while new devices default to Serial', () => {
  const editorSource=source.slice(source.indexOf('function openEditor('),source.indexOf("$('editForm').addEventListener"));
  const selections=[];
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{append(){},replaceChildren(){},showModal(){},focus(){}});return nodes.get(id);};
  const context=vm.createContext({$:node,lockWorkspace:()=>false,field:()=>({}),el:()=>({}),renderTransportFields(){},renderKeyPicker(){},
    selectField:(id,title,options,current)=>{selections.push({id,current});return {};}});
  vm.runInContext(`let editing=null;${editorSource};globalThis.open=openEditor;`,context);
  context.open('target',{id:'legacy',name:'This PC',host:'127.0.0.1',port:8420});
  assert.equal(selections.at(-1).current,'http');
  context.open('target',{id:'osc',type:'udp',name:'OSC Input'});
  assert.equal(selections.at(-1).current,'udp');
  context.open('target');
  assert.equal(selections.at(-1).current,'serial');
});

const removeTargetSource=source.slice(source.indexOf('async function removeTarget('),source.indexOf('function confirmAction('));
test('device X requires confirmation and removes dependent fields/rules',async()=>{
  for(const confirmed of [false,true]){
    const original={targets:[{id:'one',name:'Sensor'},{id:'two',name:'Other'}],sensors:[{sourceId:'one',rules:[{threshold:2.5}]},{sourceId:'two',rules:[{targetId:'one'},{targetId:'two'}]}]};
    const saved=[],prompts=[];
    const context=vm.createContext({workspace:original,lockWorkspace:()=>false,$:()=>({open:false}),clone:structuredClone,
      confirmAction:async(...args)=>{prompts.push(args);return confirmed;},saveWorkspace:async next=>saved.push(next),healthChecks:new Map(),toast(){}});
    vm.runInContext(`${removeTargetSource};globalThis.remove=removeTarget;`,context);
    await context.remove('one');
    assert.equal(prompts.length,1);
    assert.equal(saved.length,confirmed?1:0);
    assert.equal(original.targets.length,2);
    if(confirmed){assert.deepEqual(saved[0].targets,[original.targets[1]]);assert.equal(saved[0].sensors.length,1);assert.equal(saved[0].sensors[0].sourceId,'two');assert.deepEqual(Array.from(saved[0].sensors[0].rules,r=>r.targetId),['two']);}
  }
});

test('sidebar connection toggle operates on its own device and releases busy state',async()=>{
  const io=readFileSync(new URL('./signal-tester/signal_tester_ui/io.js',import.meta.url),'utf8');
  const fn=io.slice(io.indexOf('async function toggleConnection('),io.indexOf('function ioSetup('));
  const requests=[],states={other:{status:'closed'}};
  const ctx=vm.createContext({workspace:{targets:[{id:'other',type:'udp'}]},active:()=>({id:'selected'}),lockWorkspace:()=>false,engineOffline:false,connectionStates:states,kind:t=>t.type,
    renderIO(){},updateControls(){},renderTargets(){},toast(){},applyRuntime(){},api:async(path,body)=>{requests.push({path,body});states.other.status=path==='io/open'?'open':'closed';return {};}});
  vm.runInContext(`let ioBusy=false;${fn};globalThis.toggle=toggleConnection;globalThis.busy=()=>ioBusy;`,ctx);
  await ctx.toggle('other');await ctx.toggle('other');
  assert.deepEqual(requests.map(r=>r.path),['io/open','io/close']);
  assert.deepEqual(requests.map(r=>r.body.targetId),['other','other']);assert.equal(ctx.busy(),false);
});
