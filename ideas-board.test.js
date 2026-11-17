import {test} from 'node:test';
import assert from 'node:assert/strict';
import './assets/ideas-board.js';
const M=globalThis.IdeaModel;

test('video paste supports YouTube variants, timestamps, Vimeo private links and direct media',()=>{
  for(const url of ['https://youtu.be/M7lc1UVf-VE','https://www.youtube.com/watch?v=M7lc1UVf-VE','https://m.youtube.com/shorts/M7lc1UVf-VE','https://www.youtube.com/live/M7lc1UVf-VE'])assert.equal(M.media(url).embed,'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE');
  assert.match(M.media('https://youtu.be/M7lc1UVf-VE?t=1m30s').embed,/start=90/);
  assert.equal(M.media('https://vimeo.com/12345678/abc123').embed,'https://player.vimeo.com/video/12345678?h=abc123');
  assert.equal(M.media('https://player.vimeo.com/video/12345678?h=abc123').embed,'https://player.vimeo.com/video/12345678?h=abc123');
  assert.equal(M.media('https://example.com/film.MP4?token=sample').kind,'video');
  assert.equal(M.media('https://example.com/image.webp?size=large').kind,'image');
});
test('unrecognized URLs remain links and pasted content cannot create arbitrary iframe sources',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,<script>','file:///private','https://user:password@example.com'])assert.equal(M.media(url),null);
  for(const url of ['https://youtube.com.evil.example/watch?v=M7lc1UVf-VE','https://example.com/watch','https://www.youtube.com/watch?v=bad'])assert.equal(M.media(url).kind,'link');
  const card=M.cleanItem({id:'x',kind:'embed',url:'https://example.com',embed:'javascript:alert(1)'});
  assert.equal(card.kind,'link');assert.equal(card.embed,undefined);
  assert.throws(()=>M.cleanItem({kind:'image',url:'javascript:alert(1)'}));
});
test('image cards preserve binary blobs through independent undo history snapshots',()=>{
  const blob=new Blob(['sample'],{type:'image/png'}),card=M.cleanItem({id:'image',kind:'image',blob,width:320,title:'A'}),history=M.history();
  const initial=[card];history.push(initial);card.x=400;card.title='Changed';
  const previous=history.undo(initial);assert.equal(previous[0].x,0);assert.equal(previous[0].title,'A');assert.equal(previous[0].blob,blob);
  const redone=history.redo(previous);assert.equal(redone[0].x,400);assert.equal(redone[0].blob,blob);
  history.push(previous);assert.equal(history.canRedo,false);
  assert.throws(()=>M.cleanItem({kind:'image',blob:new Blob(['svg'],{type:'image/svg+xml'})}));
});
test('zoom anchors preserve world coordinates and layout values are bounded on restore',()=>{
  const view={x:50,y:-20,zoom:.5},anchor={x:300,y:200},next=M.zoomAt(view,1,anchor),bounds={left:0,top:0};
  assert.deepEqual(M.point(300,200,bounds,view),M.point(300,200,bounds,next));
  assert.equal(M.zoomAt(view,99,anchor).zoom,2);
  const card=M.cleanItem({id:'n',kind:'note',x:Infinity,y:-1e20,width:1,ratio:Infinity,text:'<script>alert(1)</script>'});
  assert.equal(card.x,0);assert.equal(card.y,-100000);assert.equal(card.width,180);assert.equal(card.text,'<script>alert(1)</script>');
});
