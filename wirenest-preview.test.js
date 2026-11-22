import {test} from 'node:test';
import assert from 'node:assert/strict';
import './assets/wirenest-preview.js';
const base=()=>({app:'wirenest',boards:{b:{x:10,y:20,w:20,d:10,rot:90,name:'Control',color:'#187350'}},nodes:{a:{board:'b',u:0,v:0},b:{wx:60,wy:50}},wires:{w:{a:'a',b:'b',netId:'power',wps:[{x:40,y:100,z:35}]}},nets:{power:{color:'#ff0000'}}});
test('preview respects board rotation, world nodes, net colors, and top-view waypoint axes',()=>{
 const result=WireNestPreview.svg(base());
 assert.match(result.markup,/rotate\(90 20 25\)/);assert.match(result.markup,/M25 15 L40 35 L60 50/);assert.match(result.markup,/stroke="#ff0000"/);
 assert.equal(result.summary,'1 boards · 2 pins · 1 wires · Top view');
});
test('preview escapes project labels and refuses injected colors or external SVG resources',()=>{
 const p=base();p.boards.b.name='<script>alert(1)</script>';p.boards.b.color='url(https://bad.test)';p.wires.w.color='" onload="bad()';
 const {markup}=WireNestPreview.svg(p);assert.ok(markup.includes('&lt;script&gt;'));assert.ok(!markup.includes('<script'));assert.ok(!markup.includes('onload'));assert.ok(!markup.includes('https://bad.test'));
});
test('missing endpoints and non-finite coordinates never produce broken SVG',()=>{
 const p=base();p.nodes.a.board='missing';p.nodes.b.wx=Infinity;p.wires.w.wps=[{x:NaN,z:Infinity}];
 const {markup}=WireNestPreview.svg(p);assert.ok(!markup.includes('<path'));assert.ok(!/NaN|Infinity/.test(markup));
});
test('empty, unsupported and oversized projects have honest preview outcomes',()=>{
 assert.equal(WireNestPreview.svg({app:'wirenest',boards:{},nodes:{},wires:{}}).markup,'');
 assert.throws(()=>WireNestPreview.svg({app:'other'}),/supported/);
 const p=base();p.nodes=Object.fromEntries(Array.from({length:3001},(_,i)=>[i,{wx:i,wy:1}]));assert.throws(()=>WireNestPreview.svg(p),/Large project/);
});
