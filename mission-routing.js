// Keep mission links in the existing explorer, including place and acquisition context.
export const MISSION_VISIT_KEY = 'fringe.field-mission.visited.v1';
export function readMissionDestination(href, base) {
 let url, app;
 try {url=new URL(href,base);app=new URL('index.html',base);}catch{return null;}
 if(url.origin!==app.origin||![app.pathname,app.pathname.replace(/index\.html$/,'')].includes(url.pathname))return null;
 const hash=url.hash.slice(1),q=url.searchParams;
 const eventId=['nile-delta','central-valley','campi-flegrei','jakarta'].includes(hash)?hash:'nile-delta';
 const view=['investigate','lab','guide','events'].includes(hash)?hash:'map';
 const mode=['model','nisar','fields','photos'].includes(q.get('mode'))?q.get('mode'):'model';
 const frame=/^\d+$/.test(q.get('frame')||'')?Number(q.get('frame')):null;
 const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:undefined;
 return {view,eventId,mode,frame,sheet:q.get('sheet')==='1',story:q.get('story')===eventId?eventId:null,selection:{a:date(q.get('a')),b:date(q.get('b'))}};
}
export function shouldOpenMission({hash='',params=new URLSearchParams(),visited=false}={}) {
 return (!hash&&!visited&&params.get('welcome')!=='0'&&!['mode','story','live'].some(key=>params.has(key)));
}
