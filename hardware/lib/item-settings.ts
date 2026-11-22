export const GROUPS = ['공구','전선·커넥터','보드·모듈','전원·측정','소모품'] as const;
export const USAGES = ['개인','공용'] as const;
export type Group = typeof GROUPS[number];
export type Usage = typeof USAGES[number];
export function normalizeItem<T extends {name:string;detail?:string;group?:string;usage?:string}>(item:T):T & {group:Group;usage:Usage} {
 let group:Group;
 if(GROUPS.includes(item.group as Group)) group=item.group as Group;
 else if(/열수축|실납|케이블타이|절연테이프|플럭스/.test(item.name)) group='소모품';
 else if(/전선|점퍼선|커넥터|와고|단자/.test(item.name)&&!/압착기/.test(item.name)) group='전선·커넥터';
 else if(item.group==='측정·전원'||/전원공급|멀티미터/.test(item.name)) group='전원·측정';
 else if(item.group==='보드·시제품'||/보드|아두이노|센서|모듈/.test(item.name)) group='보드·모듈';
 else group='공구';
 const usage:Usage=USAGES.includes(item.usage as Usage)?item.usage as Usage:/공용/.test(item.detail||'')?'공용':'개인';
 return {...item,group,usage};
}
