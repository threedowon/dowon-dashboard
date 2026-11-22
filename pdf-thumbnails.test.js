import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createThumbnailStore} from './assets/pdf-thumbnails.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('thumbnails deduplicate selection rerenders and limit concurrent rendering',async()=>{
 const calls=[],finish=new Map();let active=0,peak=0;
 const store=createThumbnailStore({render:({id})=>{calls.push(id);active++;peak=Math.max(peak,active);return new Promise(resolve=>finish.set(id,()=>{active--;resolve({url:'blob:'+id});}));},revoke(){}});
 const a=store.get('a:v1',{id:'a'}),same=store.get('a:v1',{id:'a'}),b=store.get('b:v1',{id:'b'}),c=store.get('c:v1',{id:'c'});
 assert.equal(a,same);await tick();assert.deepEqual(calls,['a','b']);finish.get('a')();await a;await tick();assert.deepEqual(calls,['a','b','c']);
 finish.get('b')();finish.get('c')();await Promise.all([b,c]);assert.equal(peak,2);store.dispose();
});

test('revisions regenerate previews, old previews are evicted, and dispose revokes URLs',async()=>{
 const revoked=[],calls=[];const store=createThumbnailStore({maxEntries:2,render:async({id})=>{calls.push(id);return {url:'blob:'+id};},revoke:url=>revoked.push(url)});
 await store.get('a:v1',{id:'a1'});await store.get('b:v1',{id:'b1'});await store.get('a:v2',{id:'a2'});await tick();
 assert.deepEqual(revoked,['blob:a1']);assert.deepEqual(await store.get('a:v2',{id:'ignored'}),{url:'blob:a2'});assert.equal(calls.length,3);
 store.dispose();assert.deepEqual(new Set(revoked),new Set(['blob:a1','blob:b1','blob:a2']));
});

test('password and rendering failures have a fallback and can be retried',async()=>{
 let broken=true,calls=0;const store=createThumbnailStore({render:async()=>{calls++;if(broken)throw Object.assign(Error('locked'),{name:'PasswordException'});return {url:'blob:ready'};},revoke(){}});
 assert.deepEqual(await store.get('a',{}),{error:'Password protected PDF'});await store.get('a',{});assert.equal(calls,1);
 broken=false;store.retryFailures();assert.deepEqual(await store.get('a',{}),{url:'blob:ready'});store.dispose();
});

test('disposing during rendering drops queued work and releases late results',async()=>{
 let finish;const revoked=[];const store=createThumbnailStore({maxConcurrent:1,render:()=>new Promise(resolve=>finish=resolve),revoke:url=>revoked.push(url)});
 const active=store.get('active',{}),queued=store.get('queued',{});await tick();store.dispose();assert.deepEqual(await queued,{error:'Preview unavailable'});
 finish({url:'blob:late'});await active;assert.deepEqual(revoked,['blob:late']);
});

test('a render skipped after leaving the page can run again on return',async()=>{
 let first=true;const store=createThumbnailStore({render:async()=>{if(first){first=false;throw Object.assign(Error('inactive'),{name:'AbortError'});}return {url:'blob:returned'};},revoke(){}});
 await store.get('a',{});assert.deepEqual(await store.get('a',{}),{url:'blob:returned'});store.dispose();
});
