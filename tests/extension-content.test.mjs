import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const source=readFileSync(new URL('../browser-extension/content.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function setup() {
  const dom=new JSDOM('<main data-column-scrollable role="region"></main>',{url:'https://www.threads.com/@sample',runScripts:'outside-only'});
  const w=dom.window, messages=[], timers=new Map(), listeners=new Set();
  let resolve, nextId=0, scrolls=0;
  const pending=new Promise(r=>resolve=r);
  w.threadsArchiveConfig={runId:'current-run',intervalMs:1500,maxRounds:3};
  w.setTimeout=(fn,delay)=>{timers.set(++nextId,{fn,delay});return nextId;};
  w.clearTimeout=id=>timers.delete(id);
  Object.defineProperty(w.document,'scrollingElement',{value:w.document.documentElement});
  w.document.documentElement.scrollBy=()=>scrolls++;
  w.readThreadsPage=()=>({version:2,account:'sample',cards:[{id:'one',text:'본문'}],issues:[],blocked:false});
  w.chrome={runtime:{sendMessage:message=>{messages.push(message);return message.type==='snapshot'?pending:Promise.resolve({ok:true});},onMessage:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)}}};
  w.eval(source);
  return {dom,w,messages,timers,listeners,resolve,scrolls:()=>scrolls};
}
test('waits for persistence before scheduling or scrolling and tags its run',async()=>{
  const h=setup();await flush();
  assert.equal(h.scrolls(),0);
  assert.equal([...h.timers.values()].filter(t=>t.delay!==4500).length,0);
  assert.equal(h.messages[0].runId,'current-run');
  h.resolve({ok:true});await flush();
  assert.equal(h.scrolls(),1);
  assert.equal([...h.timers.values()].filter(t=>t.delay===1500).length,1);
  h.w.threadsArchiveStop();h.dom.window.close();
});
test('a capture deadline ends the run even if storage is still pending',async()=>{
  const h=setup();await flush();
  const deadline=[...h.timers.values()].find(t=>t.delay===4500);
  assert.ok(deadline);
  await deadline.fn();await flush();
  assert.ok(h.messages.some(m=>m.type==='ended'));
  h.resolve({ok:true});await flush();
  assert.equal(h.scrolls(),0);assert.equal(h.timers.size,0);
  h.dom.window.close();
});
test('storage rejection stops without moving past unsaved posts',async()=>{
  const h=setup();await flush();h.resolve({ok:false,error:'quota'});await flush();
  assert.equal(h.scrolls(),0);assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);
  h.dom.window.close();
});
test('a stop during persistence prevents the pending scroll',async()=>{
  const h=setup();await flush();h.w.threadsArchiveStop();h.resolve({ok:true});await flush();
  assert.equal(h.scrolls(),0);assert.equal(h.timers.size,0);
  h.dom.window.close();
});
test('navigation during persistence ends this run before moving the new page',async()=>{
  const h=setup();await flush();h.dom.reconfigure({url:'https://www.threads.com/@other'});h.resolve({ok:true});await flush();
  assert.equal(h.scrolls(),0);assert.ok(h.messages.some(m=>m.type==='ended'&&m.runId==='current-run'));
  h.dom.window.close();
});
