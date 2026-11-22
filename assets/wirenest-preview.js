// Read-only top view of the saved WireNest v2 geometry. Never executes file content.
(() => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(n,fallback=0)=>Number.isFinite(Number(n))?Math.max(-1e6,Math.min(1e6,Number(n))):fallback;
  const color=(v,fallback)=>/^#[\da-f]{3,8}$/i.test(String(v))?v:fallback;
  const values=v=>v&&typeof v==='object'?Object.entries(v).filter(([,x])=>x&&typeof x==='object').map(([id,x])=>({...x,id})):[];
  function rotate(x,y,b){const a=b.rot*Math.PI/180,cx=b.x+b.w/2,cy=b.y+b.d/2;return [cx+(x-cx)*Math.cos(a)-(y-cy)*Math.sin(a),cy+(x-cx)*Math.sin(a)+(y-cy)*Math.cos(a)];}
  function svg(project){
    if(project?.app!=='wirenest'||!project.boards||!project.nodes||!project.wires)throw Error('This file has no supported WireNest preview.');
    const boards=values(project.boards),nodes=values(project.nodes),wires=values(project.wires);
    if(boards.length>500||nodes.length>3000||wires.length>3000)throw Error('Large project — open in WireNest to view.');
    const boardMap=new Map(),points=new Map(),bounds=[];
    for(const raw of boards){const b={...raw,x:num(raw.x),y:num(raw.y),w:Math.max(.5,num(raw.w,30)),d:Math.max(.5,num(raw.d??raw.h,30)),rot:num(raw.rot)};boardMap.set(b.id,b);for(const [x,y] of [[b.x,b.y],[b.x+b.w,b.y],[b.x,b.y+b.d],[b.x+b.w,b.y+b.d]])bounds.push(rotate(x,y,b));}
    for(const n of nodes){const b=boardMap.get(n.board);if(n.board&&!b)continue;const p=b?rotate(b.x+num(n.u),b.y+num(n.v),b):[num(n.wx),num(n.wy)];points.set(n.id,p);bounds.push(p);}
    const paths=[];
    for(const w of wires){const a=points.get(w.a),b=points.get(w.b);if(!a||!b)continue;
      const route=[a,...(Array.isArray(w.wps)?w.wps.slice(0,200).filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.z)).map(p=>[num(p.x),num(p.z)]):[]),b];bounds.push(...route);paths.push({w,route});}
    if(!bounds.length)return {markup:'',summary:'Empty project — no boards or connections yet.'};
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const [x,y] of bounds){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    const span=Math.max(maxX-minX,maxY-minY,10),pad=span*.1,stroke=span/180,label=span/35;
    const shapes=[...boardMap.values()].sort((a,b)=>num(a.z)-num(b.z)).map(b=>`<g transform="rotate(${b.rot} ${b.x+b.w/2} ${b.y+b.d/2})"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.d}" rx="${stroke}" fill="${color(b.color,'#237447')}" fill-opacity="${b.modelRole==='housing'?.12:1}" stroke="#26332a" stroke-width="${stroke}"/><title>${esc(b.name)}</title><text x="${b.x+b.w/2}" y="${b.y+Math.min(b.d*.25,label*1.4)}" text-anchor="middle" font-size="${Math.min(label,b.w/Math.max(String(b.name||'Board').length*.6,5))}" fill="${b.modelRole==='housing'?'#333':'#fff'}" font-family="sans-serif">${esc(b.name||'Board')}</text></g>`).join('');
    const lines=paths.map(({w,route})=>{const d=route.map(([x,y],i)=>(i?'L':'M')+x+' '+y).join(' ');return `<path d="${d}" fill="none" stroke="#242424" stroke-width="${stroke*2.8}" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${color(w.color||project.nets?.[w.netId]?.color,'#e4bc32')}" stroke-width="${stroke*1.6}" stroke-linejoin="round"/>`;}).join('');
    const pins=[...points.values()].map(([x,y])=>`<rect x="${x-stroke*1.5}" y="${y-stroke*1.5}" width="${stroke*3}" height="${stroke*3}" fill="#f6df69" stroke="#252525" stroke-width="${stroke*.5}"/>`).join('');
    return {markup:`<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Saved wiring layout, top view" viewBox="${minX-pad} ${minY-pad} ${maxX-minX+pad*2} ${maxY-minY+pad*2}">${shapes}${lines}${pins}</svg>`,summary:`${boards.length} boards · ${nodes.length} pins · ${wires.length} wires · Top view`};
  }
  globalThis.WireNestPreview={svg};
})();
