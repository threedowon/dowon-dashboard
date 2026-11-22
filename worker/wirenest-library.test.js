import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installLibraryBridge} from '../assets/wirenest-library-bridge.js';
test('backup broker rejects untrusted messages and limits operations to backups',async()=>{
 const nonce='00000000-0000-4000-8000-000000000001',sent=[],calls=[];let listener;
 const parent={postMessage:(m,origin)=>sent.push({m,origin})};
 const win={opener:parent,location:{hash:'#session='+nonce},addEventListener:(n,f)=>listener=f};
 installLibraryBridge({win,request:async(url,options)=>{calls.push({url,options});return Response.json({documents:[{id:'test'}]});}});
 assert.equal(sent[0].m.type,'ready');assert.equal(sent[0].origin,'https://threedowon.github.io');
 const event={source:parent,origin:'https://threedowon.github.io',data:{channel:'wirenest-library',nonce,id:'one',action:'list'}};
 await listener({...event,origin:'https://evil.example'});await listener({...event,source:{}});await listener({...event,data:{...event.data,nonce:'bad'}});assert.equal(calls.length,0);
 await listener(event);assert.deepEqual(sent.at(-1).m.documents,[{id:'test'}]);assert.equal(calls[0].options.credentials,'include');assert.equal(calls[0].url,'https://api.3dowon.com/api/wirenest');
 await listener({...event,data:{...event.data,id:'two',action:'open',documentId:'../../backup'}});assert.equal(calls.length,1);assert.match(sent.at(-1).m.error,/ID/);
 await listener({...event,data:{...event.data,id:'three',action:'delete'}});assert.equal(calls.length,1);
});
