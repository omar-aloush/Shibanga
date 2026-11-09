const NE='https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-physical-labels/';
const NASA_DESERT='https://science.nasa.gov/earth/earth-observatory/cultivating-egypts-desert-89820/';

// Written from the linked source. These are regional context, never new radar findings.
const DESERT={
 'Western Desert':{title:'Water writes the desert’s story.',text:'Egypt’s Western Desert stretches west of the Nile. This hyper-arid part of the Sahara receives very little rain. Yet groundwater has supported oases, and irrigation projects have brought fields into parts of the desert. The story here is the relationship between scarce water, settlement, and a changing landscape.',question:'Look for the contrast between bare ground and cultivated patches. What would two dated images help you check?',source:{label:'NASA Earth Observatory',url:NASA_DESERT}},
};
const LAND_FORMS={
 Desert:['A landscape shaped by dry conditions.','Sparse rainfall leaves much of the ground exposed. Across deserts, wind and occasional runoff can reshape the surface. Follow the textures and drainage patterns here, then compare dated imagery before describing a change.'],
 'Range/mtn':['Follow the ridges and valleys.','A mountain range connects high ground, valleys, and the routes between them. Its shape records a long geological history. Look at how drainage and settlements relate to the terrain; a single image cannot establish how fast the ground is moving.'],
 Island:['Land with an ocean boundary.','An island brings land and water into close contact. Its coast connects habitats, settlements, and transport. Follow the shoreline and the interior landscape, then use dated observations to investigate any apparent change.'],
 'Island group':['A story spread across islands.','An island group joins separate pieces of land through the water between them. Follow the different coastlines and notice how the islands relate to one another before choosing a place for a closer comparison.'],
 Plateau:['Read the high ground.','A plateau is an extensive area of elevated ground. Its edges, river valleys, and settlements help tell the landscape’s story. Follow those shapes first; changes in elevation need appropriate measurements and a common reference.'],
 Delta:['Where a river meets standing water.','A delta forms where a river deposits sediment as it enters a lake or sea. Channels, farmland, wetlands, and settlements share a changing boundary between land and water. Compare compatible dates to ask how that boundary differs.'],
 Basin:['Follow the shape of the basin.','A basin gathers a landscape into a broad low area. Water, sediment, and human activity can connect places across it. Trace the rivers and the terrain before deciding which observation would help tell its story.'],
 Lake:['A landscape organized around water.','A lake and its shoreline connect the surrounding land with the water in its basin. Compare dated views of the same shore to investigate changes, keeping water level, season, and viewing conditions in mind.'],
};
export function regionalOverview(context) {
 const primary=context?.primary;
 if(!primary)return {title:'A new place to explore.',text:'Astrounit can keep exploring here. This point is outside the bundled regional outlines; use the map to inspect the landscape and nearby named places.',source:{label:'Regional map coverage',url:NE},status:'coverage'};
 if(context.country?.name==='Egypt'&&['Matrouh','New Valley'].includes(context.province?.name)&&['Western Desert','Libyan Plateau','Libyan Desert'].includes(context.landscape?.name))return {...DESERT['Western Desert'],status:'ready'};
 const physical=context.landscape||primary,form=LAND_FORMS[physical.kind];
 const location=[context.province?.name,context.country?.name].filter(Boolean);
 const where=location.length?`We are exploring ${[...new Set(location)].join(', ')}. `:'';
 if(form)return {title:primary.name,text:where+`The wider landscape includes ${physical.name}. `+form[1],question:form[0],source:{label:'Natural Earth · landscape context',url:NE},status:'overview'};
 if(context.water)return {title:primary.name,text:`We are exploring the ${primary.name}. This body of water connects coastlines with a much wider water system. Follow its shores and adjoining waters to understand the setting before looking for change.`,question:'What connects this water to the land around it?',source:{label:'Natural Earth · marine regions',url:NE},status:'overview'};
 const type=primary.kind&&primary.kind!=='Admin-0 country'?primary.kind.toLowerCase():'region';
 return {title:primary.name,text:`${where||`We are exploring ${primary.name}. `}This ${type} has its own geography and history. The regional story follows Astrounit as you move; use the source to explore the place in more depth.`,source:{label:'Natural Earth · region reference',url:'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/'},status:'overview'};
}
export function storyEntity(context) {
 for(const region of [context.primary,context.province,context.country]) {
  if(!region)continue;
  let title=null;
  try{const url=new URL(region.wiki);if(url.hostname==='en.wikipedia.org'&&url.pathname.startsWith('/wiki/'))title=decodeURIComponent(url.pathname.slice(6)).replaceAll('_',' ');}catch{}
  if(/^Q\d+$/.test(region.q||'')||title)return {q:/^Q\d+$/.test(region.q||'')?region.q:null,title,name:region.name};
 }
 return null;
}
export function validateRegionalSummary(summary,entity) {
 if(summary?.type!=='standard'||typeof summary.extract!=='string'||!summary.extract.trim()||typeof summary.title!=='string')return null;
 if(entity.q&&summary.wikibase_item!==entity.q)return null;
 const url=summary.content_urls?.desktop?.page;
 try{const source=new URL(url);if(source.protocol!=='https:'||source.hostname!=='en.wikipedia.org'||!source.pathname.startsWith('/wiki/'))return null;}catch{return null;}
 const text=summary.extract.replace(/\s+/g,' ').trim().split(' ').slice(0,170).join(' ');
 return {title:summary.title,text,source:{label:'Wikipedia contributors · excerpt',url},license:{label:'CC BY-SA 4.0',url:'https://creativecommons.org/licenses/by-sa/4.0/'},status:'ready'};
}
export function shortRegionalText(text,max=390) {
 if(text.length<=max)return text;
 const sample=text.slice(0,max),end=Math.max(sample.lastIndexOf('. '),sample.lastIndexOf('! '),sample.lastIndexOf('? '));
 return end>max*.4?sample.slice(0,end+1):sample.slice(0,sample.lastIndexOf(' '))+'…';
}

