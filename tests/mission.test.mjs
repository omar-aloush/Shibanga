import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {readMissionDestination,shouldOpenMission} from '../mission-routing.js';
const base='https://example.com/fringe/index.html';
test('first visit opens the mission; repeat visitors and explicit explorer links bypass it',()=>{
 assert.equal(shouldOpenMission(),true);assert.equal(shouldOpenMission({visited:true}),false);assert.equal(shouldOpenMission({hash:'game',visited:true}),false);
 for(const hash of ['nile-delta','journey','investigate','lab','guide'])assert.equal(shouldOpenMission({hash}),false);
 for(const q of ['welcome=0','mode=nisar','story=nile-delta','live=31,30'])assert.equal(shouldOpenMission({params:new URLSearchParams(q)}),false);
});
test('recorded acquisition pair arrives in Inspect unchanged',()=>{
 const d=readMissionDestination('index.html?welcome=0&play=0&a=2026-06-26&b=2026-10-12#investigate',base);
 assert.equal(d.view,'investigate');assert.deepEqual(d.selection,{a:'2026-06-26',b:'2026-10-12'});
});
test('map handoffs preserve place, representation, selected frame and details',()=>{
 const d=readMissionDestination('index.html?mode=nisar&sheet=1#campi-flegrei',base);
 assert.equal(d.eventId,'campi-flegrei');assert.equal(d.mode,'nisar');assert.equal(d.sheet,true);
 const delta=readMissionDestination('index.html?mode=fields&frame=0#nile-delta',base);assert.equal(delta.frame,0);assert.equal(delta.mode,'fields');
 assert.equal(readMissionDestination('index.html?story=jakarta#jakarta',base).story,'jakarta');
 assert.equal(readMissionDestination('index.html#lab',base).view,'lab');
});
test('external sources, downloads and non-app URLs remain normal browser links',()=>{
 for(const url of ['https://other.example/index.html#lab','data/evidence/evidence-nile-delta.json','mailto:someone@example.com','javascript:alert(1)'])assert.equal(readMissionDestination(url,base),null);
});
test('malformed selections never become fabricated dates or negative frame indices',()=>{
 const d=readMissionDestination('index.html?a=2026-02-30&b=garbage&frame=-1&mode=unknown#investigate',base);
 assert.deepEqual(d.selection,{a:undefined,b:undefined});assert.equal(d.frame,null);assert.equal(d.mode,'model');
});
test('all app and shared mission module dependencies exist after retiring the old runtime',async()=>{
 const seen=new Set();async function walk(path){if(seen.has(path))return;seen.add(path);const text=await readFile(new URL('../'+path,import.meta.url),'utf8');for(const m of text.matchAll(/(?:from\s*|import\s*\()\s*["']\.\/([^"'?]+)(?:\?[^"']*)?["']/g)){await access(new URL('../'+m[1],import.meta.url));await walk(m[1]);}}
 await walk('app.js');await walk('mission.js');assert.ok(seen.has('mission-controller.js'));assert.ok(!seen.has('game.js'));
});
