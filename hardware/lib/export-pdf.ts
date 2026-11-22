import {PDFDocument,PDFPage,PDFString,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
export type PdfItem={id:string;name:string;detail:string;group?:string;usage?:string;link:string;source?:string;image:string};
export type PdfInput={items:PdfItem[];people:{id:string;name:string}[];quantities:Record<string,number>;filter:string;date:string};
export async function createWorkbookPdf(input:PdfInput,fontBytes:Uint8Array){
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const font=await doc.embedFont(fontBytes,{subset:false});
 doc.setTitle('Hardware Sheet - 비품 구매 목록');doc.setAuthor('Hardware Sheet');doc.setLanguage('ko-KR');
 const supported=new Set(font.getCharacterSet());
 const clean=(s:string)=>Array.from(String(s)).map(c=>c==='\n'||supported.has(c.codePointAt(0)!)?c:'?').join('');
 const ink=rgb(.16,.23,.20),green=rgb(.10,.39,.26),muted=rgb(.39,.47,.42),line=rgb(.84,.89,.86);
 const text=(page:PDFPage,s:string,x:number,y:number,size=10,color=ink)=>page.drawText(clean(s),{x,y,size,font,color});
 const wrap=(s:string,width:number,size=10)=>{const lines:string[]=[];for(const para of clean(s).split('\n')){let current='';for(const c of Array.from(para)){if(current&&font.widthOfTextAtSize(current+c,size)>width){lines.push(current);current=c}else current+=c}lines.push(current)}return lines};
 const link=(page:PDFPage,label:string,url:string,x:number,y:number)=>{if(!/^https?:\/\//i.test(url))return;text(page,label,x,y,10,green);const width=font.widthOfTextAtSize(clean(label),10);page.drawLine({start:{x,y:y-2},end:{x:x+width,y:y-2},thickness:.5,color:green});page.node.addAnnot(doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[x,y-3,x+width,y+12],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(url)}})))};
 let page:PDFPage;let y=0;
 const newPage=()=>{page=doc.addPage([595.28,841.89]);page.drawRectangle({x:0,y:779,width:595.28,height:63,color:green});text(page,'Hardware Sheet',36,808,19,rgb(1,1,1));text(page,'비품 구매 목록',36,789,10,rgb(.85,.94,.88));text(page,input.date,432,807,9,rgb(1,1,1));y=754;const filters=wrap(input.filter+' · 전체 신청자 기준',520,9);for(const l of filters){text(page,l,36,y,9,muted);y-=13}y-=8};
 newPage();
 const total=input.items.reduce((s,i)=>s+input.people.reduce((n,p)=>n+(input.quantities[p.id+':'+i.id]||0),0),0);
 text(page!,`품목 ${input.items.length}종   |   신청자 ${input.people.length}명   |   신청 수량 ${total}개`,36,y,11);y-=27;
 if(!input.items.length)text(page!,'선택한 조건에 해당하는 품목이 없습니다.',36,y,11,muted);
 for(let index=0;index<input.items.length;index++){
  const i=input.items[index];const qty=input.people.reduce((s,p)=>s+(input.quantities[p.id+':'+i.id]||0),0);
  const names=input.people.filter(p=>(input.quantities[p.id+':'+i.id]||0)>0).map(p=>p.name+' '+input.quantities[p.id+':'+i.id]+'개').join(' / ')||'신청 내역 없음';
  const body=[...wrap(i.detail||'옵션 없음',435,10),...wrap('신청: '+names,435,9)];
  let offset=0;let first=true;
  while(first||offset<body.length){
   const titleLines=wrap(`${index+1}. ${i.name}${first?'':' (계속)'}`,420,12);
   const extra=(titleLines.length-1)*16;
   if(y<185+extra)newPage();
   const capacity=Math.max(1,Math.floor((y-55-87-extra)/14));const chunk=body.slice(offset,offset+capacity);const h=Math.max(112+extra,87+extra+chunk.length*14);
   page!.drawRectangle({x:36,y:y-h,width:523,height:h,color:rgb(.98,.99,.98),borderColor:line,borderWidth:.7});
   titleLines.forEach((l,n)=>text(page!,l,48,y-20-n*16,12));text(page!,`${qty}개`,508,y-20,12,green);
   text(page!,`${i.group||'분류 없음'} / ${i.usage||'개인'}`,48,y-37-extra,9,muted);
   let bx=48;
   if(first&&i.image){try{const bytes=Uint8Array.from(atob(i.image.split(',')[1]),c=>c.charCodeAt(0));const img=i.image.startsWith('data:image/jpeg')?await doc.embedJpg(bytes):await doc.embedPng(bytes);const dim=img.scaleToFit(55,55);page!.drawImage(img,{x:48+(55-dim.width)/2,y:y-103-extra+(55-dim.height)/2,width:dim.width,height:dim.height});bx=112}catch{/* Invalid legacy images leave the text and links available. */}}
   // Text is measured to leave space for a photo, including on continuation pages.
   let ty=y-55-extra;for(const l of chunk){text(page!,l,bx,ty,10);ty-=14}
   const ly=y-h+13;if(i.link)link(page!,'링크',i.link,48,ly);
   y-=h+12;offset+=chunk.length;first=false;
  }
 }
 const pages=doc.getPages();pages.forEach((p,n)=>{text(p,'Hardware Sheet · 구매 수량은 다운로드 시점 기준입니다.',36,25,8,muted);text(p,`${n+1} / ${pages.length}`,515,25,8,muted)});
 return doc.save();
}

