export type PurchaseItem={id:string;name:string;detail:string;link:string};
export type PurchaseInput={items:PurchaseItem[];people:{id:string;name:string}[];quantities:Record<string,number>;filter:string;date:string;projectName?:string;customsNumber?:string};
export function purchaseRows(input:PurchaseInput){return input.items.map(item=>({name:item.name,link:item.link,option:item.detail,quantity:input.people.reduce((sum,p)=>sum+(input.quantities[p.id+':'+item.id]||0),0)}));}
export function createPurchaseCsv(input:PurchaseInput){
 const rows:(string|number)[][]=[['비품 구매 신청 목록','','',''],['프로젝트명',input.projectName||'','개인통관번호',input.customsNumber||''],['','','',''],['품명','링크','옵션','수량'],...purchaseRows(input).map(r=>[r.name,r.link,r.option,r.quantity])];
 const cell=(v:string|number)=>'"'+String(v).replace(/^[\s]*[=+@-]/,m=>"'"+m).replaceAll('"','""')+'"';
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
