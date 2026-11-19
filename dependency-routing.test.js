import {test} from 'node:test';
import assert from 'node:assert/strict';
import './assets/roadmap.js';
import './assets/dependency-map.js';
const M=globalThis.DependencyMap;
const card=(id,x,y,width=218,height=100)=>({id,x,y,width,height});
// Split a segment at every rectangle boundary and inspect the resulting open intervals.
function enters(a,b,r){
 const dx=b[0]-a[0],dy=b[1]-a[1],cuts=[0,1];
 if(dx)cuts.push((r.x-a[0])/dx,(r.x+r.width-a[0])/dx);
 if(dy)cuts.push((r.y-a[1])/dy,(r.y+r.height-a[1])/dy);
 const times=cuts.filter(t=>t>=0&&t<=1).sort((a,b)=>a-b);
 return times.slice(1).some((hi,i)=>{const t=(hi+times[i])/2,x=a[0]+dx*t,y=a[1]+dy*t;return x>r.x+1e-6&&x<r.x+r.width-1e-6&&y>r.y+1e-6&&y<r.y+r.height-1e-6;});
}
function verify(model,edge){
 const r=M.routeEdge(model,edge);assert.equal(r.blocked,false,JSON.stringify(edge));assert.ok(r.points.length>=2);assert.ok(!/[CQ]/.test(r.path));
 assert.deepEqual(r.points[0],M.anchor(edge.from,edge.fromSide||'bottom'));assert.deepEqual(r.points.at(-1),M.anchor(edge.to,edge.toSide||'top'));
 for(let i=1;i<r.points.length;i++)for(const obstacle of model.items)assert.equal(enters(r.points[i-1],r.points[i],obstacle),false,`Route ${edge.from.id}→${edge.to.id} enters ${obstacle.id}: ${JSON.stringify(r.points)}`);
 if(r.points.length>2)for(let i=1;i<r.points.length;i++)assert.ok(r.points[i][0]===r.points[i-1][0]||r.points[i][1]===r.points[i-1][1]);
 return r;
}
test('unobstructed vertical, horizontal and diagonal connections use a single straight segment',()=>{
 const a=card('a',172,0),b=card('b',172,220),c=card('c',424,0),d=card('d',424,220),model={items:[a,b,c,d],top:170};
 for(const edge of [{from:a,to:b},{from:a,to:c,fromSide:'right',toSide:'left'},{from:a,to:d,fromSide:'bottom',toSide:'top'}])assert.equal(verify(model,edge).points.length,2);
});
test('blocked connections detour around the intervening card and the source/target themselves',()=>{
 const a=card('a',172,0),b=card('b',172,400),obstacle=card('blocker',172,150,218,200),model={items:[a,b,obstacle]};
 assert.ok(verify(model,{from:a,to:b}).points.length>2);
 for(const fromSide of ['top','right','bottom','left'])for(const toSide of ['top','right','bottom','left'])verify(model,{from:a,to:b,fromSide,toSide});
 verify(model,{from:b,to:a,fromSide:'bottom',toSide:'top'});
});
test('multi-column obstacles and long cards do not hide any segment',()=>{
 const a=card('a',172,0),b=card('b',928,480),model={items:[a,b,card('wide',410,140,490,160),card('tall',676,320,218,800),card('other',172,400)]};
 for(const fromSide of ['top','right','bottom','left'])for(const toSide of ['top','right','bottom','left'])verify(model,{from:a,to:b,fromSide,toSide});
});
test('narrow date gaps and fractional day positions still have visible routes',()=>{
 const a=card('a',172,0,218,100),blocker=card('blocker',172,106,218,180.3333333333),b=card('b',172,292.3333333333),model={items:[a,blocker,b]};
 verify(model,{from:a,to:b});verify(model,{from:blocker,to:a,fromSide:'top',toSide:'bottom'});
 assert.equal(verify(model,{from:a,to:blocker}).points.length,2);
});
test('routing updates when a card moves or changes height without changing stored dependencies',()=>{
 const a=card('a',172,0),b=card('b',172,400),obstacle=card('obstacle',424,160,218,180),before={items:[a,b,obstacle]};
 assert.equal(verify(before,{from:a,to:b}).points.length,2);
 const moved={items:[a,b,{...obstacle,x:172}]};assert.ok(verify(moved,{from:a,to:b}).points.length>2);
 assert.equal(obstacle.x,424);assert.equal(verify(before,{from:a,to:b}).points.length,2);
});
test('dense maps preserve all four ports without crossing other projects or dates',()=>{
 const items=[];for(let row=0;row<5;row++)for(let col=0;col<6;col++)items.push(card(`${row}-${col}`,172+252*col,row*180+col/7,218,130));
 const model={items};const sides=['top','right','bottom','left'];
 for(let i=0;i<items.length;i++)for(let j=0;j<4;j++)verify(model,{from:items[i],to:items[(i+7+j)%items.length],fromSide:sides[j],toSide:sides[(i+j)%4]});
});
test('interactive and exported maps use the same routed lines and do not mutate project data',()=>{
 const p={id:'p',name:'프로젝트',milestones:[{id:'a',title:'시작',start:'2026-11-16',due:'2026-11-17',flowColumn:0},{id:'block',title:'중간 카드',start:'2026-11-18',due:'2026-11-20',flowColumn:0},{id:'b',title:'도착',start:'2026-11-23',due:'2026-11-24',flowColumn:0,dependsOn:[{projectId:'p',milestoneId:'a',fromSide:'bottom',toSide:'top'}]}]};
 const original=JSON.stringify(p),portfolio=Roadmap.portfolio([p]),live=M.svg(portfolio,'2026-11-18',{interactive:true}),exported=M.svg(portfolio,'2026-11-18',{report:true});
 const liveRoute=verify(live.model,live.model.edges[0]),exportRoute=verify(exported.model,exported.model.edges[0]);
 assert.deepEqual(liveRoute.points,exportRoute.points);assert.ok(live.markup.includes(`d="${liveRoute.path}"`));assert.ok(exported.markup.includes(`d="${exportRoute.path}"`));assert.equal(JSON.stringify(p),original);
});

