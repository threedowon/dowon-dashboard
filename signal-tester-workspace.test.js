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
