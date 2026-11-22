import {PDFDocument,PDFPage,PDFString,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {purchaseRows,type PurchaseInput} from './purchase-export';
export type PdfInput=PurchaseInput;
export async function createWorkbookPdf(input:PdfInput,fontBytes:Uint8Array){
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const font=await doc.embedFont(fontBytes,{subset:false});
 doc.setTitle('비품 구매 신청 목록');doc.setAuthor('Hardware Sheet');doc.setLanguage('ko-KR');
 const supported=new Set(font.getCharacterSet());
 const clean=(s:string)=>Array.from(String(s).replace(/\r\n?/g,'\n')).map(c=>c==='\n'||supported.has(c.codePointAt(0)!)?c:'?').join('');
 const navy=rgb(30/255,58/255,138/255),blue=rgb(37/255,99/255,235/255),ink=rgb(.10,.10,.10),line=rgb(.8,.8,.8),pale=rgb(.94,.957,1),white=rgb(1,1,1);
 const widths=[210,100,324,50],left=54,bottom=54,lineHeight=14;
 const text=(p:PDFPage,s:string,x:number,y:number,size=10,color=ink)=>p.drawText(clean(s),{x,y,size,font,color});
 const wrap=(s:string,width:number,size=10)=>{const lines:string[]=[];for(const para of clean(s).split('\n')){let current='';for(const c of Array.from(para)){if(current&&font.widthOfTextAtSize(current+c,size)>width){lines.push(current);current=c}else current+=c}lines.push(current)}return lines};
 const box=(p:PDFPage,x:number,top:number,w:number,h:number,color=white)=>p.drawRectangle({x,y:top-h,width:w,height:h,color,borderColor:line,borderWidth:.5});
 let page:PDFPage,y=0;
 const heading=()=>{let x=left;for(const [i,label] of ['품명','링크','옵션','수량'].entries()){box(page,x,y,widths[i],28,navy);text(page,label,x+(widths[i]-font.widthOfTextAtSize(label,10))/2,y-18,10,white);x+=widths[i]}y-=28;};
 const newPage=()=>{page=doc.addPage([792,612]);const title='비품 구매 신청 목록';text(page,title,(792-font.widthOfTextAtSize(title,22))/2,550,22,navy);
  const metaWidths=[100,242,120,222],values=['프로젝트명',input.projectName||'','개인통관번호',input.customsNumber||''];const lines=values.map((v,i)=>wrap(v,metaWidths[i]-14));const h=Math.max(30,...lines.map(l=>l.length*14+12));let x=left;y=526;
  for(let i=0;i<4;i++){box(page,x,y,metaWidths[i],h,i%2===0?navy:pale);lines[i].forEach((l,n)=>text(page,l,x+7,y-17-n*14,10,i%2===0?white:ink));x+=metaWidths[i]}
  y-=h+18;heading();
 };
 newPage();
 const rows=purchaseRows(input);
 if(!rows.length){box(page!,left,y,684,36);text(page!,'선택한 조건에 해당하는 품목이 없습니다.',left+10,y-23);}
 for(let index=0;index<rows.length;index++){
  const row=rows[index],names=wrap(row.name,196),options=wrap(row.option,310);let offset=0;const length=Math.max(names.length,options.length);
  while(offset<length){
   const remaining=length-offset;const fullHeight=Math.max(28,remaining*lineHeight+12);
   // Keep ordinary rows together; split only rows taller than a whole page.
   if(y-bottom<28||(fullHeight>y-bottom&&fullHeight<=390))newPage();
   const capacity=Math.max(1,Math.floor((y-bottom-12)/lineHeight));const take=Math.min(remaining,capacity),height=Math.max(28,take*lineHeight+12);let x=left;
   widths.forEach(w=>{box(page!,x,y,w,height,index%2===0?rgb(.98,.98,.98):white);x+=w;});
   names.slice(offset,offset+take).forEach((l,n)=>text(page!,l,left+7,y-17-n*lineHeight));
   options.slice(offset,offset+take).forEach((l,n)=>text(page!,l,left+317,y-17-n*lineHeight));
   if(offset===0){const quantity=String(row.quantity);text(page!,quantity,left+634+(50-font.widthOfTextAtSize(quantity,10))/2,y-17);
    if(/^https?:\/\//i.test(row.link)){const label='링크',lx=left+210+(100-font.widthOfTextAtSize(label,10))/2,ly=y-17;text(page!,label,lx,ly,10,blue);const w=font.widthOfTextAtSize(label,10);page!.drawLine({start:{x:lx,y:ly-2},end:{x:lx+w,y:ly-2},thickness:.5,color:blue});page!.node.addAnnot(doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[lx,ly-3,lx+w,ly+12],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(row.link)}})));}
   }
   y-=height;offset+=take;if(offset<length)newPage();
  }
 }
 const pages=doc.getPages();pages.forEach((p,n)=>{text(p,input.date+' · 다운로드 시점의 전체 신청자 수량',left,29,8,rgb(.4,.4,.4));text(p,`${n+1} / ${pages.length}`,705,29,8,rgb(.4,.4,.4));});
 return doc.save();
}
