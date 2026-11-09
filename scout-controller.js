import {storyAreas,createArrivalTracker,moveScout,normalizeLongitude} from './scout-core.js?v=14.0';
import {createRegionResolver,createRegionTracker} from './region-resolver.js?v=14.0';
import {regionalOverview,shortRegionalText,createRegionalStoryService} from './region-stories.js?v=14.0';

// One controller, attached to the explorer's Leaflet instance. No data selection on arrival.
export function initScout({map,sites,tours,canInteract,getSelectedEvent,getCapabilities,onTravel,onStory,onRadar,onCompare,onObserve,onLayout=()=>{}}) {
 const app=document.querySelector('#app'),toggle=document.querySelector('#btn-astrounit'),dock=document.querySelector('#dock');
 const panel=document.createElement('section');panel.className='scout-panel glass';panel.hidden=true;panel.setAttribute('aria-label','Astrounit field guide');
 panel.innerHTML=`<header class="scout-header"><span class="scout-avatar" aria-hidden="true"></span><div><b>Astrounit</b><span>PILOT MODE <span class="scout-coords" aria-live="off"></span></span></div><button data-off aria-label="Turn off Astrounit pilot mode">×</button></header><div class="scout-controls" role="group" aria-label="Astrounit navigation"><button data-walk aria-pressed="true">Walk</button><button data-inspect aria-pressed="false">Inspect</button><button data-follow aria-pressed="true">Following Astrounit</button></div><p class="scout-location" aria-live="off"></p><div class="scout-content"><div class="scout-joystick" role="group" aria-label="Touch movement"><button data-stick aria-label="Drag to move Astrounit"><span>✥</span></button></div><div class="scout-copy"><div class="scout-message" aria-live="polite" aria-atomic="true"></div><div class="scout-actions"></div><div class="scout-nearby"></div></div></div><p class="scout-help">WASD / arrows · tap to walk · discover the region around you</p>`;
 dock.insertBefore(panel,dock.firstChild);const $=s=>panel.querySelector(s),areas=storyAreas(sites,tours),tracker=createArrivalTracker(areas),keys=new Set(),listeners=[];
 let active=false,suspended=true,destroyed=false,position=null,target=null,following=true,tool='walk',stick={x:0,y:0},utterance=null,lastNearby=0,keyboardWasEnabled=false,lastFollow=0,lastCoords=0,needsFollow=false,wasMoving=false,nearbySignature='';
 let regionTracker=null,regionContext=null,regionStory=null,regionExpanded=false,regionLoading=null,regionError=false,atlasAbort=null,storyAbort=null,storyTimer=0,storyToken=0,storyStatus='';
 let storage=null;try{storage=localStorage;}catch{}
 const regionalStories=createRegionalStoryService({storage});
 const marker=L.marker([0,0],{interactive:false,keyboard:false,zIndexOffset:1200,icon:L.divIcon({className:'scout-map-marker',html:'<span class="scout-ground"></span><span class="scout-heading"></span><span class="scout-avatar"></span>',iconSize:[62,76],iconAnchor:[31,66]})});
 const listen=(el,event,fn,opts)=>{el.addEventListener(event,fn,opts);listeners.push(()=>el.removeEventListener(event,fn,opts));};
 const hush=()=>{if(utterance){window.speechSynthesis?.cancel();utterance=null;}};
 function stop(){wasMoving=false;keys.clear();target=null;stick={x:0,y:0};$('[data-stick] span').style.transform='';tracker.reset();regionTracker?.reset();}
 function setFollow(on){following=on;$('[data-follow]').textContent=on?'Following Astrounit':'Follow Astrounit';$('[data-follow]').setAttribute('aria-pressed',String(on));}
 function follow(force=false,time=performance.now()){
  if(!following||!position||(!force&&time-lastFollow<90))return;lastFollow=time;
  const container=map.getContainer().getBoundingClientRect(),r=dock.getBoundingClientRect(),size=map.getSize();
  const bottom=Math.max(120,Math.min(size.y-100,r.top-container.top-20)),top=Math.min(160,Math.max(140,bottom-45)),left=innerWidth>860?270:30,right=size.x-30;
  const p=map.latLngToContainerPoint(marker.getLatLng()),cx=(left+right)/2,cy=(top+bottom)/2;
  if(force||p.x<left+30||p.x>right-30||p.y<top+30||p.y>bottom-30)map.panBy([p.x-cx,p.y-cy],{animate:false});
 }
 function place(){if(!position)return;const center=map.getCenter().lng,lon=position.lon+360*Math.round((center-position.lon)/360);marker.setLatLng([position.lat,lon]);}
 function setPosition(site,{followCamera=false}={}){if(!site)return;position={lat:site.lat,lon:normalizeLongitude(site.lon-(site.extentKm/2*.35)/(111.32*Math.max(.1,Math.cos(site.lat*Math.PI/180))))};stop();hush();tracker.reset({exit:true});regionTracker?.reset({clear:true});regionContext=null;regionStory=null;cancelRegionalStory();place();if(active){renderIdle();if(followCamera)follow(true);}}
 function renderActions(area){const actions=$('.scout-actions');actions.replaceChildren();
  const button=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.addEventListener('click',fn);actions.append(b);};
  if(window.speechSynthesis&&window.SpeechSynthesisUtterance)button('Read aloud',()=>{hush();const u=new SpeechSynthesisUtterance(`${area.intro.title}. ${area.intro.text}`);u.lang='en-GB';utterance=u;u.onend=u.onerror=()=>{if(utterance===u)utterance=null;};speechSynthesis.speak(u);});
  button('Full story',()=>{stop();hush();onStory(area.id);});
  const capabilities=getCapabilities(area.id);if(capabilities.radar)button('View radar',()=>onRadar(area.id));if(capabilities.compare)button('Compare visits',()=>onCompare(area.id));
 }
 function cancelRegionalStory(){storyToken++;clearTimeout(storyTimer);storyAbort?.abort();storyAbort=null;storyStatus='';}
 function nearbyStories(){
  const node=$('.scout-nearby');node.replaceChildren();if(!position)return;
  const nearest=tracker.nearest(position);nearbySignature=nearest.map(a=>a.id).join(',');
  const details=document.createElement('details');details.className='scout-field-routes';const summary=document.createElement('summary');summary.textContent='Nearby field stories';details.append(summary);
  for(const a of nearest){const b=document.createElement('button');b.textContent=`${a.name} ↗`;b.title=`${Math.round(a.distance)} km away`;b.addEventListener('click',()=>onTravel(a.id));details.append(b);}node.append(details);
 }
 function renderRegionActions(){
  const actions=$('.scout-actions');actions.replaceChildren();if(!regionStory)return;
  const button=(label,fn)=>{const b=document.createElement('button');b.textContent=label;b.addEventListener('click',fn);actions.append(b);return b;};
  if(window.speechSynthesis&&window.SpeechSynthesisUtterance)button('Read aloud',()=>{if(utterance){hush();return;}const u=new SpeechSynthesisUtterance(`${regionContext.label}. ${regionStory.title}. ${regionStory.text}`);u.lang='en-GB';utterance=u;u.onend=u.onerror=()=>{if(utterance===u)utterance=null;};speechSynthesis.speak(u);});
  if(regionStory.text.length>390)button(regionExpanded?'Read less':'Read more',()=>{regionExpanded=!regionExpanded;renderRegion();});
  if(onObserve&&!regionContext.water)button('Find radar here',()=>{stop();hush();onObserve({...position});});
  const area=tracker.current;if(area){button(`Full story: ${area.name}`,()=>{stop();hush();onStory(area.id);});const capabilities=getCapabilities(area.id);if(capabilities.radar)button(`${area.name} radar`,()=>onRadar(area.id));if(capabilities.compare)button('Compare visits',()=>onCompare(area.id));}
  if(storyStatus==='unavailable')button('Retry regional story',()=>enrichRegion());
 }
 function renderRegion(){
  if(!regionContext||!regionStory)return;
  $('.scout-location').textContent=regionContext.label;
  const message=$('.scout-message');message.replaceChildren();
  const small=document.createElement('small');small.textContent='REGIONAL STORY';const h=document.createElement('h2');h.textContent=regionStory.title;const text=document.createElement('p');text.textContent=regionExpanded?regionStory.text:shortRegionalText(regionStory.text);message.append(small,h,text);
  if(regionStory.question){const question=document.createElement('p');question.className='scout-region-question';question.textContent=regionStory.question;message.append(question);}
  const source=document.createElement('p');source.className='scout-region-source';
  const link=document.createElement('a');link.textContent=regionStory.source.label;link.href=regionStory.source.url;link.target='_blank';link.rel='noopener noreferrer';source.append(link);
  if(regionStory.license){const license=document.createElement('a');license.textContent=regionStory.license.label;license.href=regionStory.license.url;license.target='_blank';license.rel='noopener noreferrer';source.append(' · ',license);}
  if(storyStatus==='loading')source.append(' · Opening regional story…');else if(storyStatus==='unavailable')source.append(' · Overview available; full story could not load.');
  message.append(source);renderRegionActions();nearbyStories();onLayout();
 }
 function enrichRegion(){
  if(!regionContext||suspended||destroyed)return;cancelRegionalStory();
  const token=storyToken,context=regionContext;storyStatus='loading';renderRegion();
  storyAbort=new AbortController();const request=storyAbort,timeout=setTimeout(()=>request.abort(),9000);
  regionalStories.get(context,{signal:request.signal}).then(story=>{
   if(destroyed||suspended||token!==storyToken||regionContext?.id!==context.id)return;
   regionStory=story;storyStatus=story.status==='ready'?'':'unavailable';renderRegion();
  }).catch(()=>{if(!destroyed&&!suspended&&token===storyToken){storyStatus='unavailable';renderRegion();}}).finally(()=>{clearTimeout(timeout);if(storyAbort===request)storyAbort=null;});
 }
 function enterRegion(context){
  cancelRegionalStory();hush();regionExpanded=false;regionContext=context;regionStory=regionalOverview(context);renderRegion();
  if(regionStory.status==='ready'||regionStory.status==='coverage')return;
  storyTimer=setTimeout(enrichRegion,700);
 }
 function loadRegions(){
  if(regionTracker||regionLoading||destroyed)return;regionError=false;atlasAbort=new AbortController();const request=atlasAbort;
  regionLoading=fetch('data/geography/atlas.json?v=14.0',{signal:request.signal}).then(r=>{if(!r.ok)throw Error('Region map unavailable');return r.json();}).then(atlas=>{
   if(destroyed)return;regionTracker=createRegionTracker(createRegionResolver(atlas));
  }).catch(()=>{if(!destroyed){regionError=true;if(active&&!suspended)renderIdle();}}).finally(()=>{regionLoading=null;if(atlasAbort===request)atlasAbort=null;});
 }
 function renderIdle(){
  if(regionContext){renderRegion();return;}
  const current=tracker.current;$('.scout-location').textContent=current?`${current.name} · locating the surrounding region`:'Discovering the place around you';
  const message=$('.scout-message');message.replaceChildren();const h=document.createElement('h2'),p=document.createElement('p');
  h.textContent=current?current.intro.title:regionError?'Keep exploring.':'Every region has a story.';
  p.textContent=current?current.intro.text:regionError?'The regional map could not load. You can keep moving and open a nearby field story, or retry the region map.':'Astrounit is finding the landscape and region beneath his feet. Move freely; the place and its story will follow your journey.';message.append(h,p);$('.scout-actions').replaceChildren();
  if(current)renderActions(current);
  if(regionError){const b=document.createElement('button');b.textContent='Retry regional map';b.addEventListener('click',()=>{loadRegions();renderIdle();});$('.scout-actions').append(b);}
  nearbyStories();onLayout();
 }
 function sync(){const pause=!active||!canInteract()||document.hidden;
  if(pause===suspended)return;suspended=pause;stop();if(pause){hush();cancelRegionalStory();panel.hidden=true;if(map.hasLayer(marker))map.removeLayer(marker);app.classList.remove('scout-on');}
  else{panel.hidden=false;app.classList.add('scout-on');marker.addTo(map);place();renderIdle();if(regionContext&&regionStory?.status==='overview')storyTimer=setTimeout(enrichRegion,700);}onLayout();
 }
 function setActive(on){if(destroyed)return;on=Boolean(on);if(on===active){sync();return;}active=on;toggle.setAttribute('aria-pressed',String(on));if(on){loadRegions();map.closePopup();keyboardWasEnabled=map.keyboard.enabled();map.keyboard.disable();setFollow(true);if(!position)setPosition(getSelectedEvent());}else if(keyboardWasEnabled)map.keyboard.enable();sync();if(on&&!suspended){setTimeout(()=>{if(active&&!suspended)follow(true);},40);}}
 function setTool(next){tool=next;stop();$('[data-walk]').setAttribute('aria-pressed',String(tool==='walk'));$('[data-inspect]').setAttribute('aria-pressed',String(tool==='inspect'));$('.scout-help').textContent=tool==='walk'?'WASD / arrows · tap to walk · discover the region around you':'Tap the map to inspect · WASD / arrows still move Astrounit';}
 listen(toggle,'click',()=>setActive(!active));listen($('[data-off]'),'click',()=>setActive(false));listen($('[data-walk]'),'click',()=>setTool('walk'));listen($('[data-inspect]'),'click',()=>setTool('inspect'));listen($('[data-follow]'),'click',()=>{setFollow(true);follow(true);});
 const movement={w:[0,-1],a:[-1,0],s:[0,1],d:[1,0],arrowup:[0,-1],arrowleft:[-1,0],arrowdown:[0,1],arrowright:[1,0]};
 const editable=e=>e.composedPath().some(n=>n instanceof Element&&n.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="tab"],[role="slider"]'));
 listen(document,'keydown',e=>{const key=e.key.toLowerCase();if(!active||!canInteract()||document.hidden||e.ctrlKey||e.metaKey||e.altKey||editable(e)||!movement[key])return;e.preventDefault();e.stopImmediatePropagation();keys.add(key);target=null;},true);
 listen(document,'keyup',e=>keys.delete(e.key.toLowerCase()));listen(window,'blur',stop);listen(document,'visibilitychange',sync);
 const dragStart=()=>{if(active){setFollow(false);stop();}},mapMove=()=>{if(active)place();};map.on('dragstart',dragStart);map.on('moveend',mapMove);const resized=()=>{if(active&&following)needsFollow=true;};map.on('resize zoomend',resized);
 const joystick=$('[data-stick]');let pointer=null;
 function joystickMove(e){const r=joystick.getBoundingClientRect(),x=(e.clientX-r.left-r.width/2)/24,y=(e.clientY-r.top-r.height/2)/24,n=Math.max(1,Math.hypot(x,y));stick={x:x/n,y:y/n};target=null;joystick.querySelector('span').style.transform=`translate(${stick.x*16}px,${stick.y*16}px)`;}
 listen(joystick,'pointerdown',e=>{if(suspended||e.button!==0)return;e.preventDefault();pointer=e.pointerId;joystick.setPointerCapture(pointer);joystickMove(e);});listen(joystick,'pointermove',e=>{if(e.pointerId===pointer)joystickMove(e);});for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(joystick,type,()=>{pointer=null;stick={x:0,y:0};joystick.querySelector('span').style.transform='';});
 return {setActive,isActive:()=>active,setPosition,refresh(){if(regionContext)renderRegionActions();else if(tracker.current)renderActions(tracker.current);},handleMapClick(e){if(!active||suspended||!canInteract()||tool!=='walk')return false;target={lat:e.latlng.lat,lon:normalizeLongitude(e.latlng.lng)};return true;},
  update(time,dt){sync();if(suspended||!position)return;if(needsFollow){needsFollow=false;follow(true,time);}let x=stick.x,y=stick.y;for(const k of keys){x+=movement[k][0];y+=movement[k][1];}const next=moveScout(position,{x,y,target,zoom:map.getZoom(),dt});position={lat:next.lat,lon:next.lon};if(next.arrived)target=null;if(next.moving){place();marker.getElement()?.style.setProperty('--heading',`${next.heading}deg`);follow(false,time);}else if(wasMoving)follow(true,time);wasMoving=next.moving;if(time-lastCoords>300){lastCoords=time;$('.scout-coords').textContent=`${position.lat.toFixed(2)}°, ${position.lon.toFixed(2)}°`;}
   const previousArea=tracker.current?.id,arrival=tracker.update(position,time),region=regionTracker?.update(position,time);
   if(region)enterRegion(region);
   else if(previousArea!==tracker.current?.id||arrival&&!regionTracker){if(regionContext)renderRegionActions();else renderIdle();}
   if(time-lastNearby>3000){lastNearby=time;if(tracker.nearest(position).map(a=>a.id).join(',')!==nearbySignature)nearbyStories();}

  },destroy(){if(destroyed)return;setActive(false);destroyed=true;cancelRegionalStory();atlasAbort?.abort();stop();hush();listeners.forEach(fn=>fn());map.off('dragstart',dragStart);map.off('moveend',mapMove);map.off('resize zoomend',resized);marker.remove();panel.remove();}
 };
}
