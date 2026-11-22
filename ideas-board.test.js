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

const box=(x,y,width=200,height=120,id='moving')=>({id,x,y,width,height});
test('guides snap both axes to card edges without changing size or source records',()=>{
 const rect=box(104,204),peer=box(100,200,320,180,'peer'),before=structuredClone([rect,peer]);
 const out=M.snapMove(rect,[peer]);assert.equal(out.x,100);assert.equal(out.y,200);assert.equal(out.guides.length,2);
 assert.deepEqual([rect,peer],before);
});
test('centres align for different image, video and note dimensions',()=>{
 const out=M.snapMove(box(184,300,160,270),[box(100,800,320,160,'peer')]);
 assert.equal(out.x,180);assert.equal(out.y,300);assert.equal(out.guides[0].position,260);
});
test('capture distance remains six screen pixels at all supported zoom levels',()=>{
 const peer=box(100,500,200,120,'peer');
 for(const zoom of [.2,.5,1,2]){
  assert.equal(M.snapMove(box(100+5/zoom,20),[peer],{zoom}).x,100);
  assert.equal(M.snapMove(box(100+7/zoom,20),[peer],{zoom}).x,100+7/zoom);
 }
});
test('uniform spacing snaps on either side and reports the measured gap',()=>{
 const peer=box(100,100,200,120,'peer');
 const right=M.snapMove(box(327,100),[peer],{spacing:24});assert.equal(right.x,324);assert.equal(right.guides.find(g=>g.kind==='gap').label,'24 px');
 const left=M.snapMove(box(-120,100),[peer],{spacing:24});assert.equal(left.x,-124);
 const below=M.snapMove(box(100,255),[peer],{spacing:32});assert.equal(below.y,252);
});
test('grid rounds board coordinates including negatives and does not mutate existing cards',()=>{
 const out=M.snapMove(box(-13,51),[],{grid:true,spacing:24});assert.equal(out.x,-24);assert.equal(out.y,48);assert.deepEqual(out.guides,[]);
});
test('card alignment wins over the grid, while Alt bypasses both snapping modes',()=>{
 const rect=box(102,203),peers=[box(100,200,200,120,'peer')];
 assert.equal(M.snapMove(rect,peers,{grid:true}).x,100);
 assert.deepEqual(M.snapMove(rect,peers,{grid:true,disabled:true}),{x:102,y:203,guides:[]});
 assert.deepEqual(M.snapMove(rect,peers,{guides:false}),{x:102,y:203,guides:[]});
});
test('self is ignored, geometry is bounded, and a real neighbour can still align',()=>{
 assert.deepEqual(M.snapMove(box(13,17),[box(13,17)]),{x:13,y:17,guides:[]});
 const out=M.snapMove(box(99999,-99999),[],{grid:true,spacing:48});assert.ok(out.x<=100000&&out.y>=-100000);
});
test('snapped positions survive the existing undo/redo and clean-item persistence path',()=>{
 const items=[M.cleanItem({...box(103,204),kind:'note',text:'Keep my note'})],h=M.history();h.push(items);
 const snapped=M.snapMove({...items[0],height:160},[box(100,200,320,160,'peer')]);items[0].x=snapped.x;items[0].y=snapped.y;
 const previous=h.undo(items);assert.equal(previous[0].x,103);assert.equal(previous[0].y,204);
 const restored=M.cleanItem(h.redo(previous)[0]);assert.equal(restored.x,100);assert.equal(restored.y,200);assert.equal(restored.text,'Keep my note');
});
