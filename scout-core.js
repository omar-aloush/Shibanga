// Navigation areas describe where to introduce a story, never radar footprints.
export const normalizeLongitude = lon => ((lon + 180) % 360 + 360) % 360 - 180;
export const clampLatitude = lat => Math.max(-85.06, Math.min(85.06, lat));
export function distanceKm(a,b) {
 const r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlon=normalizeLongitude(b.lon-a.lon)*r;
 const h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2;
 return 12742*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function storyAreas(sites,tours) {return sites.filter(s=>tours[s.id]?.[0]).map(s=>({...s,radiusKm:s.extentKm/2,intro:tours[s.id][0]}));}
export function createArrivalTracker(areas) {
 const seen=new Set();let current=null,candidate=null,since=null;
 return {
  get current(){return current;},get seen(){return new Set(seen);},
  reset({exit=false}={}){candidate=null;since=null;if(exit)current=null;},
  replay(id){seen.add(id);},
  nearest(p,count=3){return areas.map(a=>({...a,distance:distanceKm(p,a)})).sort((a,b)=>a.distance-b.distance).slice(0,count);},
  update(p,time){
   if(current&&distanceKm(p,current)>current.radiusKm*1.2)current=null;
   const zone=current||areas.filter(a=>distanceKm(p,a)<=a.radiusKm).sort((a,b)=>distanceKm(p,a)-distanceKm(p,b))[0]||null;
   if(!zone){candidate=null;since=null;return null;}
   if(candidate!==zone.id){candidate=zone.id;since=time;}
   if(time-since<600)return null;
   current=zone;
   if(seen.has(zone.id))return null;seen.add(zone.id);return zone;
  }
 };
}
export function moveScout(position,{x=0,y=0,target=null,zoom=7,dt=16,speed=130}={}) {
 const size=256*2**zoom,project=p=>({x:(p.lon+180)/360*size,y:(1-Math.asinh(Math.tan(clampLatitude(p.lat)*Math.PI/180))/Math.PI)/2*size});
 const p=project(position),step=speed*Math.min(50,Math.max(0,dt))/1000;
 let length=Math.hypot(x,y),arrived=false;
 if(!length&&target){const q=project(target);x=((q.x-p.x+size/2)%size+size)%size-size/2;y=q.y-p.y;length=Math.hypot(x,y);if(length<=step)arrived=true;}
 if(!length)return {...position,moving:false,arrived:Boolean(target),heading:0};
 const amount=target&&arrived?length:step;p.x+=x/length*amount;p.y=Math.max(size*.00001,Math.min(size*.99999,p.y+y/length*amount));
 return {lat:clampLatitude(Math.atan(Math.sinh(Math.PI*(1-2*p.y/size)))*180/Math.PI),lon:normalizeLongitude(p.x/size*360-180),moving:true,arrived,heading:Math.atan2(x,-y)*180/Math.PI};
}
