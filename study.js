import { downloadFile } from './science.js?v=10.0';
const KEY='fringe.observer.v1',tasks=[
  ['journey','Begin the Journey. Find the real observation view.','Observe whether the participant reaches the actual NISAR dates and distinguishes illustration from observation.'],
  ['mission','Explore A Changing Frontier and follow the field mission.','Record whether story navigation, actual-date comparison, scout movement and the handoff to Inspect can be used. Record any assistance.'],
  ['timeline','On the real map, select a different acquisition date and change the layer.','Observe actual timeline and layer use.'],
  ['source','Find the acquisition date, source and one limitation for the displayed data.','Record whether the participant finds Details & Sources and can distinguish a preview from a measurement.'],
  ['investigation','In Inspect, compare two actual dates, save an observation and export a brief.','Observe completion and whether the exported brief can be opened. Do not grade a scientific conclusion.'],
];
const $=(s)=>document.querySelector(s);let record=null,running=null,last=0;
const status=(s)=>{$('#status').textContent=s;};
const code=()=>`P-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
$('#participant').value=code();
function persist(){try{localStorage.setItem(KEY,JSON.stringify(record));}catch{status('Storage unavailable. Export this session before closing the tab.');}}
function elapsed(){if(!running)return;const now=performance.now();record.tasks.find((t)=>t.id===running).seconds+=(now-last)/1000;last=now;}
function pause(){elapsed();running=null;persist();render();}
function render(){
  if(!record)return;$('#session').hidden=false;$('#session-code').textContent=`ANONYMOUS SESSION / ${record.participant} / ${record.device}`;$('#notes').value=record.notes;
  $('#tasks').innerHTML=tasks.map(([id,title,guide])=>{const t=record.tasks.find((t)=>t.id===id);return `<article class="task"><h3>${title}</h3><p><small>${guide}</small></p><div class="task-controls"><button data-task="${id}">${running===id?'Pause task':'Start / resume task'}</button><span class="timer" data-timer="${id}">${Math.round(t.seconds)} s</span><label>Observed outcome <select data-outcome="${id}"><option value="not-attempted">Not attempted</option><option value="independent">Completed independently</option><option value="assisted">Completed with help</option><option value="incomplete">Not completed / stopped</option></select></label></div><label>What happened / assistance given<textarea data-task-note="${id}" maxlength="1000"></textarea></label></article>`;}).join('');
  for(const t of record.tasks){$(`[data-outcome="${t.id}"]`).value=t.outcome;$(`[data-task-note="${t.id}"]`).value=t.note;}
}
try {const old=JSON.parse(localStorage.getItem(KEY));if(old?.schema==='fringe.usability-session/1'&&old.consent===true&&tasks.every(([id])=>old.tasks?.some((t)=>t.id===id&&typeof t.seconds==='number'&&Number.isFinite(t.seconds)&&t.seconds>=0))){record=old;render();status('Previous anonymous session restored. Timers are paused.');}}catch{}
$('#start').addEventListener('click',()=>{if(!$('#consent').checked){status('Participant permission is required before recording a session.');return;}if(record){status('Export or discard the current session before starting another.');return;}const participant=$('#participant').value.trim();if(!/^[A-Za-z0-9_-]{1,32}$/.test(participant)){status('Use a short anonymous code with letters, numbers, dashes or underscores.');return;}record={schema:'fringe.usability-session/1',participant,consent:true,device:$('#device').value,startedAt:new Date().toISOString(),tasks:tasks.map(([id])=>({id,seconds:0,outcome:'not-attempted',note:''})),notes:'',interpretation:'Observed usability only; no learning or scientific validation claim.'};persist();render();status('Empty anonymous session started. No task outcome is assumed.');});
$('#tasks').addEventListener('click',(ev)=>{const b=ev.target.closest('[data-task]');if(!b||!record)return;const id=b.dataset.task,same=running===id;elapsed();running=same?null:id;last=performance.now();persist();render();});
$('#tasks').addEventListener('change',(ev)=>{if(!record)return;const id=ev.target.dataset.outcome;if(id){elapsed();if(running===id)running=null;record.tasks.find((t)=>t.id===id).outcome=ev.target.value;persist();render();}});
$('#tasks').addEventListener('input',(ev)=>{const id=ev.target.dataset.taskNote;if(id&&record){record.tasks.find((t)=>t.id===id).note=ev.target.value.slice(0,1000);persist();}});
$('#notes').addEventListener('input',()=>{if(record){record.notes=$('#notes').value.slice(0,2000);persist();}});
$('#export').addEventListener('click',()=>{if(!record)return;pause();downloadFile(`fringe-usability-${record.participant}.json`,JSON.stringify({...record,exportedAt:new Date().toISOString()},null,2));status('Anonymous record exported. Review it for identifying details before sharing.');});
$('#discard').addEventListener('click',()=>{running=null;record=null;try{localStorage.removeItem(KEY);}catch{}$('#session').hidden=true;$('#consent').checked=false;$('#participant').value=code();status('Local observer session discarded. Downloaded copies are unaffected.');});
setInterval(()=>{if(running&&record){elapsed();$(`[data-timer="${running}"]`).textContent=`${Math.round(record.tasks.find((t)=>t.id===running).seconds)} s`;}},500);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&record)pause();});window.addEventListener('pagehide',()=>{if(record){elapsed();running=null;persist();}});