export function createRegionalStoryService({fetchImpl=globalThis.fetch,storage=null,now=()=>Date.now()}={}) {
 const key='fringe.region-stories.v1',ttl=30*86400000,cache=new Map();let nextRequest=0;
 try{for(const [id,value]of JSON.parse(storage?.getItem(key)||'[]')){
  const s=value?.story;if(value?.savedAt<=now()-ttl||typeof s?.title!=='string'||typeof s?.text!=='string')continue;
  const url=new URL(s.source?.url);if(url.protocol!=='https:'||url.hostname!=='en.wikipedia.org'||!url.pathname.startsWith('/wiki/'))continue;
  cache.set(id,{savedAt:value.savedAt,story:{title:s.title.slice(0,200),text:s.text.split(' ').slice(0,170).join(' '),source:{label:'Wikipedia contributors · excerpt',url:url.href},license:{label:'CC BY-SA 4.0',url:'https://creativecommons.org/licenses/by-sa/4.0/'},status:'ready'}});
 }}catch{}
 const save=()=>{try{storage?.setItem(key,JSON.stringify([...cache].slice(-80)));}catch{}};
 async function json(url,signal){const response=await fetchImpl(url,{signal,credentials:'omit',referrerPolicy:'origin'});if(!response.ok)throw Error('Regional story unavailable');return response.json();}
 return {
  async get(context,{signal}={}) {
   const local=regionalOverview(context);if(local.status==='ready'||local.status==='coverage')return local;
   const entity=storyEntity(context);if(!entity)return local;
   const id=entity.q||entity.title,cached=cache.get(id);
   if(cached?.savedAt>now()-ttl)return cached.story;
   const delay=Math.max(0,nextRequest-now());
   if(delay)await new Promise((resolve,reject)=>{const timer=setTimeout(done,delay);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));}if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});
   if(signal?.aborted)throw new DOMException('Aborted','AbortError');nextRequest=now()+1200;
   let title=entity.title;
   if(!title&&entity.q){const params=new URLSearchParams({action:'wbgetentities',ids:entity.q,props:'sitelinks',sitefilter:'enwiki',format:'json',origin:'*'});const result=await json('https://www.wikidata.org/w/api.php?'+params,signal);title=result.entities?.[entity.q]?.sitelinks?.enwiki?.title;}
   if(!title)return local;
   const summary=await json('https://en.wikipedia.org/api/rest_v1/page/summary/'+encodeURIComponent(title.replaceAll(' ','_')),signal),story=validateRegionalSummary(summary,entity);
   if(!story)return local;
   cache.set(id,{savedAt:now(),story});save();return story;
  }
 };
}
