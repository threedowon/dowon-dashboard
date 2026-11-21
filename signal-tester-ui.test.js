import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./assets/signal-tester.js', import.meta.url), 'utf8');
const token = 'a'.repeat(43);
function app({readonly = false, fetcher} = {}) {
  const elements = new Map(), storage = new Map(), requests = [];
  const el = id => {
    if (!elements.has(id)) elements.set(id, {value: '', children: [], addEventListener(name, fn) {this[name] = fn;}, replaceChildren(...children) {this.children = children;}});
    return elements.get(id);
  };
  const context = {document: {documentElement: {dataset: {readonly: String(readonly)}}, getElementById: el, createElement: () => ({})},
    sessionStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    window: {addEventListener() {}}, location: {hash: '#signaltester'}, AbortSignal, TypeError,
    fetch: async (...args) => {requests.push(args); return fetcher ? fetcher(...args) : Response.json({workspace: {targets: []}});}};
  vm.runInNewContext(source, context);
  return {el, storage, requests, submit(code) {el('signalPairCode').value = code; el('signalPairForm').submit({preventDefault() {}});}};
}
const settle = async () => {for(let i=0;i<5;i++) await new Promise(resolve => setImmediate(resolve));};
test('pairing uses only loopback, keeps token out of URLs and loads existing tester after validation', async () => {
  const a = app(); a.submit('8421:' + token); await settle();
  assert.equal(a.requests[0][0], 'http://127.0.0.1:8421/api/state');
  assert.equal(a.requests[0][1].headers['X-Tester-Token'], token);
  assert.equal(a.el('signalFrameHost').children[0].src, 'signal-tester/signal_tester_ui/index.html');
  assert.equal(a.el('signalPairCode').value, '');
  assert.equal(a.storage.size, 1);
  a.el('signalForget').onclick();
  assert.equal(a.storage.size, 0);
  assert.equal(a.el('signalFrameHost').children.length, 0);
  assert.equal(a.requests.length, 1, 'disconnecting the screen must not send shutdown');
});
test('invalid codes and readonly snapshots never contact a device', async () => {
  const a = app();
  for (const code of ['0:'+token, '65536:'+token, '8421:short', 'http://evil.example:'+token]) a.submit(code);
  assert.equal(a.requests.length, 0);
  const readonly = app({readonly: true}); readonly.submit('8421:'+token); await settle();
  assert.equal(readonly.requests.length, 0);
});
test('a late response cannot re-pair after user disconnects', async () => {
  let resolve;
  const a = app({fetcher: () => new Promise(r => {resolve = r;})});
  a.submit('8421:'+token); a.el('signalForget').onclick();
  resolve(Response.json({workspace: {targets: []}})); await settle();
  assert.equal(a.storage.size, 0);
  assert.equal(a.el('signalFrameHost').children.length, 0);
});
test('rejected and blocked bridge requests leave no active frame or credentials', async () => {
  for (const fetcher of [() => Response.json({error: 'denied'}, {status: 403}), () => {throw new TypeError('Failed to fetch');}]) {
    const a = app({fetcher}); a.submit('8421:'+token); await settle();
    assert.equal(a.storage.size, 0);
    assert.equal(a.el('signalFrameHost').children.length, 0);
    assert.equal(a.el('signalPairButton').disabled, false);
    assert.equal(a.el('signalLocalLink').href, 'http://127.0.0.1:8421/');
  }
});
