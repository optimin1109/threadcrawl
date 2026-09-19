import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const file = name => new URL(`../browser-extension/${name}`,import.meta.url);
const source = name => readFileSync(file(name),'utf8');
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function harness({total=12,missing=null,holdSnapshot=false,returnSecurity=false,redirectOnCheckpoint=null}={}) {
  const badge=(part,n)=>`<div class="x1rg5ohu"><span>${part}</span><span>/</span><span>${n}</span></div>`;
  const row=(prefix,part,n,detail=false,owner='sample')=>`<div data-pressable-container="true"><a href="/@${owner}/post/${prefix}${part}"><time datetime="2026-09-19T04:00:00Z"></time></a>${detail?badge(part,n):''}<div class="${detail?'xqti54a x49hn82 xcrlgei x889kno':'x1xdureb xkbb5z'} x13vxnyz"><div><div class="x1a6qonq"><div><span dir="auto">${prefix} ${part} 본문${detail?'':badge(part,n)}</span></div></div><div><button>좋아요</button></div></div></div></div>`;
  const region=html=>`<main data-column-scrollable role="region">${html}</main>`;
  const profile=()=>region(row('A',1,total)+row('A',2,total)+row('B',1,3)+row('B',2,3));
  const dom=new JSDOM(profile(),{url:'https://www.threads.com/@sample',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,messages=[],events=[],timers=new Map();
  w.structuredClone=structuredClone;
  let now=1000,nextId=0,top=400,layoutShift=0,release;
  const restoredPositions=[];
  const pending=new Promise(r=>release=r);
  w.Date.now=()=>now;
  w.setTimeout=(fn,delay=0)=>{timers.set(++nextId,{fn,at:now+delay});return nextId;};
  w.clearTimeout=id=>timers.delete(id);
  Object.defineProperty(w.document,'scrollingElement',{value:w.document.documentElement});
  const scroller=w.document.documentElement;
  Object.defineProperties(scroller,{scrollTop:{get:()=>top,set:value=>{top=value;}},clientHeight:{value:600},scrollHeight:{value:4000}});
  scroller.scrollBy=({top:delta})=>{top+=delta;events.push('scroll');};
  scroller.scrollTo=({top:value})=>{top=value;restoredPositions.push(value);events.push('restore');};
  w.HTMLAnchorElement.prototype.getBoundingClientRect=function(){
    const base=this.getAttribute('href').includes('/A')?500:1100;
    return {top:base+layoutShift-top,height:20};
  };
  w.document.addEventListener('click',event=>{
    const anchor=event.target.closest('a');
    if(anchor?.querySelector('time')) {
      event.preventDefault();const id=anchor.getAttribute('href');const prefix=id.includes('/A')?'A':'B',n=prefix==='A'?total:3;
      events.push(`open:${prefix}`);top=0;w.history.replaceState({},'',id);
      w.document.body.innerHTML='<button aria-label="돌아가기">돌아가기</button>'+region(Array.from({length:n},(_,i)=>i+1).filter(i=>!(prefix==='A'&&i===missing)).map(i=>row(prefix,i,n,i===1)).join('')+row('X',3,n,false,'outsider'));
    } else if(event.target.closest('button[aria-label="돌아가기"]')) {
      events.push('back');top=0;layoutShift+=200;w.history.replaceState({},'','/@sample');w.document.body.innerHTML=returnSecurity?'<h1>보안 확인</h1><input type="password">':profile();
    }
  });
  w.chrome={runtime:{sendMessage:message=>{
    messages.push(JSON.parse(JSON.stringify(message)));events.push(message.type);
    if(message.type==='checkpoint'&&message.navigation.mode===redirectOnCheckpoint)w.history.replaceState({},'','/@other');
    return message.type==='snapshot' && holdSnapshot ? pending : Promise.resolve({ok:true});
  },onMessage:{addListener(){},removeListener(){}}}};
  w.threadsArchiveConfig={runId:'run',intervalMs:1500,maxRounds:1800,startedAt:now,navigation:{mode:'profile',profilePath:'/@sample',activeChain:null,resume:null,visitedRoots:[]},chains:[]};
  w.eval(source('reader.js'));
  if(existsSync(file('chains.js')))w.eval(source('chains.js'));
  w.eval(source('content.js'));
  async function advance(limit=1){
    await flush();
    for(let i=0;i<limit;i++){
      const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
      timers.delete(next[0]);now=next[1].at;await next[1].fn();await flush();
    }
  }
  return {dom,w,messages,events,restoredPositions,advance,release,stop:()=>{w.threadsArchiveStop();dom.window.close();}};
}
test('opens each profile chain, saves twelve parts, returns, and continues to another post',async()=>{
  const h=harness();await h.advance(15);
  const complete=h.messages.filter(m=>m.type==='chain'&&m.chain.status==='complete');
  assert.equal(complete.length,2);
  assert.equal(complete[0].chain.members.length,12);
  assert.equal(complete[1].chain.members.length,3);
  assert.ok(!h.messages.filter(m=>m.type==='snapshot').flatMap(m=>m.page.cards).some(c=>c.id.includes('@outsider')));
  assert.ok(h.events.indexOf('snapshot')<h.events.indexOf('open:A'));
  assert.ok(h.events.indexOf('checkpoint')<h.events.indexOf('open:A'));
  assert.ok(h.events.indexOf('back')<h.events.indexOf('open:B'));
  assert.deepEqual(h.restoredPositions,[600,800], 'restore the anchor offset even when layout changes after returning');
  assert.equal(h.w.location.pathname,'/@sample');
  h.stop();
});
test('a missing middle part becomes an explicit incomplete chain, never complete',async()=>{
  const h=harness({total:20,missing:7});await h.advance(90);
  const reports=h.messages.filter(m=>m.type==='chain'&&m.chain.rootId==='/@sample/post/A1');
  assert.ok(reports.length);
  assert.equal(reports.at(-1).chain.status,'incomplete');
  assert.deepEqual(reports.at(-1).chain.missing,[7]);
  assert.ok(!reports.some(m=>m.chain.status==='complete'));
  assert.ok(h.events.includes('open:B'));
  h.stop();
});
test('does not open a detail page before the profile snapshot is committed',async()=>{
  const h=harness({holdSnapshot:true});await flush();
  assert.ok(!h.events.includes('open:A'));
  h.release({ok:true});await h.advance(2);
  assert.ok(h.events.includes('open:A'));
  h.stop();
});
test('stops at a security page on return even when the profile region is absent',async()=>{
  const h=harness({returnSecurity:true});await h.advance(8);
  assert.ok(h.messages.some(m=>m.type==='ended'&&/보안|로그인/.test(m.reason)));
  assert.ok(!h.events.includes('open:B'));
  h.stop();
});
for(const mode of ['opening','returning'])test(`does not click a stale control after navigation during the ${mode} checkpoint`,async()=>{
  const h=harness({redirectOnCheckpoint:mode});await h.advance(8);
  assert.ok(h.messages.some(m=>m.type==='ended'));
  assert.equal(h.w.location.pathname,'/@other');
  assert.ok(!h.events.includes(mode==='opening'?'open:A':'back'));
  h.stop();
});
