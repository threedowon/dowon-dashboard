import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {PDFDocument,PDFName,PDFArray,PageSizes} from 'pdf-lib';

const temp=await mkdtemp(join(tmpdir(),'hardware-export-test-'));
await build({entryPoints:['hardware/lib/purchase-export.ts','hardware/lib/export-pdf.ts','hardware/lib/purchase-sites.ts'],outdir:temp,bundle:true,platform:'node',format:'cjs',outExtension:{'.js':'.cjs'},logLevel:'silent'});
const require=createRequire(import.meta.url);
const {createPurchaseCsv,purchaseRows}=require(join(temp,'purchase-export.cjs'));
const {createWorkbookPdf}=require(join(temp,'export-pdf.cjs'));
const {purchaseSite,groupPurchasesBySite,purchaseFilename}=require(join(temp,'purchase-sites.cjs'));
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
test('purchase sites use the actual hostname, including regional and shared links',()=>{
 for(const host of ['aliexpress.com','ko.aliexpress.com','www.aliexpress.us','a.aliexpress.com'])assert.equal(purchaseSite('https://'+host+'/item/1').id,'aliexpress');
 for(const host of ['www.coupang.com','m.coupang.com','link.coupang.com'])assert.equal(purchaseSite('https://'+host+'/a/1').id,'coupang');
 assert.equal(purchaseSite(' HTTPS://KO.ALIEXPRESS.COM./item/1 ').id,'aliexpress');
 for(const url of ['https://coupang.com.evil.example/','https://fakealiexpress.com/','https://coupang.com@other.example/','https://other.example/?url=https://aliexpress.com'])assert.ok(purchaseSite(url).id.startsWith('domain:'));
 assert.equal(purchaseSite('https://www.example.com/item').id,purchaseSite('https://example.com/other').id);
 assert.equal(purchaseSite(' ').id,'missing');
 for(const url of ['broken link','javascript:alert(1)','ftp://coupang.com/item'])assert.equal(purchaseSite(url).id,'invalid');
});
test('site exports partition every item once, preserving order, quantities and CSV fields',()=>{
 const items=[{...input.items[0],link:'https://ko.aliexpress.com/item/1'},{...input.items[1],link:'https://www.coupang.com/vp/products/2'},{...input.items[0],id:'c',link:'https://a.aliexpress.com/share'},{...input.items[1],id:'d',link:''},{...input.items[1],id:'e',link:'invalid'}];
 const groups=groupPurchasesBySite(items);
 assert.deepEqual(groups.map(g=>[g.id,g.items.map(i=>i.id)]),[['aliexpress',['a','c']],['coupang',['b']],['missing',['d']],['invalid',['e']]]);
 assert.equal(groups.flatMap(g=>g.items).length,items.length);
 assert.deepEqual(groupPurchasesBySite([]),[]);
 const ali={...input,items:groups[0].items};assert.deepEqual(purchaseRows(ali).map(r=>r.quantity),[5,0]);
 const csv=createPurchaseCsv(ali);assert.ok(csv.includes(items[0].link));assert.ok(csv.includes(items[2].link));assert.ok(!csv.includes(items[1].link));assert.ok(csv.includes('"빨강, 5m\nUSB-C","5"'));
 assert.equal(purchaseFilename(input.date,'csv',groups[0]),'비품-구매-신청-목록-알리익스프레스-2026-11-22.csv');
 assert.equal(purchaseFilename(input.date,'pdf'),'비품-구매-신청-목록-2026-11-22.pdf');
 assert.ok(!/[<>:"/\\|?*]/.test(purchaseFilename(input.date,'csv',{id:'x',label:'[::1]/bad:name'})));
});
test('site PDF contains links only for the selected store',async()=>{
 const items=[{...input.items[0],link:'https://ko.aliexpress.com/item/1'},{...input.items[1],link:'https://www.coupang.com/vp/products/2'}];
 for(const site of groupPurchasesBySite(items)){
  const doc=await PDFDocument.load(await createWorkbookPdf({...input,items:site.items},font));
  const annotations=doc.getPage(0).node.lookup(PDFName.of('Annots'));
  assert.equal(annotations.size(),1);
  assert.equal(annotations.lookup(0).lookup(PDFName.of('A')).lookup(PDFName.of('URI')).decodeText(),site.items[0].link);
 }
});
test('PDF follows landscape A4 template, preserves links, and handles overflowing rows',async()=>{
 const items=Array.from({length:30},(_,i)=>({...input.items[0],id:'a'+i,name:'품목 '+i,detail:i===3?'긴 옵션 설명 '.repeat(600):'옵션'}));
 const doc=await PDFDocument.load(await createWorkbookPdf({...input,items},font));assert.ok(doc.getPageCount()>2);
 for(const page of doc.getPages()){assert.deepEqual(page.getSize(),{width:PageSizes.A4[1],height:PageSizes.A4[0]});const annotations=page.node.lookup(PDFName.of('Annots'));if(annotations instanceof PDFArray)for(let i=0;i<annotations.size();i++){const rect=annotations.lookup(i).lookup(PDFName.of('Rect'));assert.ok(rect.lookup(1).asNumber()>=54);}}
 const simple=await PDFDocument.load(await createWorkbookPdf(input,font));assert.equal(simple.getPageCount(),1);assert.equal(simple.getPage(0).node.lookup(PDFName.of('Annots')).size(),1);
 const empty=await PDFDocument.load(await createWorkbookPdf({...input,items:[]},font));assert.equal(empty.getPageCount(),1);
});
test.after(()=>rm(temp,{recursive:true,force:true}));
