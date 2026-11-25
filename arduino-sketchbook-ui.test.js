import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./assets/arduino-sketchbook.js',import.meta.url),'utf8');
const highlighter=source.slice(source.indexOf('  function highlight('),source.indexOf('  function render()'));
function highlight(text){
 const nodes=[],context={document:{createTextNode:text=>({tag:'text',text})},element:(tag,text,className)=>({tag,text,className})};
 vm.createContext(context);vm.runInContext(highlighter,context);context.highlight(text,{append:node=>nodes.push(node)});return nodes;
}
test('syntax colors preserve exact source including HTML, Unicode, tabs and CRLF',()=>{
 const samples=['#include <Arduino.h>\r\n\tconst int pin = 4;\r\n','// 한글 <script>alert(1)</script>\nconst char* s = "<img src=x onerror=alert(1)>";\n','/* multi\nline */\nSerial.print("{\\\"raw\\\":");\n',''];
 for(const text of samples){const nodes=highlight(text);assert.equal(nodes.map(n=>n.text).join(''),text);assert.ok(nodes.every(n=>n.tag==='text'||n.tag==='span'));}
});
test('strings and comments stay whole instead of coloring their keywords as code',()=>{
 const nodes=highlight('// int 12\nconst char* s = "void 42";\n/* float\n123 */\nint value = 7;');
 const colored=nodes.filter(n=>n.className);
 assert.ok(colored.some(n=>n.className==='sketch-token-comment'&&n.text==='// int 12'));
 assert.ok(colored.some(n=>n.className==='sketch-token-string'&&n.text==='"void 42"'));
 assert.ok(colored.some(n=>n.className==='sketch-token-comment'&&n.text==='/* float\n123 */'));
 assert.ok(colored.some(n=>n.className==='sketch-token-number'&&n.text==='7'));
});

test('copy and download use the active file exactly and edit opens the selected sketch',async()=>{
 const files=[{name:'src/main.cpp',code:'void setup() {}\n'},{name:'platformio.ini',code:'[env:test]\n; <img onerror=1>\n'}],doc={id:'fsr',title:'Test',board:'ESP32',description:'',files};
 const ids=new Map();let copied,downloadBlob,downloadName,edited;
 function element(tag,text='',className=''){return {tag,textContent:text,className,children:[],append(...items){this.children.push(...items);for(const item of items)if(item.id)ids.set(item.id,item);},replaceChildren(){this.children=[];},setAttribute(){},focus(){},click(){downloadName=this.download;}};}
 ids.set('sketchDetail',element('div'));
 const context={documents:new Map([['fsr',doc]]),selectedId:'fsr',selectedFiles:new Map([['fsr','platformio.ini']]),loading:false,$:id=>ids.get(id),element,button:(text,fn)=>Object.assign(element('button',text),{onclick:fn}),openEditor:d=>edited=d,navigator:{clipboard:{writeText:async text=>copied=text}},document:{createTextNode:text=>element('text',text)},URL:{createObjectURL:blob=>{downloadBlob=blob;return 'blob:test';},revokeObjectURL(){}},Blob,setTimeout(){}};
 vm.createContext(context);const detail=source.slice(source.indexOf('  function renderDetail()'),source.indexOf('  async function load()'));vm.runInContext(highlighter+detail,context);context.renderDetail();
 await ids.get('sketchCopy').onclick();assert.equal(copied,files[1].code);ids.get('sketchDownload').onclick();assert.equal(downloadName,'platformio.ini');assert.equal(await downloadBlob.text(),files[1].code);ids.get('sketchEdit').onclick();assert.equal(edited,doc);
});
