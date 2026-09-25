import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const file = name => new URL(`../browser-extension/${name}`,import.meta.url);
const source = name => readFileSync(file(name),'utf8');
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function harness({total=12,missing=null,holdSnapshot=false,returnSecurity=false,redirectOnCheckpoint=null,
  mutateDetailSnapshots=false,missingRegionA=false,expandUnrelatedReplies=false,profileCompleteA=false,
  imageInProfileA=false,mediaOnlySecondA=false,progressiveDetailA=false,detailTimeoutMs=120000,
  delayedProfileSecondA=false,removeProfileRootA=false,photoButtonsInProfileA=false,mutateProfileCompleteA=false,lateProfileRootA=false,
  downgradeProfileCompleteA=false,downgradeDetailCompleteA=false}={}) {
  const badge=(part,n)=>`<div class="x1rg5ohu"><span>${part}</span><span>/</span><span>${n}</span></div>`;
  const row=(prefix,part,n,detail=false,owner='sample')=>`<div data-pressable-container="true"><a href="/@${owner}/post/${prefix}${part}"><time datetime="2026-09-19T04:00:00Z"></time></a>${detail?badge(part,n):''}<div class="${detail?'xqti54a x49hn82 xcrlgei x889kno':'x1xdureb xkbb5z'} x13vxnyz"><div><div class="x1a6qonq"><div><span dir="auto">${prefix} ${part} 본문${detail?'':badge(part,n)}</span></div></div><div><button>좋아요</button></div></div></div></div>`;
  const region=html=>`<main data-column-scrollable role="region">${html}</main>`;
  const profile=()=>{
    if(lateProfileRootA)return region('');
    let first=row('A',1,total);
    if(imageInProfileA)first=first.replace('<div><button>', '<div><a href="/@sample/post/A1/media"><img alt="사진"></a></div><div><a href="/search?location_id=123&amp;serp_type=location_tag">장소</a></div><div><button>');
    if(photoButtonsInProfileA)first=first.replace('<div><button>', '<div><div role="button" tabindex="0"><picture><img alt=""></picture></div><button aria-label="미디어를 파노라마로 결합" type="button"></button><div role="button" tabindex="0"><picture><img alt=""></picture></div></div><div><button>');
    let second=row('A',2,total);
    if(mediaOnlySecondA)second=second
      .replace('</a><div class="x1xdureb',`</a>${badge(2,total)}<div class="x1xdureb`)
      .replace(`<div class="x1a6qonq"><div><span dir="auto">A 2 본문${badge(2,total)}</span></div></div>`,
        `<div><a href="/@sample/post/A2/media"><img alt="첫 사진"></a><a href="/@sample/post/A2/media"><img alt="둘째 사진"></a></div>`);
    return region((profileCompleteA?'<div data-virtualized="true">':'')+first+(delayedProfileSecondA?'':second)
      +(profileCompleteA?'</div>':'')+row('B',1,3)+row('B',2,3));
  };
  const dom=new JSDOM(profile(),{url:'https://www.threads.com/@sample',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,messages=[],events=[],timers=new Map();
  w.structuredClone=structuredClone;
  let now=1000,nextId=0,top=400,layoutShift=0,detailSnapshotCount=0,visibleParts=1,release;
  const restoredPositions=[],expansionTimes=[],profileScrollTimes=[],detailOpenTimes=[];
  const pending=new Promise(r=>release=r);
  w.Date.now=()=>now;
  w.setTimeout=(fn,delay=0)=>{timers.set(++nextId,{fn,at:now+delay});return nextId;};
  w.clearTimeout=id=>timers.delete(id);
  Object.defineProperty(w.document,'scrollingElement',{value:w.document.documentElement});
  const scroller=w.document.documentElement;
  Object.defineProperties(scroller,{scrollTop:{get:()=>top,set:value=>{top=value;}},clientHeight:{value:600},scrollHeight:{value:4000}});
  scroller.scrollBy=({top:delta})=>{
    top+=delta;events.push('scroll');
    if(w.location.pathname==='/@sample'){
      profileScrollTimes.push(now);
      if(lateProfileRootA&&profileScrollTimes.length===1)
        w.setTimeout(()=>w.document.querySelector('main').insertAdjacentHTML('beforeend',`<div data-virtualized="true">${row('A',1,total)}</div>`),75);
      if(lateProfileRootA&&profileScrollTimes.length===2)
        w.setTimeout(()=>w.document.body.appendChild(w.document.createElement('div')),100);
    }
    if(w.location.pathname==='/@sample'&&delayedProfileSecondA&&!w.document.querySelector('a[href="/@sample/post/A2"]')) {
      const group=w.document.querySelector('[data-virtualized]');
      if(group)group.insertAdjacentHTML('beforeend',row('A',2,total));
    }
    if(w.location.pathname==='/@sample'&&removeProfileRootA)
      w.document.querySelector('a[href="/@sample/post/A1"]')?.closest('[data-pressable-container]')?.remove();
    if(progressiveDetailA&&w.location.pathname==='/@sample/post/A1'&&visibleParts<total)
      w.document.querySelector('main').insertAdjacentHTML('beforeend',row('A',++visibleParts,total));
  };
  scroller.scrollTo=({top:value})=>{top=value;restoredPositions.push(value);events.push('restore');};
  w.HTMLAnchorElement.prototype.getBoundingClientRect=function(){
    const base=this.getAttribute('href').includes('/A')?500:1100;
    return {top:base+layoutShift-top,height:20};
  };
  w.document.addEventListener('click',event=>{
    const anchor=event.target.closest('a');
    if(anchor?.querySelector('time')) {
      event.preventDefault();const id=anchor.getAttribute('href');const prefix=id.includes('/A')?'A':'B',n=prefix==='A'?total:3;
      detailOpenTimes.push({prefix,at:now});
      events.push(`open:${prefix}`);top=0;w.history.replaceState({},'',id);
      w.document.body.innerHTML='<button aria-label="돌아가기">돌아가기</button>'+(prefix==='A'&&missingRegionA?'<p>목록 로딩 중</p>':region(Array.from({length:n},(_,i)=>i+1).filter(i=>!(prefix==='A'&&i===missing)&&!(prefix==='A'&&progressiveDetailA&&i>1)).map(i=>row(prefix,i,n,i===1)).join('')+row('X',3,n,false,'outsider')+(prefix==='A'&&expandUnrelatedReplies?'<button id="more-replies">답글 1000개 더 보기</button>':'')));
    } else if(event.target.closest('button[aria-label="돌아가기"]')) {
      events.push('back');top=0;layoutShift+=200;w.history.replaceState({},'','/@sample');w.document.body.innerHTML=returnSecurity?'<h1>보안 확인</h1><input type="password">':profile();
    } else if(event.target.id==='more-replies'){
      expansionTimes.push(now);event.target.textContent=`답글 ${1000-expansionTimes.length}개 더 보기`;
    }
  });
  w.chrome={runtime:{sendMessage:message=>{
    messages.push(JSON.parse(JSON.stringify(message)));events.push(message.type);
    if(message.type==='checkpoint'&&message.navigation.mode===redirectOnCheckpoint)w.history.replaceState({},'','/@other');
    if(mutateDetailSnapshots&&message.type==='snapshot'&&message.page.detailRoot==='/@sample/post/A1'){
      const text=w.document.querySelector('.x49hn82 .x1a6qonq span[dir="auto"]');
      text.firstChild.textContent=`저장 중 바뀐 본문 ${++detailSnapshotCount}`;
    }
    let result={ok:true};
    if(message.type==='chain'){
      const chain=structuredClone(message.chain);
      if(chain.rootId==='/@sample/post/A1'&&chain.status==='complete'&&
          ((downgradeProfileCompleteA&&w.location.pathname==='/@sample') || (downgradeDetailCompleteA&&w.location.pathname==='/@sample/post/A1'))){
        chain.status='incomplete';chain.members=chain.members.filter(member=>member.part!==chain.total);
        chain.missing=[chain.total];chain.reason=`저장된 ${chain.total}번 본문 검증 실패`;
      }
      result={ok:true,chain};
    }
    const response=message.type==='snapshot' && holdSnapshot ? pending : Promise.resolve(result);
    return response.then(value=>{
      events.push(`ack:${message.type}${message.type==='chain'?`:${value.chain?.status || message.chain.status}`:''}`);
      if(mutateProfileCompleteA&&message.type==='chain'&&value.chain?.rootId==='/@sample/post/A1'&&
          value.chain.status==='complete'&&w.location.pathname==='/@sample')
        w.document.body.appendChild(w.document.createElement('div'));
      return value;
    });
  },onMessage:{addListener(){},removeListener(){}}}};
  w.threadsArchiveConfig={runId:'run',intervalMs:1500,maxRounds:1800,detailTimeoutMs,startedAt:now,navigation:{mode:'profile',profilePath:'/@sample',activeChain:null,resume:null,visitedRoots:[]},chains:[]};
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
  const reload=()=>{
    const navigation=messages.filter(message=>message.type==='checkpoint').at(-1).navigation;
    w.threadsArchiveConfig={...w.threadsArchiveConfig,runId:'reloaded-run',navigation:structuredClone(navigation)};
    w.eval(source('content.js'));
  };
  return {dom,w,messages,events,restoredPositions,expansionTimes,profileScrollTimes,detailOpenTimes,advance,release,reload,now:()=>now,stop:()=>{w.threadsArchiveStop();dom.window.close();}};
}
function assertAckedIncompleteReturn(h) {
  const back=h.events.indexOf('back');
  assert.ok(back>=0);
  assert.deepEqual(h.events.slice(back-4,back),['chain','ack:chain:incomplete','checkpoint','ack:checkpoint'],
    'incomplete chain and navigation must both be acknowledged before clicking Back');
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
  assert.deepEqual(h.restoredPositions,[990,1190], 'restore the anchor offset after the 390px profile look-ahead and 200px return layout shifts');
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

test('scrolls the profile once to reveal its delayed 2/2 before deciding to open detail',async()=>{
  const h=harness({total:2,profileCompleteA:true,delayedProfileSecondA:true});
  try{
    await h.advance(20);
    const report=h.messages.find(m=>m.type==='chain'&&m.chain.rootId==='/@sample/post/A1'&&m.chain.status==='complete');
    assert.ok(report,'both parts revealed in the same profile group must be saved');
    assert.equal(report.chain.completedFrom,'profile');
    assert.deepEqual(report.chain.members.map(m=>m.part),[1,2]);
    assert.ok(!h.events.includes('open:A'),'do not leave the profile before its visible continuation renders');
    assert.ok(h.events.includes('open:B'),'genuinely missing parts still get a bounded detail visit');
  }finally{h.stop();}
});

test('records an unresolved root that unmounts during profile look-ahead and continues',async()=>{
  const h=harness({total:2,removeProfileRootA:true});
  try{
    await h.advance(20);
    const report=h.messages.filter(m=>m.type==='chain'&&m.chain.rootId==='/@sample/post/A1').at(-1);
    assert.ok(report,'do not silently lose the pending root when virtualization removes it');
    assert.equal(report.chain.status,'incomplete');
    assert.ok(report.chain.missing.length);
    assert.ok(!h.events.includes('open:A'));
    assert.ok(h.events.includes('open:B'));
  }finally{h.stop();}
});

test('persists a newly pending root before its first profile look-ahead scroll',async()=>{
  const h=harness({total:2});
  try{
    await flush();
    const report=h.messages.find(m=>m.type==='chain'&&m.chain.rootId==='/@sample/post/A1');
    assert.ok(report,'stopping after the look-ahead scroll must retain the unresolved chain metadata');
    assert.ok(report.chain.missing.includes(2));
    const acknowledged=h.events.indexOf('ack:chain:pending'),scrolled=h.events.indexOf('scroll');
    assert.ok(acknowledged>=0&&scrolled>acknowledged,'persist the pending chain before advancing the profile');
  }finally{h.stop();}
});

test('a newly mounted root receives a full render interval after its actual profile look-ahead scroll',async()=>{
  const h=harness({total:2,lateProfileRootA:true});
  try{
    await h.advance(15);
    const opening=h.detailOpenTimes.find(item=>item.prefix==='A');
    assert.ok(opening,'an unresolved root still receives a bounded detail visit');
    assert.ok(h.profileScrollTimes.length>=2);
    assert.ok(opening.at-h.profileScrollTimes[1]>=1500,'do not consume the render allowance while waiting for the look-ahead scroll');
  }finally{h.stop();}
});

test('a profile completion acknowledged during a DOM mutation clears its pending detail visit',async()=>{
  const h=harness({total:2,profileCompleteA:true,delayedProfileSecondA:true,mutateProfileCompleteA:true});
  try{
    await h.advance(20);
    const report=h.messages.find(m=>m.type==='chain'&&m.chain.rootId==='/@sample/post/A1'&&m.chain.status==='complete');
    assert.equal(report?.chain.completedFrom,'profile');
    assert.ok(!h.events.includes('open:A'),'acknowledged profile completion must cancel the pending detail visit even if the DOM changed during save');
    assert.ok(h.events.includes('open:B'));
  }finally{h.stop();}
});

test('a profile group with photo buttons saves both parts and continues without entering its detail',async()=>{
  const h=harness({total:2,profileCompleteA:true,photoButtonsInProfileA:true});
  try{
    await h.advance(20);
    const report=h.messages.find(m=>m.type==='chain'&&m.chain.rootId==='/@sample/post/A1'&&m.chain.status==='complete');
    assert.ok(report);
    assert.equal(report.chain.completedFrom,'profile');
    assert.deepEqual(report.chain.members.map(m=>m.part),[1,2]);
    assert.ok(!h.events.includes('open:A'));
    assert.ok(h.events.includes('open:B'));
  }finally{h.stop();}
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

test('detail snapshots that mutate during every save still retain progress and return after 10 seconds without a new part',async()=>{
  const h=harness({total:2,missing:2,mutateDetailSnapshots:true});
  try{
    await h.advance(450);
    const reports=h.messages.filter(m=>m.type==='chain'&&m.chain.rootId==='/@sample/post/A1');
    assert.ok(reports.some(m=>m.chain.members.some(member=>member.part===1)),'acknowledged snapshots contribute numbered bodies even while DOM changes');
    assert.ok(h.events.includes('back'),'continuous DOM changes must not bypass the detail timeout');
    assertAckedIncompleteReturn(h);
    assert.equal(reports.at(-1).chain.status,'incomplete');
    assert.deepEqual(reports.at(-1).chain.missing,[2]);
  }finally{h.stop();}
});

test('a quiet incomplete detail returns after about 10 seconds of no numbered progress',async()=>{
  const h=harness({total:2,missing:2});
  try{
    await h.advance(7);
    assert.ok(!h.events.includes('back'),'do not abandon a detail before its short loading allowance');
    await h.advance(3);
    assert.ok(h.events.includes('back'),'an incomplete detail should not wait for the old 30-second timeout');
    assert.ok(h.now()-1000<20000);
    assertAckedIncompleteReturn(h);
  }finally{h.stop();}
});

test('a detail deadline returns even when its list never appears',async()=>{
  const h=harness({missingRegionA:true,detailTimeoutMs:4500});
  try{
    await h.advance(12);
    assert.ok(h.events.includes('back'));
    assertAckedIncompleteReturn(h);
    const report=h.messages.filter(m=>m.type==='chain'&&m.chain.rootId==='/@sample/post/A1').at(-1);
    assert.equal(report.chain.status,'incomplete');
    assert.match(report.chain.reason,/시간 상한/);
    assert.ok(h.events.includes('open:B'));
  }finally{h.stop();}
});

test('the absolute detail deadline is independent of repeated snapshot mutations',async()=>{
  const h=harness({total:2,missing:2,mutateDetailSnapshots:true,detailTimeoutMs:4500});
  try{
    await h.advance(75);
    const report=h.messages.filter(m=>m.type==='chain'&&m.chain.rootId==='/@sample/post/A1').at(-1);
    assert.equal(report.chain.status,'incomplete');
    assert.match(report.chain.reason,/시간 상한/);
    assert.ok(h.events.includes('back'));
    assertAckedIncompleteReturn(h);
  }finally{h.stop();}
});

test('reply expansion is rate limited and cannot postpone the no-progress return',async()=>{
  const h=harness({total:2,missing:2,expandUnrelatedReplies:true});
  try{
    await h.advance(450);
    assert.ok(h.expansionTimes.length>1);
    for(let i=1;i<h.expansionTimes.length;i++)assert.ok(h.expansionTimes[i]-h.expansionTimes[i-1]>=1500,'DOM mutations must not accelerate reply clicks');
    assert.ok(h.events.includes('back'));
    assertAckedIncompleteReturn(h);
    const report=h.messages.filter(m=>m.type==='chain'&&m.chain.rootId==='/@sample/post/A1').at(-1);
    assert.equal(report.chain.status,'incomplete');
  }finally{h.stop();}
});

test('a profile 2/2 group ending in a media-only part is saved without opening it, then another root is visited',async()=>{
  const h=harness({total:2,profileCompleteA:true,imageInProfileA:true,mediaOnlySecondA:true});
  try{
    await h.advance(15);
    const report=h.messages.find(m=>m.type==='chain'&&m.chain.rootId==='/@sample/post/A1'&&m.chain.status==='complete');
    assert.ok(report);
    assert.deepEqual(report.chain.members.map(member=>member.part),[1,2]);
    assert.equal(report.chain.completedFrom,'profile');
    const root=h.messages.find(message=>message.type==='snapshot').page.cards[0];
    assert.deepEqual(root.issues,[]);
    assert.deepEqual(root.notes.map(note=>note.type),['image','location']);
    const second=h.messages.find(message=>message.type==='snapshot').page.cards.find(card=>card.id==='/@sample/post/A2');
    assert.equal(second.text,'');
    assert.deepEqual(second.issues,[]);
    assert.deepEqual(second.notes.map(note=>note.type),['image']);
    assert.ok(!h.events.includes('open:A'));
    assert.ok(h.events.includes('open:B'));
  }finally{h.stop();}
});

test('new numbered bodies do not reset the absolute detail deadline',async()=>{
  const h=harness({total:20,progressiveDetailA:true,detailTimeoutMs:4500});
  try{
    await h.advance(20);
    const report=h.messages.filter(message=>message.type==='chain'&&message.chain.rootId==='/@sample/post/A1').at(-1);
    assert.ok(report.chain.members.length>1&&report.chain.members.length<20);
    assert.equal(report.chain.status,'incomplete');
    assert.match(report.chain.reason,/시간 상한/);
    assert.ok(h.events.includes('back'));
    assertAckedIncompleteReturn(h);
  }finally{h.stop();}
});

test('reinjecting from a detail checkpoint preserves the original per-detail deadline',async()=>{
  const h=harness({total:2,missing:2,detailTimeoutMs:4500});
  try{
    await h.advance(2);
    const before=h.messages.filter(message=>message.type==='checkpoint'&&message.navigation.mode==='detail').at(-1).navigation.detailStartedAt;
    assert.equal(before,2500,'the profile look-ahead occurs before the detail deadline starts');
    h.reload();await h.advance(3);
    const report=h.messages.filter(message=>message.type==='chain'&&message.chain.rootId==='/@sample/post/A1').at(-1);
    assert.equal(report.chain.status,'incomplete');
    assert.match(report.chain.reason,/시간 상한/);
    assert.ok(h.events.includes('back'));
    assertAckedIncompleteReturn(h);
  }finally{h.stop();}
});

test('a profile-complete chain downgraded by storage is attempted in detail with normalized state',async()=>{
  const h=harness({total:2,profileCompleteA:true,downgradeProfileCompleteA:true});
  try{
    await h.advance(15);
    assert.equal(h.events.filter(event=>event==='open:A').length,1);
    const opening=h.messages.find(message=>message.type==='checkpoint'&&message.navigation.mode==='opening'&&message.navigation.activeChain.rootId==='/@sample/post/A1');
    assert.equal(opening.navigation.activeChain.status,'incomplete');
    assert.deepEqual(opening.navigation.activeChain.missing,[2]);
    assert.equal(opening.navigation.activeChain.reason,'저장된 2번 본문 검증 실패');
    assert.equal(opening.navigation.activeChain.completedFrom,undefined,'a detail retry must not claim it was captured only on the profile');
    assert.ok(h.events.includes('open:B'));
  }finally{h.stop();}
});

test('a detail-complete chain downgraded by storage returns with the normalized missing part and reason',async()=>{
  const h=harness({total:2,downgradeDetailCompleteA:true});
  try{
    await h.advance(15);
    const returning=h.messages.find(message=>message.type==='checkpoint'&&message.navigation.mode==='returning'&&message.navigation.activeChain.rootId==='/@sample/post/A1');
    assert.equal(returning.navigation.activeChain.status,'incomplete');
    assert.deepEqual(returning.navigation.activeChain.missing,[2]);
    assert.equal(returning.navigation.activeChain.reason,'저장된 2번 본문 검증 실패');
    assert.equal(h.events.filter(event=>event==='open:A').length,1);
    assertAckedIncompleteReturn(h);
    assert.ok(h.events.includes('open:B'));
  }finally{h.stop();}
});
