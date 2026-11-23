import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const base=new URL('./signal-tester/',import.meta.url);
const bundle=JSON.parse(fs.readFileSync(new URL('signal_tester_ui/code-guide.json',base),'utf8'));
const source=fs.readFileSync(new URL('signal_tester_ui/code-guide.js',base),'utf8');

test('offline documents match source files and all internal page and section links resolve',()=>{
  for(const doc of Object.values(bundle.pages)){
    assert.equal(doc.sha256,createHash('sha256').update(fs.readFileSync(new URL(doc.source,base),'utf8').replace(/\r\n/g,'\n')).digest('hex'),`${doc.source}: regenerate build_guide.py`);
    for(const [,page,anchor] of doc.html.matchAll(/data-guide-page="([^"]+)" data-guide-anchor="([^"]*)"/g)){
      assert.ok(bundle.pages[page],page);
      if(anchor)assert.ok(bundle.pages[page].html.includes(`id="${anchor}"`),`${page}#${anchor}`);
    }
    assert.doesNotMatch(doc.html,/<script|<iframe|\son\w+=/i);
  }
});

function harness(){
  const nodes=new Map(),requests=[],copies=[],copyButtons=[];
  function node(){return {children:[],dataset:{},textContent:'',innerHTML:'',value:'',open:false,scrollTop:0,
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
    showModal(){this.open=true;},close(){this.open=false;},focus(){},scrollIntoView(){},
    addEventListener(name,fn){this[name]=fn;},querySelectorAll(){return [];}};}
  const $=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const code={textContent:'Serial.println(value);\n',parentElement:{before:button=>copyButtons.push(button)}};
  $('codeGuideArticle').querySelectorAll=selector=>selector==='pre > code.language-cpp'?[code]:[];
  let fail=false,clipboardFail=false;
  vm.runInNewContext(source,{document:{getElementById:$,createElement:node},AbortSignal,
    navigator:{clipboard:{writeText:async text=>{if(clipboardFail)throw Error('denied');copies.push(text);}}},
    fetch:async url=>{requests.push(url);if(fail)throw Error('offline');return {ok:true,json:async()=>bundle};}});
  return {$,requests,copies,copyButtons,set fail(value){fail=value;},set clipboardFail(value){clipboardFail=value;}};
}

test('reader navigates bundled pages and copies source without requesting a device or the network',async()=>{
  const h=harness();await h.$('openCodeGuide').onclick();
  assert.equal(h.$('codeGuideDialog').open,true);
  assert.deepEqual(h.requests,['code-guide.json']);
  assert.match(h.$('codeGuideArticle').innerHTML,/Arduino/);
  await h.copyButtons[0].onclick();assert.deepEqual(h.copies,['Serial.println(value);\n']);
  h.$('codeGuideArticle').click({target:{closest:()=>({dataset:{guidePage:'fsr',guideAnchor:''}})},preventDefault(){}});
  assert.equal(h.$('codeGuidePage').value,'fsr');assert.match(h.$('codeGuideArticle').innerHTML,/GPIO1/);
  h.$('codeGuideHome').onclick();assert.equal(h.$('codeGuidePage').value,'code');
  h.$('codeGuideClose').onclick();assert.equal(h.$('codeGuideDialog').open,false);
  await h.$('openCodeGuide').onclick();assert.equal(h.requests.length,1);
});

test('failed load can retry and denied clipboard access leaves manual copy instructions',async()=>{
  const h=harness();h.fail=true;await h.$('openCodeGuide').onclick();
  assert.match(h.$('codeGuideStatus').textContent,/열지 못했습니다/);
  h.$('codeGuideClose').onclick();h.fail=false;await h.$('openCodeGuide').onclick();
  assert.equal(h.requests.length,2);assert.match(h.$('codeGuideArticle').innerHTML,/Arduino/);
  h.clipboardFail=true;await h.copyButtons[0].onclick();
  assert.match(h.$('codeGuideStatus').textContent,/Ctrl\+C/);
});
