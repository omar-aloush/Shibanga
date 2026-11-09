import {normalizeLongitude} from './scout-core.js?v=14.0';

// Generalized map regions, not measurement footprints or an address geocoder.
export function pointInRing(lon,lat,ring) {
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
  const [x,y]=ring[i],[a,b]=ring[j];
  const cross=(lon-a)*(y-b)-(lat-b)*(x-a);
  if(Math.abs(cross)<1e-9&&lon>=Math.min(x,a)-1e-9&&lon<=Math.max(x,a)+1e-9&&lat>=Math.min(y,b)-1e-9&&lat<=Math.max(y,b)+1e-9)return true;
  if((y>lat)!==(b>lat)&&lon<(a-x)*(lat-y)/(b-y)+x)inside=!inside;
 }
 return inside;
}
export function containsRegion(record,point) {
 const lon=normalizeLongitude(point.lon),lat=point.lat;
 return record.polygons.some(({bounds:[w,s,e,n],rings})=>lat>=s&&lat<=n&&
  [lon,lon+360,lon-360].some(x=>x>=w&&x<=e&&pointInRing(x,lat,rings[0])&&!rings.slice(1).some(h=>pointInRing(x,lat,h))));
}
const cell=(lon,lat)=>`${Math.floor((lon+180)/5)},${Math.floor((lat+90)/5)}`;
export function createRegionResolver(atlas) {
 const layers={};
 for(const [name,records]of Object.entries(atlas.layers)) {
  const grid=new Map();
  for(const record of records)for(const {bounds:[w,s,e,n]}of record.polygons) {
   for(let x=Math.floor((w+180)/5);x<=Math.floor((e+180)/5);x++)for(let y=Math.floor((s+90)/5);y<=Math.floor((n+90)/5);y++) {
    const key=`${x},${y}`;if(!grid.has(key))grid.set(key,new Set());grid.get(key).add(record);
   }
  }
  layers[name]=grid;
 }
 const countries=new Map(atlas.layers.countries.map(c=>[c.id,c]));
 const find=(name,p,exclude=()=>false)=>[...(layers[name]?.get(cell(p.lon,p.lat))||[])].filter(r=>!exclude(r)&&containsRegion(r,p)).sort((a,b)=>a.area-b.area)[0]||null;
 return point=>{
  const p={lat:point.lat,lon:normalizeLongitude(point.lon)};
  if(!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||Math.abs(p.lat)>90)return null;
  const province=find('provinces',p),country=province&&countries.get(province.countryCode)||find('countries',p);
  const lake=find('lakes',p),landscape=find('landscapes',p,r=>r.kind==='Continent');
  const water=!province&&!country&&!landscape?find('waters',p):null;
  const primary=lake||province||landscape||country||water;
  if(!primary)return {id:'earth:unmapped',name:'This part of Earth',label:'Regional map coverage',primary:null,province:null,country:null,landscape:null,water:null};
  const names=[primary.name,province?.name,country?.name].filter(Boolean);
  return {id:[primary.id,landscape?.id,province?.id,country?.id].filter(Boolean).join(':'),name:primary.name,
   label:[...new Set(names)].join(' · '),primary,province,country,landscape,water:lake||water};
 };
}

// Stable entry prevents boundary jitter; the current story changes with the
// astronaut's position, independently of the camera and selected radar dataset.
export function createRegionTracker(resolve,{dwellMs=600,sampleMs=220}={}) {
 let current=null,candidate=null,since=0,lastSample=-Infinity;
 return {
  get current(){return current;},
  reset({clear=false}={}){candidate=null;since=0;lastSample=-Infinity;if(clear)current=null;},
  update(position,time){
   if(time-lastSample<sampleMs)return null;lastSample=time;
   const next=resolve(position);if(!next)return null;
   if(next.id===current?.id){candidate=null;return null;}
   if(candidate?.id!==next.id){candidate=next;since=time;return null;}
   if(time-since<dwellMs)return null;
   current=candidate;candidate=null;return current;
  }
 };
}
