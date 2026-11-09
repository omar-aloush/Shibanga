import { MISSION_VISIT_KEY } from './mission-routing.js?v=14.0';

// The preview HTML supplies the exact approved design. A shadow root isolates its
// IDs and styles from the explorer; this runtime owns only the briefing.
export function initFieldMission({root,onExit,onExplore}) {
 let active=false,controller=null,loading=null,destroyed=false;
 const host=document.createElement('div');host.className='field-mission-host';host.hidden=true;
 const shadow=host.attachShadow({mode:'open'});root.replaceChildren(host);
 const hasVisited=()=>{try{return localStorage.getItem(MISSION_VISIT_KEY)==='1';}catch{return false;}};
 const markVisited=()=>{try{localStorage.setItem(MISSION_VISIT_KEY,'1');}catch{}};
 function placeholder(failed=false){
  shadow.innerHTML='<style>:host{display:grid;place-items:center;position:absolute;inset:0;color:#dceff6;background:#00121f;font:16px/1.6 system-ui}:host([hidden]){display:none}section{max-width:380px;padding:28px;text-align:center}h1{font-size:27px}button{padding:11px 19px;border:1px solid #66dbea;border-radius:24px;background:#36def0;color:#00121f;font:600 14px system-ui;margin:8px;cursor:pointer}</style>';
  const panel=document.createElement('section');panel.setAttribute('role',failed?'alert':'status');
  panel.innerHTML=failed?'<h1>The mission could not open.</h1><p>Your explorer is still available. Retry the story when your connection is ready.</p><button data-retry>Retry mission</button><button data-exit>Open explorer</button>':'<h1>A Changing Frontier</h1><p>Preparing your field mission…</p><button data-exit>Open explorer</button>';
  shadow.append(panel);panel.querySelector('[data-retry]')?.addEventListener('click',enter);panel.querySelector('[data-exit]')?.addEventListener('click',()=>{markVisited();onExit();});
 }
 async function load(){
  placeholder();
  try {
   const [response,runtime]=await Promise.all([fetch('mission.html?v=14.0',{cache:'no-cache'}),import('./mission-controller.js?v=14.0')]);
   if(!response.ok)throw Error('Mission unavailable');
   const doc=new DOMParser().parseFromString(await response.text(),'text/html');
   if(!doc.getElementById('prologue')||!doc.querySelector('style'))throw Error('Mission template incomplete');
   if(destroyed)return;
   const style=document.createElement('style');style.textContent=doc.querySelector('style').textContent.replace(':root{',':host{').replace('html,body{',':host{')+'\n:host{display:block;position:absolute;inset:0;font-family:var(--sans);color:var(--text)}:host([hidden]){display:none!important}';
   doc.body.querySelectorAll('script').forEach(el=>el.remove());
   shadow.replaceChildren(style);
   for(const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    if(link.href.includes('fonts.googleapis.com')) {
     if(!document.querySelector('link[data-mission-fonts]')){const font=link.cloneNode(true);font.dataset.missionFonts='';document.head.append(font);}
    }else shadow.append(link.cloneNode(true));
   }
   for(const node of [...doc.body.childNodes])shadow.append(document.importNode(node,true));
   controller=runtime.initMission({root:shadow,initiallyActive:active,onExit:()=>{markVisited();onExit();},onVisited:markVisited,onExplore:selection=>{markVisited();onExplore(selection);}});
   if(active)controller.enter();
  }catch(error){if(!destroyed){placeholder(true);console.warn('Field mission unavailable',error);}}
  finally {loading=null;}
 }
 function enter(){active=true;host.hidden=false;if(controller)controller.enter();else if(!loading)loading=load();}
 return {enter,replay(){enter();controller?.replay();},hasVisited,markVisited,refreshData(){},setActive(on){active=Boolean(on);host.hidden=!active;controller?.setActive(active);if(active)enter();},destroy(){destroyed=true;controller?.destroy();host.remove();}};
}
