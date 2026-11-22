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
const {createPurchaseCsv,purchaseRows,purchaseSections}=require(join(temp,'purchase-export.cjs'));
const {createWorkbookPdf}=require(join(temp,'export-pdf.cjs'));
const {purchaseSite,groupPurchasesBySite,purchaseFilename}=require(join(temp,'purchase-sites.cjs'));
const font=new Uint8Array(await readFile(new URL('./hardware/fonts/Pretendard-Regular.ttf',import.meta.url)));
const input={items:[{id:'a',name:'테스트 부품',detail:'빨강, 5m\nUSB-C',link:'https://example.com/item'},{id:'b',name:'수량 없는 품목',detail:'',link:''}],people:[{id:'p',name:'신청자 1'},{id:'q',name:'신청자 2'}],quantities:{'p:a':2,'q:a':3,'other:a':900},projectName:'테스트 프로젝트',customsNumber:'',date:'2026-11-22',filter:'전체 품목 / 전체 구분'};
test('purchase export keeps filtered item order and sums all included people only',()=>{
 assert.deepEqual(purchaseRows(input).map(r=>r.quantity),[5,0]);
 assert.deepEqual(purchaseRows({...input,items:[input.items[1]]}).map(r=>r.name),['수량 없는 품목']);
 const csv=createPurchaseCsv(input);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"품명","링크","옵션","필요 수량","주문 수량"'));
 assert.ok(csv.includes('"테스트 부품","https://example.com/item","빨강, 5m\nUSB-C","5"'));
 assert.ok(!csv.includes('신청자 1'));
});
test('CSV escapes quotes and neutralizes formulas including whitespace prefixes',()=>{
 const csv=createPurchaseCsv({...input,projectName:'=SUM(A1)',customsNumber:' @x',items:[{id:'a',name:'"quoted"',detail:'\t=1+1',link:'https://example.com/?q="'}]});
 assert.ok(csv.includes('"\'=SUM(A1)"'));assert.ok(csv.includes('"\' @x"'));assert.ok(csv.includes('"\'\t=1+1"'));assert.ok(csv.includes('""quoted""'));
});
test('bundle export rounds the total across people, and keeps required and order quantities distinct',()=>{
 const bundled={...input,items:[{...input.items[0],packSize:3}]};
 const [row]=purchaseRows(bundled);
 assert.equal(row.quantity,5);assert.equal(row.orderQuantity,2);assert.equal(row.receivedQuantity,6);assert.equal(row.extraQuantity,1);
 const csv=createPurchaseCsv(bundled);
 assert.ok(csv.includes('"필요 수량","주문 수량"'));
 assert.ok(csv.includes('"5","2묶음\n3개입 · 총 6개\n여분 1개"'));
 const [shared]=purchaseRows({...bundled,quantities:{'p:a':1,'q:a':2}});
 assert.equal(shared.quantity,3);assert.equal(shared.orderQuantity,1,'sum demand before rounding, rather than round each person separately');
 assert.ok(createPurchaseCsv(input).includes('"5","5"'),'normal product uses the same requested and order counts');
 assert.deepEqual(purchaseSections({...bundled,quantities:{}}),[],'zero-quantity bundles stay excluded');
});
test('both exports omit zero and unset quantities, including sites with no requested items',async()=>{
 const items=[
  {...input.items[0],id:'a',name:'신청한 알리 품목',link:'https://aliexpress.com/item/a'},
  {...input.items[0],id:'zero',name:'0개 알리 품목',link:'https://aliexpress.com/item/zero'},
  {...input.items[0],id:'unset',name:'미신청 쿠팡 품목',link:'https://coupang.com/item/unset'},
 ];
 const mixed={...input,items,quantities:{...input.quantities,'p:zero':0,'q:zero':0,'other:unset':20}};
 const sections=purchaseSections(mixed);
 assert.deepEqual(sections.map(s=>[s.label,s.items.length]),[['알리익스프레스',1]]);
 assert.equal(sections[0].items[0].quantity,5);
 const csv=createPurchaseCsv(mixed);
 assert.ok(csv.includes('신청한 알리 품목'));assert.ok(csv.includes('"알리익스프레스","1개 품목"'));
 assert.ok(!csv.includes('0개 알리 품목'));assert.ok(!csv.includes('미신청 쿠팡 품목'));assert.ok(!csv.includes('쿠팡'));
 const pdf=await PDFDocument.load(await createWorkbookPdf(mixed,font));
 const annotations=pdf.getPage(0).node.lookup(PDFName.of('Annots'));
 assert.equal(annotations.size(),1);
 assert.equal(annotations.lookup(0).lookup(PDFName.of('A')).lookup(PDFName.of('URI')).decodeText(),items[0].link);
 for(const empty of [{...mixed,quantities:{}},{...mixed,people:[]},{...mixed,items:items.slice(1)}]){
  assert.deepEqual(purchaseSections(empty),[]);
  const csv=createPurchaseCsv(empty);assert.ok(csv.includes('신청 수량이 1개 이상인 품목이 없습니다.'));assert.ok(!csv.includes('알리익스프레스'));assert.ok(!csv.includes('쿠팡'));
  const doc=await PDFDocument.load(await createWorkbookPdf(empty,font));assert.equal(doc.getPageCount(),1);const annotations=doc.getPage(0).node.lookup(PDFName.of('Annots'));assert.equal(annotations instanceof PDFArray?annotations.size():0,0);
 }
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
 const ali={...input,items:groups[0].items,quantities:{...input.quantities,'p:c':1}};assert.deepEqual(purchaseRows(ali).map(r=>r.quantity),[5,1]);
 const csv=createPurchaseCsv(ali);assert.ok(csv.includes(items[0].link));assert.ok(csv.includes(items[2].link));assert.ok(!csv.includes(items[1].link));assert.ok(csv.includes('"빨강, 5m\nUSB-C","5"'));
 assert.equal(purchaseFilename(input.date,'csv'),'비품-구매-신청-목록-2026-11-22.csv');
 assert.equal(purchaseFilename(input.date,'pdf'),'비품-구매-신청-목록-2026-11-22.pdf');
});
test('one CSV contains separate site sections, repeated headers and blank separators',()=>{
 const items=[{...input.items[0],name:'알리 첫 품목',link:'https://ko.aliexpress.com/item/1'},{...input.items[1],name:'쿠팡 품목',link:'https://www.coupang.com/vp/products/2'},{...input.items[0],id:'c',name:'알리 둘째 품목',link:'https://a.aliexpress.com/share'},{...input.items[1],id:'d',name:'링크 없는 품목'}];
 const groupedInput={...input,items,quantities:{...input.quantities,'p:b':2,'p:c':1,'q:d':3}};
 const csv=createPurchaseCsv(groupedInput);
 assert.equal(csv.match(/"품명","링크","옵션","필요 수량","주문 수량"/g).length,3);
 assert.ok(csv.includes('"알리익스프레스","2개 품목","","",""\r\n"품명"'));
 assert.ok(csv.includes('"","","","",""\r\n"쿠팡","1개 품목","","",""'));
 assert.ok(csv.indexOf('알리 둘째 품목')<csv.indexOf('쿠팡 품목'));
 assert.ok(csv.includes('"링크 없음","1개 품목","","",""'));
 assert.equal(purchaseSections(groupedInput).flatMap(s=>s.items).length,4);
 const empty=createPurchaseCsv({...input,items:[]});assert.ok(empty.includes('신청 수량이 1개 이상인 품목이 없습니다.'));
});
test('one PDF contains every store and groups links in site order',async()=>{
 const items=[{...input.items[0],link:'https://ko.aliexpress.com/item/1'},{...input.items[1],link:'https://www.coupang.com/vp/products/2'},{...input.items[0],id:'c',link:'https://a.aliexpress.com/share'}];
 const doc=await PDFDocument.load(await createWorkbookPdf({...input,items,quantities:{...input.quantities,'p:b':2,'p:c':1}},font));
 assert.equal(doc.getPageCount(),1);
 const annotations=doc.getPage(0).node.lookup(PDFName.of('Annots'));
 assert.equal(annotations.size(),3);
 const links=Array.from({length:3},(_,i)=>annotations.lookup(i).lookup(PDFName.of('A')).lookup(PDFName.of('URI')).decodeText());
 assert.deepEqual(links,[items[0].link,items[2].link,items[1].link]);
});
test('PDF follows landscape A4 template, preserves links, and handles overflowing rows',async()=>{
 const items=Array.from({length:30},(_,i)=>({...input.items[0],id:'a'+i,name:'품목 '+i,detail:i===3?'긴 옵션 설명 '.repeat(600):'옵션'}));
 const doc=await PDFDocument.load(await createWorkbookPdf({...input,items,quantities:Object.fromEntries(items.map(i=>['p:'+i.id,1]))},font));assert.ok(doc.getPageCount()>2);
 let links=0;
 for(const page of doc.getPages()){assert.deepEqual(page.getSize(),{width:PageSizes.A4[1],height:PageSizes.A4[0]});const annotations=page.node.lookup(PDFName.of('Annots'));if(annotations instanceof PDFArray)for(let i=0;i<annotations.size();i++){const rect=annotations.lookup(i).lookup(PDFName.of('Rect'));assert.ok(rect.lookup(1).asNumber()>=40);links++;}}
 assert.equal(links,items.length,'every item keeps exactly one link even across page breaks');
 const simple=await PDFDocument.load(await createWorkbookPdf(input,font));assert.equal(simple.getPageCount(),1);assert.equal(simple.getPage(0).node.lookup(PDFName.of('Annots')).size(),1);
 const empty=await PDFDocument.load(await createWorkbookPdf({...input,items:[]},font));assert.equal(empty.getPageCount(),1);
});
test.after(()=>rm(temp,{recursive:true,force:true}));
