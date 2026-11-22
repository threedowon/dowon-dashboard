import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {PDFDocument,PDFName,PDFArray} from 'pdf-lib';

const temp=await mkdtemp(join(tmpdir(),'hardware-export-test-'));
await build({entryPoints:['hardware/lib/purchase-export.ts','hardware/lib/export-pdf.ts'],outdir:temp,bundle:true,platform:'node',format:'cjs',outExtension:{'.js':'.cjs'},logLevel:'silent'});
const require=createRequire(import.meta.url);
const {createPurchaseCsv,purchaseRows}=require(join(temp,'purchase-export.cjs'));
const {createWorkbookPdf}=require(join(temp,'export-pdf.cjs'));
const font=new Uint8Array(await readFile(new URL('./hardware/fonts/Pretendard-Regular.ttf',import.meta.url)));
const input={items:[{id:'a',name:'테스트 부품',detail:'빨강, 5m\nUSB-C',link:'https://example.com/item'},{id:'b',name:'수량 없는 품목',detail:'',link:''}],people:[{id:'p',name:'신청자 1'},{id:'q',name:'신청자 2'}],quantities:{'p:a':2,'q:a':3,'other:a':900},projectName:'테스트 프로젝트',customsNumber:'',date:'2026-11-22',filter:'전체 품목 / 전체 구분'};
test('purchase export keeps filtered item order and sums all included people only',()=>{
 assert.deepEqual(purchaseRows(input).map(r=>r.quantity),[5,0]);
 assert.deepEqual(purchaseRows({...input,items:[input.items[1]]}).map(r=>r.name),['수량 없는 품목']);
 const csv=createPurchaseCsv(input);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"품명","링크","옵션","수량"'));
 assert.ok(csv.includes('"테스트 부품","https://example.com/item","빨강, 5m\nUSB-C","5"'));
 assert.ok(!csv.includes('신청자 1'));
});
test('CSV escapes quotes and neutralizes formulas including whitespace prefixes',()=>{
 const csv=createPurchaseCsv({...input,projectName:'=SUM(A1)',customsNumber:' @x',items:[{id:'a',name:'"quoted"',detail:'\t=1+1',link:'https://example.com/?q="'}]});
 assert.ok(csv.includes('"\'=SUM(A1)"'));assert.ok(csv.includes('"\' @x"'));assert.ok(csv.includes('"\'\t=1+1"'));assert.ok(csv.includes('""quoted""'));
});
test('PDF follows landscape template, preserves links, and handles overflowing rows',async()=>{
 const items=Array.from({length:30},(_,i)=>({...input.items[0],id:'a'+i,name:'품목 '+i,detail:i===3?'긴 옵션 설명 '.repeat(600):'옵션'}));
 const doc=await PDFDocument.load(await createWorkbookPdf({...input,items},font));assert.ok(doc.getPageCount()>2);
 for(const page of doc.getPages()){assert.deepEqual(page.getSize(),{width:792,height:612});const annotations=page.node.lookup(PDFName.of('Annots'));if(annotations instanceof PDFArray)for(let i=0;i<annotations.size();i++){const rect=annotations.lookup(i).lookup(PDFName.of('Rect'));assert.ok(rect.lookup(1).asNumber()>=54);}}
 const simple=await PDFDocument.load(await createWorkbookPdf(input,font));assert.equal(simple.getPageCount(),1);assert.equal(simple.getPage(0).node.lookup(PDFName.of('Annots')).size(),1);
 const empty=await PDFDocument.load(await createWorkbookPdf({...input,items:[]},font));assert.equal(empty.getPageCount(),1);
});
test.after(()=>rm(temp,{recursive:true,force:true}));