test('segment dragging retains endpoints and stores a movable orthogonal detour',()=>{
 const a=card('a',172,0),b=card('b',172,400),edge={from:a,to:b},model={items:[a,b],top:48};
 const original=M.routeEdge(model,edge).points;
 const updates=M.adjustRoute(edge,original,'0',[340,250]);
 const routed=M.routeEdge(model,{...edge,...updates});
 assert.deepEqual(routed.points,[[281,100],[340,100],[340,400],[281,400]]);
 assert.deepEqual(original,[[281,100],[281,400]]);
 const middle=M.adjustRoute({...edge,...updates},routed.points,'1',[360,250]);
 assert.deepEqual(M.routeEdge(model,{...edge,...middle}).points,[[281,100],[360,100],[360,400],[281,400]]);
 assert.match(routed.path,/M281 148/);
});

test('endpoint dragging snaps to the card perimeter and survives normalization',()=>{
 const a=card('a',172,0),b=card('b',424,400),edge={from:a,to:b},model={items:[a,b]};
 const updates=M.adjustRoute(edge,M.routeEdge(model,edge).points,'end',[500,398]);
 assert.equal(updates.toSide,'top');assert.equal(updates.toOffset,76/218);
 const ref=M.normalize([{projectId:'p',milestoneId:'a',...updates}])[0];
 assert.deepEqual(M.routeEdge(model,{...edge,...ref}).points.at(-1),[500,400]);
 assert.deepEqual(M.normalize([{projectId:'p',milestoneId:'a',route:[[NaN,2]],fromOffset:Infinity}]),[{projectId:'p',milestoneId:'a'}]);
});

test('edited routes persist through reload and export and participate in undo',async()=>{
 await import('./assets/dependency-editor.js');
 const projects=[{id:'p',name:'P',milestones:[{id:'a',title:'A',start:'2026-11-16',due:'2026-11-17'},{id:'b',title:'B',start:'2026-11-23',due:'2026-11-24',dependsOn:[{projectId:'p',milestoneId:'a'}]}]}];
 const history=EditHistory.create(projects),model=M.svg(Roadmap.portfolio(projects),'2026-11-19').model,edge=model.edges[0],points=M.routeEdge(model,edge).points;
 const updates=M.adjustRoute(edge,points,'0',[points[0][0]+45,(points[0][1]+points[1][1])/2]);
 assert.equal(M.setRoute(projects,edge.from.id,edge.to.id,updates).changed,true);history.record(projects);
 assert.equal(M.setRoute(projects,edge.from.id,edge.to.id,updates).changed,false);
 const restored=JSON.parse(JSON.stringify(projects));restored[0].milestones[1].dependsOn=M.normalize(restored[0].milestones[1].dependsOn);
 const live=M.svg(Roadmap.portfolio(restored),'2026-11-19',{interactive:true}),report=M.svg(Roadmap.portfolio(restored),'2026-11-19',{report:true});
 assert.equal(M.routeEdge(live.model,live.model.edges[0]).path,M.routeEdge(report.model,report.model.edges[0]).path);
 assert.equal(history.undo()[0].milestones[1].dependsOn[0].route,undefined);
 assert.deepEqual(history.redo(),projects);
});
