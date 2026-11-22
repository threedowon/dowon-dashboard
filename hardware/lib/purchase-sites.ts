export type PurchaseSite={id:string;label:string};

export function purchaseSite(link:string):PurchaseSite{
 const value=link.trim();
 if(!value)return {id:'missing',label:'링크 없음'};
 try{
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol))throw Error('Unsupported link');
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  const matches=(domain:string)=>host===domain||host.endsWith('.'+domain);
  if(matches('aliexpress.com')||matches('aliexpress.us'))return {id:'aliexpress',label:'알리익스프레스'};
  if(matches('coupang.com'))return {id:'coupang',label:'쿠팡'};
  const domain=host.replace(/^www\./,'');
  return {id:'domain:'+domain,label:domain};
 }catch{return {id:'invalid',label:'링크 확인 필요'}}
}

export function groupPurchasesBySite<T extends {link:string}>(items:T[]){
 const groups=new Map<string,PurchaseSite&{items:T[]}>();
 for(const item of items){
  const site=purchaseSite(item.link);
  if(!groups.has(site.id))groups.set(site.id,{...site,items:[]});
  groups.get(site.id)!.items.push(item);
 }
 return [...groups.values()];
}

export function purchaseFilename(date:string,format:'csv'|'pdf'){
 return '비품-구매-신청-목록-'+date+'.'+format;
}
