// Runs only in the isolated world after the user invokes the extension action.
(() => {
  globalThis.threadsArchiveStop?.();
  const {runId, maxRounds=1800, intervalMs=1500}=globalThis.threadsArchiveConfig || {};
  if (!runId) return;
  const account=location.pathname;
  const started=Date.now();
  let stopped=false, busy=false, dirty=false, timer, deadline, scheduledAt=0, observer, previous='', rounds=0, lastChange=started, nextScrollAt=0;
  const halt=()=>{stopped=true;clearTimeout(timer);clearTimeout(deadline);observer?.disconnect();chrome.runtime.onMessage.removeListener(listener);};
  const send=message=>chrome.runtime.sendMessage({...message,runId});
  const end=async reason=>{if(stopped)return;halt();try{await send({type:'ended',reason});}catch{/* Saved cards remain in IndexedDB. */}};
  const listener=(message,_sender,reply)=>{
    if(message.type==='ping')reply({running:!stopped,runId});
    if(message.type==='stop' && (!message.runId || message.runId===runId)){halt();reply({ok:true});}
  };
  globalThis.threadsArchiveStop=halt;
  chrome.runtime.onMessage.addListener(listener);
  const schedule=delay=>{
    if(stopped)return;
    const at=Date.now()+delay;
    if(timer!==undefined && scheduledAt<=at)return;
    clearTimeout(timer);scheduledAt=at;timer=setTimeout(tick,delay);
  };
  async function tick() {
    if(stopped||busy)return;
    busy=true;dirty=false;clearTimeout(timer);timer=undefined;
    try {
      if(location.pathname!==account){await end('수집 중 다른 페이지로 이동');return;}
      const page=readThreadsPage();
      const signature=JSON.stringify([page.cards,page.issues,page.blocked]);
      if(signature!==previous){
        const response=await send({type:'snapshot',page});
        if(!response?.ok){halt();return;}
        previous=signature;lastChange=Date.now();
      }
      if(stopped)return;
      if(page.blocked){halt();return;}
      if(location.pathname!==account){await end('수집 중 다른 페이지로 이동');return;}
      // Capture a DOM update during persistence before the next scroll.
      if(rounds>=maxRounds || Date.now()-started>=maxRounds*intervalMs){await end('자동 탐색 상한 도달. 전체 범위 미확인');return;}
      if(dirty){schedule(75);return;}
      if(Date.now()-lastChange>=30000){await end('30초 동안 새 내용 없음. 실제 목록 끝 또는 로딩 제한인지 미확인');return;}
      if(Date.now()<nextScrollAt){schedule(nextScrollAt-Date.now());return;}
      const region=document.querySelector('[data-column-scrollable][role="region"]');
      const scroller=region?.scrollHeight>region?.clientHeight+2 ? region : document.scrollingElement;
      if(!scroller){await end('스크롤 영역을 찾지 못함');return;}
      scroller.scrollBy({top:Math.min(innerHeight,scroller.clientHeight)*0.65,behavior:'instant'});
      rounds++;
      nextScrollAt=Date.now()+intervalMs;
      schedule(intervalMs);
    } catch {
      await end('화면 읽기 또는 저장 통신 실패. 이미 저장한 글은 내보낼 수 있음');
    } finally {busy=false;}
  }
  observer=new MutationObserver(()=>{
    if(stopped)return;
    dirty=true;
    if(!busy)schedule(75);
  });
  observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['role','aria-modal','src']});
  deadline=setTimeout(()=>end('자동 탐색 시간 상한 도달. 전체 범위 미확인'),maxRounds*intervalMs);
  tick();
})();
