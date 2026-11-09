import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {containsRegion,createRegionResolver,createRegionTracker} from '../region-resolver.js';
import {regionalOverview,storyEntity,validateRegionalSummary,shortRegionalText,createRegionalStoryService} from '../region-stories.js';
const atlas=JSON.parse(readFileSync(new URL('../data/geography/atlas.json',import.meta.url)));
const resolve=createRegionResolver(atlas),paris=resolve({lat:48.86,lon:2.35});
const wiki=(q='Q90')=>({type:'standard',title:'Paris',wikibase_item:q,extract:'Paris is the capital of France. It stands on the Seine.',content_urls:{desktop:{page:'https://en.wikipedia.org/wiki/Paris'}}});
test('offline gazetteer covers thousands of actual regions with pinned public-domain provenance',()=>{
 assert.equal(atlas.layers.provinces.length,4589);assert.equal(atlas.layers.countries.length,258);assert.ok(atlas.layers.landscapes.length>1000);
 assert.equal(atlas.license,'Public domain');assert.match(atlas.revision,/^[a-f0-9]{40}$/);for(const f of atlas.files)assert.match(f.sha256,/^[a-f0-9]{64}$/);
});
test('the screenshot location resolves to Matrouh with desert context, independently of the Nile target',()=>{
 const c=resolve({lat:30.51,lon:27.85});assert.equal(c.province.name,'Matrouh');assert.equal(c.country.name,'Egypt');assert.equal(c.landscape.name,'Libyan Plateau');
 const story=regionalOverview(c);assert.equal(story.status,'ready');assert.match(story.text,/Western Desert/);assert.match(story.source.url,/science.nasa.gov/);
 assert.equal(resolve({lat:31.25,lon:31.44}).province.name,'Dakahlia');assert.equal(resolve({lat:30.04,lon:31.23}).province.name,'Cairo');
});
test('worldwide province and ocean identification do not fall back to the nearest featured mission',()=>{
 for(const [lat,lon,name]of [[48.86,2.35,'Paris'],[35.7,139.7,'Tokyo'],[35,-119,'California'],[-3,-60,'Amazonas'],[-33.86,151.21,'New South Wales']])assert.equal(resolve({lat,lon}).province.name,name);
 const sea=resolve({lat:32.7,lon:29.5});assert.equal(sea.primary.name,'Mediterranean Sea');assert.equal(sea.province,null);
 const ocean=resolve({lat:0,lon:-140});assert.equal(ocean.primary.name,'Pacific Ocean');assert.equal(ocean.country,null);
 assert.deepEqual(resolve({lat:0,lon:220}),ocean);assert.equal(resolve({lat:NaN,lon:0}),null);
});
test('polygon holes are excluded and split dateline polygons recognize either world copy',()=>{
 const r={polygons:[{bounds:[0,0,10,10],rings:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[4,4],[6,4],[6,6],[4,6],[4,4]]]}]};
 assert.equal(containsRegion(r,{lat:2,lon:2}),true);assert.equal(containsRegion(r,{lat:5,lon:5}),false);assert.equal(containsRegion(r,{lat:2,lon:0}),true);
 const wrapped={polygons:[{bounds:[175,-5,180,5],rings:[[[175,-5],[180,-5],[180,5],[175,5],[175,-5]]]},{bounds:[-180,-5,-175,5],rings:[[[-180,-5],[-175,-5],[-175,5],[-180,5],[-180,-5]]]}]};
 assert.equal(containsRegion(wrapped,{lat:0,lon:179}),true);assert.equal(containsRegion(wrapped,{lat:0,lon:181}),true);assert.equal(containsRegion(wrapped,{lat:0,lon:0}),false);
});
test('regional updates require stable dwell, ignore jitter, and reset after suspension or relocation',()=>{
 const west={id:'west'},east={id:'east'},t=createRegionTracker(p=>p.lon<0?west:east,{sampleMs:0});
 assert.equal(t.update({lon:-1},0),null);assert.equal(t.update({lon:-1},599),null);assert.equal(t.update({lon:-1},600),west);
 t.update({lon:1},700);t.update({lon:-1},900);assert.equal(t.update({lon:1},1000),null);assert.equal(t.update({lon:1},1600),east);
 t.reset({clear:true});assert.equal(t.current,null);t.update({lon:-1},1700);t.reset();assert.equal(t.update({lon:-1},2400),null);assert.equal(t.update({lon:-1},3000),west);
});
test('only an exact entity match and an HTTPS Wikipedia article can become a regional story',()=>{
 const entity=storyEntity(paris);assert.equal(entity.q,'Q90');assert.ok(validateRegionalSummary(wiki(),entity));
 assert.equal(validateRegionalSummary(wiki('Q1490'),entity),null);
 assert.equal(validateRegionalSummary({...wiki(),type:'disambiguation'},entity),null);
 for(const url of ['javascript:alert(1)','https://other.example/wiki/Paris','http://en.wikipedia.org/wiki/Paris'])assert.equal(validateRegionalSummary({...wiki(),content_urls:{desktop:{page:url}}},entity),null);
});
test('fetched stories retain attribution, stay bounded and reuse the cache without querying coordinates',async()=>{
 const urls=[],stored=new Map(),storage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)};
 const fetchImpl=async url=>{urls.push(url);return {ok:true,json:async()=>url.includes('wikidata')?{entities:{Q90:{sitelinks:{enwiki:{title:'Paris'}}}}}:wiki()};};
 const service=createRegionalStoryService({fetchImpl,storage});const first=await service.get(paris),second=await service.get(paris);assert.deepEqual(first,second);assert.equal(urls.length,2);assert.match(first.license.url,/by-sa\/4.0/);
 for(const url of urls){assert.doesNotMatch(url,/48\.86|2\.35|[?&](?:lat|lon|point)=/);}
 const restored=createRegionalStoryService({fetchImpl:()=>{throw Error('must be cached');},storage});assert.deepEqual(await restored.get(paris),first);
 const big=validateRegionalSummary({...wiki(),extract:Array(400).fill('word').join(' ')},storyEntity(paris));assert.equal(big.text.split(' ').length,170);
});
test('unavailable storage, missing English articles, aborts and network failures do not invent stories',async()=>{
 const storage={getItem(){throw Error('private');},setItem(){throw Error('private');}};
 const missing=createRegionalStoryService({storage,fetchImpl:async()=>({ok:true,json:async()=>({entities:{Q90:{sitelinks:{}}}})})});assert.equal((await missing.get(paris)).status,'overview');
 const offline=createRegionalStoryService({storage,fetchImpl:async()=>{throw Error('offline');}});await assert.rejects(offline.get(paris),/offline/);
 const abort=new AbortController();abort.abort();await assert.rejects(offline.get(paris,{signal:abort.signal}),{name:'AbortError'});
 const desert=resolve({lat:30.51,lon:27.85});assert.match((await offline.get(desert)).text,/groundwater/);
});
test('regional excerpts end cleanly and long stories remain available for explicit expansion',()=>{
 const text='First complete sentence. '+Array(100).fill('landscape').join(' ');const short=shortRegionalText(text,90);assert.ok(short.length<100);assert.ok(text.length>short.length);assert.equal(shortRegionalText('A short story.'),'A short story.');
});
