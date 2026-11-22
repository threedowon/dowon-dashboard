import {PDFDocument,PDFPage,PDFString,PageSizes,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {purchaseSections,type PurchaseInput} from './purchase-export';
export type PdfInput=PurchaseInput;
export async function createWorkbookPdf(input:PdfInput,fontBytes:Uint8Array){
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const font=await doc.embedFont(fontBytes,{subset:false});
 doc.setTitle('비품 구매 신청 목록');doc.setAuthor('Hardware Sheet');doc.setLanguage('ko-KR');
 const supported=new Set(font.getCharacterSet());
 const clean=(s:string)=>Array.from(String(s).replace(/\r\n?/g,'\n')).map(c=>c==='\n'||supported.has(c.codePointAt(0)!)?c:'?').join('');
 const color=(hex:number)=>rgb((hex>>16&255)/255,(hex>>8&255)/255,(hex&255)/255);
 const navy=color(0x1E3A8A),blue=color(0x2563EB),ink=color(0x243246),line=color(0xD6DDE6),pale=color(0xEDF2FA),white=rgb(1,1,1);
 const [pageHeight,pageWidth]=PageSizes.A4;
 const left=42,width=pageWidth-left*2,bottom=40,lineHeight=13,padding=6;
 const widths=[150,44,width-392,58,140],xs=[left,left+150,left+194,left+width-198,left+width-140];
 const text=(p:PDFPage,s:string,x:number,y:number,size=10,fill=ink)=>p.drawText(clean(s),{x,y,size,font,color:fill});
 const wrap=(s:string,w:number,size=10)=>{const lines:string[]=[];for(const para of clean(s).split('\n')){let current='';for(const c of Array.from(para)){if(current&&font.widthOfTextAtSize(current+c,size)>w){lines.push(current);current=c}else current+=c}lines.push(current)}return lines};
 const box=(p:PDFPage,x:number,top:number,w:number,h:number,fill=white)=>p.drawRectangle({x,y:top-h,width:w,height:h,color:fill,borderColor:line,borderWidth:.4});
 let page:PDFPage,y=0,contentTop=0;
 const newPage=()=>{
  page=doc.addPage([pageWidth,pageHeight]);const title='비품 구매 신청 목록';
  text(page,title,(pageWidth-font.widthOfTextAtSize(title,21))/2,pageHeight-49,21,navy);
  const metaWidths=[76,width/2-76,90,width/2-90],values=['프로젝트명',input.projectName||'','개인통관번호',input.customsNumber||''];
  const lines=values.map((v,i)=>wrap(v,metaWidths[i]-14)),h=Math.max(27,...lines.map(l=>l.length*lineHeight+14));let x=left;y=pageHeight-71;
  for(let i=0;i<4;i++){box(page,x,y,metaWidths[i],h,i%2===0?pale:white);lines[i].forEach((l,n)=>text(page,l,x+7,y-17-n*lineHeight));x+=metaWidths[i]}
  y-=h+13;contentTop=y;
 };
 const sections=purchaseSections(input);
 newPage();
 if(!sections.length){box(page!,left,y,width,36);text(page!,'선택한 조건에서 신청 수량이 1개 이상인 품목이 없습니다.',left+7,y-23);}
 for(const [sectionIndex,section] of sections.entries()){
  const sectionColor=section.id==='aliexpress'?color(0xB85C18):section.id==='coupang'?color(0x2267A6):navy;
  const sectionLines=(continued:boolean)=>wrap(section.label+' '+section.items.length+'개 품목'+(continued?' (계속)':''),width-14,12);
  const sectionHeight=(continued:boolean)=>Math.max(26,sectionLines(continued).length*16+10)+19;
  const heading=(continued:boolean)=>{
   const lines=sectionLines(continued),h=sectionHeight(continued)-19;
   box(page!,left,y,width,h,sectionColor);lines.forEach((l,n)=>text(page!,l,left+7,y-18-n*16,12,white));y-=h;
   for(const [i,label] of ['품명','링크','옵션','필요 수량','주문 수량'].entries()){
    box(page!,xs[i],y,widths[i],19,navy);text(page!,label,xs[i]+(widths[i]-font.widthOfTextAtSize(label,10))/2,y-13,10,white);
   }
   y-=19;
  };
  const nextPage=()=>{newPage();heading(true)};
  if(sectionIndex)y-=12;
  const first=section.items[0],firstHeight=Math.max(wrap(first.name,widths[0]-14).length,wrap(first.option,widths[2]-14).length,wrap(first.orderText,widths[4]-14).length)*lineHeight+padding;
  const rowAreaHeight=contentTop-sectionHeight(true)-bottom;
  // Keep a section title with its first row; exceptionally tall rows may span pages.
  if(y-bottom<sectionHeight(false)+Math.min(firstHeight,rowAreaHeight))newPage();
  heading(false);
  for(const [index,row] of section.items.entries()){
   const names=wrap(row.name,widths[0]-14),options=wrap(row.option,widths[2]-14),orders=wrap(row.orderText,widths[4]-14);let offset=0;
   const length=Math.max(names.length,options.length,orders.length);
   while(offset<length){
    const remaining=length-offset,fullHeight=remaining*lineHeight+padding;
    if(y-bottom<lineHeight+padding||(fullHeight>y-bottom&&fullHeight<=rowAreaHeight))nextPage();
    const capacity=Math.max(1,Math.floor((y-bottom-padding)/lineHeight)),take=Math.min(remaining,capacity),height=take*lineHeight+padding;
    box(page!,left,y,width,height,index%2===0?color(0xF8FAFC):white);
    names.slice(offset,offset+take).forEach((l,n)=>text(page!,l,left+7,y-13-n*lineHeight));
    options.slice(offset,offset+take).forEach((l,n)=>text(page!,l,xs[2]+7,y-13-n*lineHeight));
    orders.slice(offset,offset+take).forEach((l,n)=>text(page!,l,xs[4]+7,y-13-n*lineHeight));
    if(offset===0){
     const quantity=String(row.quantity);text(page!,quantity,xs[3]+(widths[3]-font.widthOfTextAtSize(quantity,10))/2,y-13);
     if(/^https?:\/\//i.test(row.link)){
      const label='링크',w=font.widthOfTextAtSize(label,10),lx=xs[1]+(widths[1]-w)/2,ly=y-13;
      text(page!,label,lx,ly,10,blue);page!.drawLine({start:{x:lx,y:ly-2},end:{x:lx+w,y:ly-2},thickness:.5,color:blue});
      page!.node.addAnnot(doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[lx,ly-3,lx+w,ly+10],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(row.link)}})));
     }
    }
    y-=height;offset+=take;if(offset<length)nextPage();
   }
  }
 }
 const pages=doc.getPages();pages.forEach((p,n)=>{
  text(p,input.date+' · 다운로드 시점의 전체 신청자 수량',left,21,8,color(0x667085));
  text(p,`${n+1} / ${pages.length}`,pageWidth-left-33,21,8,color(0x667085));
 });
 return doc.save();
}
