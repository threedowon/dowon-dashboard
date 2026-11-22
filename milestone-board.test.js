import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('./assets/ideas-board.js',import.meta.url),'utf8');
function setup(saved=new Map()){
 const elements=new Map();
 class Element{
  constructor(){this.dataset={};this.style={};this.children=[];this.value='';this.innerHTML='';this.classList={add(){},remove(){},toggle(){}};this.scrollHeight=160;}
  addEventListener(){} setAttribute(){} removeAttribute(){} focus(){} click(){} setSelectionRange(){} matches(){return false;} contains(){return false;}
  closest(){return this;} getBoundingClientRect(){return {left:0,top:0,width:1000,height:700};}
  querySelector(selector){if(selector==='textarea.idea-note')return null;return new Element();} querySelectorAll(){return [];}
  replaceChildren(){this.children=[];} append(el){this.children.push(el);} remove(){}
 }
 const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const document={getElementById:$,createElement:()=>new Element(),addEventListener(){},activeElement:new Element()};
 const context=vm.createContext({document,window:{addEventListener(){}},localStorage:{getItem(){return null;},setItem(){}},crypto:webcrypto,CSS:{escape:s=>s},TextEncoder,Blob,URL,Image:class{},setTimeout,clearTimeout,setInterval(){},console});
 vm.runInContext(source,context);
 const storage={all:async()=>structuredClone([...saved.values()]),get:async id=>structuredClone(saved.get(id)),put:async r=>saved.set(r.projectId,structuredClone(r))};
 const board=context.IdeasBoard.attach({getProjects:()=>[{id:'project',name:'Project'}],createProject(){},isActive:()=>true,storage});
 return {board,saved,model:context.IdeaModel,$};
}

test('zoom selector scales the board without changing cards and follows non-preset zoom',async()=>{
 const {board,saved,$}=setup();await board.ready;
 await board.ingest({text:'Keep the original content'});await board.flush();
 const before=structuredClone(saved.get('project').items);
 $('ideasZoomLevel').onchange({target:{value:'0.5'}});
 assert.match($('ideasWorld').style.transform,/scale\(0\.5\)/);
 assert.equal($('ideasZoom').textContent,'50%');
 $('ideasZoomIn').onclick();
 assert.equal($('ideasZoomLevel').value,'0.6');
 assert.equal($('ideasZoomCurrent').textContent,'60%');
 $('ideasZoomLevel').onchange({target:{value:'invalid'}});
 assert.equal($('ideasZoomLevel').value,'0.6');
 $('ideasFit').onclick();await board.flush();
 assert.equal($('ideasZoomLevel').value,'1');
 assert.deepEqual(saved.get('project').items,before);
});
test('card board IDs are stable, bounded and isolated across projects and milestones',async()=>{
 const {model,board}=setup();await board.ready;
 const a=await model.cardBoardId('p','m');assert.equal(a,await model.cardBoardId('p','m'));assert.match(a,/^milestone:[a-f0-9]{64}$/);
 assert.notEqual(a,await model.cardBoardId('other','m'));assert.notEqual(a,await model.cardBoardId('p','other'));
 assert.notEqual(await model.cardBoardId('a:b','c'),await model.cardBoardId('a','b:c'));
 assert.equal((await model.cardBoardId('a'.repeat(500),'b'.repeat(500))).length,74);
});
test('notes and image links persist on their own card board without changing the project board',async()=>{
 const {board,saved,model,$}=setup();await board.ready;
 await board.ingest({text:'Project note'});await board.flush();
 const a=await model.cardBoardId('project','a'),b=await model.cardBoardId('project','b');
 await board.openBoard({id:a,name:'Project / A'});
 await board.ingest({text:'Card A memo'});await board.ingest({text:'https://example.com/reference.png'});await board.flush();
 assert.equal(saved.get(a).items.length,2);assert.equal(saved.get(a).items[0].text,'Card A memo');assert.equal(saved.get(a).items[1].kind,'image');
 await board.openBoard({id:b,name:'Project / B'});await board.ingest({text:'Card B memo'});await board.flush();
 assert.equal(saved.get(b).items.length,1);assert.equal(saved.get('project').items[0].text,'Project note');
 await board.openBoard(null);assert.equal($('ideasProject').value,'project');assert.ok(!$('ideasProject').innerHTML.includes('milestone:'));
 const reloaded=setup(saved);await reloaded.board.ready;await reloaded.board.openBoard({id:a,name:'Project / renamed A'});
 assert.equal(reloaded.$('ideasCount').textContent,'2개 자료');
});
