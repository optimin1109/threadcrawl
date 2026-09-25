import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {CaptureStore} from '../browser-extension/storage.mjs';

const source=name=>readFileSync(new URL(`../browser-extension/${name}`,import.meta.url),'utf8');
const row=(id,{numbered=false,broken=false}={})=>`<div data-virtualized="true"><div data-pressable-container="true"><a href="/@sample/post/${id}"><time datetime="2026-09-19T04:00:00Z"></time></a><div class="x1xdureb xkbb5z x13vxnyz"><div><div class="x1a6qonq"><div><span dir="auto">저장한 본문 ${id}${numbered?'<div class="x1rg5ohu"><span>1</span><span>/</span><span>2</span></div>':''}</span></div></div>${broken?'<div>미확인 본문 구조</div>':''}<div><button>좋아요</button></div></div></div></div></div>`;

async function setup({known=true,loading=false,broken=false,empty=false,numbered=false,freeze=false,newAt=null,holdAt=null}={}){
  const dom=new JSDOM('<main data-column-scrollable role="region"></main>',{url:'https://www.threads.com/@sample',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,store=new CaptureStore({indexedDB:new IDBFactory()}),identity={tabId:7,runId:'fast-test'};
  let now=1000,nextId=0,index=0;
  const timers=new Map(),pending=new Set(),scrolls=[],acks=[],snapshots=[];
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  w.structuredClone=structuredClone;w.Date.now=()=>now;
  w.setTimeout=(fn,delay=0)=>{timers.set(++nextId,{fn,at:now+delay});return nextId;};w.clearTimeout=id=>timers.delete(id);
  const render=i=>{w.document.querySelector('main').innerHTML=(empty?'':row(`P${i}`,{numbered,broken}))+(loading?'<div role="progressbar"></div>':'');};
  w.eval(source('reader.js'));w.eval(source('chains.js'));
  await store.start('sample',identity.tabId,identity.runId);
  if(known)for(let i=0;i<5;i++){
    if(i===newAt)continue;
    render(i);await store.append(structuredClone(w.readThreadsPage()),identity);
  }
  render(0);
  Object.defineProperty(w.document,'scrollingElement',{value:w.document.documentElement});
  const scroller=w.document.documentElement;
  Object.defineProperties(scroller,{clientHeight:{value:600},scrollHeight:{value:6000}});
  scroller.scrollBy=({top})=>{scrolls.push({at:now,top});if(!freeze&&index<4)render(++index);};
  w.chrome={runtime:{onMessage:{addListener(){},removeListener(){}},sendMessage:message=>{
    const work=(async()=>{
      if(message.type==='snapshot'){
        snapshots.push(message.page);
        return store.append(structuredClone(message.page),identity);
      }
      if(message.type==='chain')return store.recordChain(structuredClone(message.chain),identity);
      if(message.type==='checkpoint')return store.checkpoint(structuredClone(message.navigation),identity);
      return {ok:true};
    })();pending.add(work);work.finally(()=>pending.delete(work));
    return work.then(async result=>{
      if(message.type==='snapshot'){
        if(message.page.cards[0]?.id===`/@sample/post/P${holdAt}`)await held;
        acks.push({at:now,result});
      }
      return result;
    });
  }}};
  w.threadsArchiveConfig={runId:identity.runId,intervalMs:1500,maxRounds:1800,startedAt:now,navigation:{mode:'profile',profilePath:'/@sample',activeChain:null,resume:null,visitedRoots:[]},chains:[]};
  w.eval(source('content.js'));
  const settle=async()=>{for(let i=0;i<6;i++){await Promise.all([...pending]);await new Promise(setImmediate);}};
  await settle();
  const fireNext=()=>{
    const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];assert.ok(next,'collector remains scheduled');
    timers.delete(next[0]);now=next[1].at;return next[1].fn();
  };
  const advance=async count=>{
    for(let guard=0;scrolls.length<count&&guard<100;guard++){
      await fireNext();await settle();
    }
    assert.ok(scrolls.length>=count,'requested viewports were visited');
  };
  return {scrolls,acks,snapshots,timers,advance,fireNext,release,settle,close:async()=>{w.threadsArchiveStop();release();await settle();dom.window.close();await store.close();}};
}

test('continued capture reads and acknowledges every stored viewport with shorter waits and unchanged overlap',async()=>{
  const h=await setup();
  try{
    await h.advance(4);
    assert.deepEqual(h.scrolls.map(s=>s.at),[1000,1500,2000,2500]);
    assert.ok(h.scrolls.every(s=>s.top===390),'keep the overlapping 65% viewport movement');
    assert.ok(h.acks.length>=4&&h.acks.every(a=>a.result.unchangedCleanPage));
  }finally{await h.close();}
});

test('a fast continuation still waits for the next viewport acknowledgement before another scroll',async()=>{
  const h=await setup({holdAt:1});
  try{
    const reading=h.fireNext();
    await h.settle();
    assert.equal(h.snapshots.length,2,'the second viewport is already waiting for its ACK');
    assert.equal(h.scrolls.length,1);
    assert.equal(h.acks.length,1);
    h.release();await reading;await h.settle();await h.advance(2);
    assert.deepEqual(h.scrolls.map(s=>s.at),[1000,1500]);
    assert.ok(h.acks.length>=2);
  }finally{await h.close();}
});

test('first new viewport immediately restores the normal render wait',async()=>{
  const h=await setup({newAt:1});
  try{
    await h.advance(3);
    assert.deepEqual(h.scrolls.map(s=>s.at),[1000,2500,3000]);
    assert.equal(h.acks[1].result.unchangedCleanPage,false);
  }finally{await h.close();}
});

test('new, loading, unsupported, empty and unchanged-after-scroll viewports keep normal timing',async()=>{
  for(const options of [{known:false},{loading:true},{broken:true},{empty:true},{freeze:true}]){
    const h=await setup(options);
    try{await h.advance(2);assert.deepEqual(h.scrolls.map(s=>s.at),[1000,2500],JSON.stringify(options));}
    finally{await h.close();}
  }
});

test('an unresolved numbered profile candidate gets its full render interval before detail collection',async()=>{
  const h=await setup({numbered:true,freeze:true});
  try{
    assert.equal(h.scrolls.length,1);
    assert.ok(h.acks[0].result.unchangedCleanPage,'saved body alone must not bypass chain repair');
    assert.equal(Math.min(...[...h.timers.values()].map(t=>t.at)),2500);
  }finally{await h.close();}
});
