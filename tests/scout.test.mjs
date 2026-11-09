import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EVENTS} from '../fringe.js';
import {TOURS} from '../stories.js';
import {storyAreas,createArrivalTracker,moveScout,distanceKm,normalizeLongitude} from '../scout-core.js';
const zone={id:'one',lat:0,lon:0,radiusKm:10},at=km=>({lat:km/111.195,lon:0});
test('ten documented navigation areas use half the configured extent and existing text',()=>{
 const areas=storyAreas(EVENTS,TOURS);assert.equal(areas.length,10);
 for(const a of areas){assert.equal(a.radiusKm,a.extentKm/2);assert.equal(a.intro,TOURS[a.id][0]);}
 assert.equal(storyAreas([{id:'unknown'}],TOURS).length,0);
});
test('arrival requires 600 uninterrupted milliseconds and fires once per session',()=>{
 const t=createArrivalTracker([zone]);assert.equal(t.update(at(0),0),null);assert.equal(t.update(at(0),599),null);assert.equal(t.update(at(0),600),zone);assert.equal(t.update(at(0),700),null);
 t.update(at(13),800);assert.equal(t.current,null);t.update(at(0),900);assert.equal(t.update(at(0),1600),null);
 assert.equal(createArrivalTracker([zone]).seen.size,0);
});
test('boundary hysteresis retains the location until beyond 120 percent',()=>{
 const t=createArrivalTracker([zone]);t.update(at(0),0);t.update(at(0),600);t.update(at(11),700);assert.equal(t.current,zone);t.update(at(11.99),800);assert.equal(t.current,zone);t.update(at(12.01),900);assert.equal(t.current,null);
});
test('leaving before dwell, suspension and relocation reset the timer without losing discoveries',()=>{
 const t=createArrivalTracker([zone]);t.update(at(0),0);t.update(at(11),500);t.update(at(0),1000);assert.equal(t.update(at(0),1500),null);t.reset();assert.equal(t.update(at(0),1600),null);assert.equal(t.update(at(0),2200),zone);t.reset({exit:true});assert.equal(t.current,null);assert.ok(t.seen.has('one'));
});
test('manual replay suppresses subsequent automatic introduction; nearest stories work outside zones',()=>{
 const t=createArrivalTracker([zone]);t.replay('one');t.update(at(0),0);assert.equal(t.update(at(0),700),null);assert.equal(t.current,zone);assert.equal(t.nearest(at(100))[0].id,'one');assert.ok(t.nearest(at(100))[0].distance>99);
});
test('movement is frame-rate bounded, diagonal normalized and target arrival does not overshoot',()=>{
 const p={lat:0,lon:0},right=moveScout(p,{x:1,zoom:7,dt:50}),diagonal=moveScout(p,{x:1,y:1,zoom:7,dt:50});assert.ok(Math.abs(distanceKm(p,right)-distanceKm(p,diagonal))<.0001);assert.deepEqual(moveScout(p,{x:1,zoom:7,dt:5000}),right);
 const target={lat:0,lon:.0001},next=moveScout(p,{target,zoom:7,dt:50});assert.equal(next.arrived,true);assert.ok(Math.abs(next.lon-target.lon)<1e-10);
});
test('movement follows the shortest world wrap and stays within Mercator latitude limits',()=>{
 const n=moveScout({lat:0,lon:179.999},{target:{lat:0,lon:-179.9},zoom:7,dt:50});assert.ok(n.lon<0);assert.ok(n.heading>0);assert.equal(normalizeLongitude(540),-180);
 for(const lat of [-85.06,85.06]){const n=moveScout({lat,lon:0},{y:Math.sign(-lat),zoom:2,dt:5000});assert.ok(Math.abs(n.lat)<=85.06);assert.ok(Number.isFinite(n.lon));}
});
test('only the full explorer owns a Leaflet map; briefing handoff has no map runtime',async()=>{
 const [app,briefing,html,scout]=await Promise.all(['app.js','mission-controller.js','mission.html','scout-controller.js'].map(p=>readFile(new URL('../'+p,import.meta.url),'utf8')));
 assert.equal((app.match(/L\.map\(/g)||[]).length,1);assert.doesNotMatch(briefing,/L\.map\(/);assert.doesNotMatch(html,/<(?:div|canvas)[^>]*id="map"|vendor\/leaflet/);assert.doesNotMatch(scout,/L\.map\(/);
 assert.match(briefing,/onExplore\(selection\)/);assert.match(app,/initialHash==="game"/);
});
