// User-invoked, same-tab DOM navigation. No hidden APIs, cookies or external traffic.
(() => {
  globalThis.threadsArchiveStop?.();
  const config=globalThis.threadsArchiveConfig || {};
  const {runId,maxRounds=1800,intervalMs=1500}=config;
  if(!runId)return;
  const detailTimeoutMs=Number.isFinite(config.detailTimeoutMs)&&config.detailTimeoutMs>0?config.detailTimeoutMs:120000;
  const started=Number.isFinite(config.startedAt)?config.startedAt:Date.now();
  const nav=structuredClone(config.navigation || {mode:'profile',profilePath:location.pathname,activeChain:null,resume:null,visitedRoots:[]});
  const account=nav.profilePath.match(/^\/@([a-z0-9_.]+)\/?$/i)?.[1].toLowerCase();
  const chains=globalThis.threadsArchiveChains;
  const known=new Map((config.chains || []).map(c=>[c.rootId,c]));
  nav.visitedRoots ||= [];
  let stopped=false,stopReason=null,busy=false,dirty=false,timer,deadline,scheduledAt=0,observer;
  let previous='',rounds=0,lastChange=Date.now(),nextScrollAt=0,nextExpandAt=0,transitionAt=Date.now(),detailProgressAt=Date.now();
  const expanded=new Set();
  const halt=(removeListener=false)=>{
    stopped=true;clearTimeout(timer);clearTimeout(deadline);observer?.disconnect();
    document.removeEventListener('visibilitychange',visibility);
    if(removeListener)chrome.runtime.onMessage.removeListener(listener);
  };
  const send=message=>chrome.runtime.sendMessage({...message,runId});
  async function persist(message,onSaved){
    const response=await send(message);
    if(!response?.ok){stopReason=response?.error || '저장 확인이 거절되어 중단';halt();return false;}
    onSaved?.(response);
    return !stopped;
  }
  const end=async reason=>{
    if(stopped)return;stopReason=reason;halt();
    try{await send({type:'ended',reason});}catch{/* A terminal ping remains available to avoid automatic revival. */}
  };
  const listener=(message,_sender,reply)=>{
    if(message.type==='ping')reply({running:!stopped,runId,reason:stopReason});
    if(message.type==='stop'&&(!message.runId||message.runId===runId)){stopReason='사용자 중지';halt();reply({ok:true});}
  };
  globalThis.threadsArchiveStop=()=>halt(true);
  chrome.runtime.onMessage.addListener(listener);
  const schedule=delay=>{
    if(stopped)return;const at=Date.now()+delay;
    if(timer!==undefined&&scheduledAt<=at)return;
    clearTimeout(timer);scheduledAt=at;timer=setTimeout(tick,delay);
  };
  const visibility=()=>{lastChange=detailProgressAt=transitionAt=Date.now();if(!busy)schedule(0);};
  document.addEventListener('visibilitychange',visibility);
  const checkpoint=()=>persist({type:'checkpoint',navigation:structuredClone(nav)});
  async function canAct(path){
    if(stopped)return false;
    const reason=threadsArchiveBlockReason();
    if(reason){await end(reason);return false;}
    if(location.pathname!==path){await end('저장 대기 중 다른 페이지로 이동하여 중단');return false;}
    return true;
  }
  const findLink=id=>[...(threadsArchiveRegion()?.querySelectorAll('time[datetime]') || [])]
    .map(t=>t.closest('a')).find(a=>a?.getAttribute('href')?.split('?')[0]===id);
  async function saveChain(chain){
    return persist({type:'chain',chain},response=>{
      const saved=structuredClone(response.chain || chain);
      known.set(saved.rootId,saved);
      if(nav.activeChain?.rootId===saved.rootId)nav.activeChain=saved;
    });
  }
  async function returnToProfile(reason){
    if(reason){nav.activeChain.status='incomplete';nav.activeChain.reason=reason;}
    if(!await saveChain(nav.activeChain))return;
    if(!nav.visitedRoots.includes(nav.activeChain.rootId))nav.visitedRoots.push(nav.activeChain.rootId);
    nav.mode='returning';transitionAt=Date.now();
    if(!await checkpoint())return;
    if(!await canAct(nav.activeChain.rootId))return;
    const back=[...document.querySelectorAll('button,[role="button"]')].find(el=>
      !el.closest('[data-pressable-container]')&&threadsArchiveVisible(el)&&/^(돌아가기|Back|Go back)$/.test((el.getAttribute('aria-label')||el.textContent).trim()));
    if(!back){await end('연속글을 저장했지만 프로필 돌아가기 버튼을 찾지 못함. 프로필에서 다시 시작하세요.');return;}
    back.click();schedule(intervalMs);
  }
  function expandReplies(){
    const region=threadsArchiveRegion();
    const pattern=/^(답글(?:\s*\d+\s*개)? 더 보기|이전 답글 보기|View (?:\d+ )?more repl(?:y|ies)|View replies|See more replies)$/i;
    for(const el of region?.querySelectorAll('button,[role="button"],a') || []) {
      if(!threadsArchiveVisible(el)||!pattern.test(el.textContent.trim()))continue;
      if(el.tagName==='A'&&el.getAttribute('href')&&!['#',location.pathname].includes(el.getAttribute('href')))continue;
      const row=el.closest('[data-pressable-container="true"]');
      const ownerId=row?.querySelector('time')?.closest('a')?.getAttribute('href');
      if(row&&!ownerId?.startsWith(`/@${account}/post/`))continue;
      const key=JSON.stringify([ownerId,el.textContent,nav.activeChain.members]);
      if(expanded.has(key))continue;
      expanded.add(key);nextExpandAt=Date.now()+intervalMs;el.click();return true;
    }
    return false;
  }
  async function tick(){
    if(stopped||busy)return;
    busy=true;dirty=false;clearTimeout(timer);timer=undefined;
    try{
      if(Date.now()-started>=maxRounds*intervalMs||rounds>=maxRounds){await end('자동 탐색 상한 도달. 전체 범위 미확인');return;}
      if(document.hidden){lastChange=detailProgressAt=transitionAt=Date.now();schedule(2000);return;}
      const blockedReason=threadsArchiveBlockReason();
      if(blockedReason){await end(blockedReason);return;}
      const path=location.pathname;
      const expected=nav.activeChain?.rootId;
      if(path!==nav.profilePath&&path!==expected){await end('대상 프로필·연속글 밖으로 이동하여 중단');return;}
      if(nav.mode==='opening'){
        if(path===expected){nav.mode='detail';detailProgressAt=Date.now();if(!Number.isFinite(nav.detailStartedAt))nav.detailStartedAt=Date.now();if(!await checkpoint())return;}
        else{
          if(Date.now()-transitionAt>15000){nav.activeChain.status='incomplete';nav.activeChain.reason='상세 화면이 열리지 않음';if(!await saveChain(nav.activeChain))return;nav.visitedRoots.push(expected);nav.activeChain=null;nav.mode='profile';if(!await checkpoint())return;}
          else{schedule(intervalMs);return;}
        }
      }
      if(nav.mode==='returning'){
        if(path!==nav.profilePath){if(Date.now()-transitionAt>15000)await end('프로필 복귀를 확인하지 못함. 저장한 글은 유지됩니다.');else schedule(intervalMs);return;}
        const scroller=threadsArchiveScroller();
        if(!threadsArchiveRegion()||!scroller){
          if(Date.now()-transitionAt>30000)await end('프로필 복귀 후 목록이 로딩되지 않음. 저장한 글은 유지됩니다.');
          else schedule(intervalMs);return;
        }
        const anchor=findLink(nav.resume?.anchorId);
        const top=anchor&&Number.isFinite(nav.resume?.anchorOffset)
          ?scroller.scrollTop+anchor.getBoundingClientRect().top-nav.resume.anchorOffset:nav.resume?.top;
        if(Number.isFinite(top))scroller.scrollTo({top:Math.max(0,top),behavior:'instant'});
        nav.mode='profile';nav.activeChain=null;nav.resume=null;nav.detailStartedAt=null;lastChange=Date.now();
        if(!await checkpoint())return;schedule(intervalMs);return;
      }
      if(nav.mode==='detail'){
        if(!Number.isFinite(nav.detailStartedAt))nav.detailStartedAt=Date.now();
        if(Date.now()-nav.detailStartedAt>=detailTimeoutMs){
          await returnToProfile(`상세 화면 시간 상한 도달. 빠진 순번: ${nav.activeChain.missing.join(', ')}`);return;
        }
      }
      // During same-origin reload, wait for the expected view to render before parsing it.
      if(!threadsArchiveRegion()){
        if(nav.mode==='detail'&&Date.now()-detailProgressAt>=30000)await returnToProfile(`상세 목록을 확인하지 못함. 빠진 순번: ${nav.activeChain.missing.join(', ')}`);
        else if(Date.now()-lastChange>30000)await end('활성 목록 로딩을 확인하지 못함. 저장한 글은 유지됩니다.');
        else schedule(intervalMs);return;
      }
      const page=readThreadsPage({account,detailRoot:nav.mode==='detail'?expected:undefined});
      const signature=JSON.stringify([page.page,page.cards,page.issues,page.blocked]);
      if(signature!==previous){
        if(!await persist({type:'snapshot',page}))return;
        previous=signature;lastChange=Date.now();
      }
      if(stopped||page.blocked){halt();return;}
      const lateBlock=threadsArchiveBlockReason();
      if(lateBlock){await end(lateBlock);return;}
      if(location.pathname!==path){
        if(location.pathname!==nav.profilePath&&location.pathname!==nav.activeChain?.rootId)await end('대상 프로필·연속글 밖으로 이동하여 중단');
        else schedule(75);return;
      }
      if(nav.mode==='detail'){
        const updated=chains.observe(nav.activeChain,page);
        const fields=c=>JSON.stringify([c.members,c.missing,c.conflicts,c.status]);
        if(fields(updated)!==fields(nav.activeChain)){
          const previousMembers=new Set(nav.activeChain.members.map(member=>`${member.part}:${member.id}`));
          if(updated.members.some(member=>!previousMembers.has(`${member.part}:${member.id}`)))detailProgressAt=Date.now();
          nav.activeChain=updated;
          if(updated.status!=='complete'&&!await saveChain(updated))return;
          if(!await checkpoint())return;
        }
        if(nav.activeChain.status==='complete'){await returnToProfile();return;}
        if(nav.activeChain.conflicts?.length){await returnToProfile('같은 순번의 게시물이 여러 개여서 연속글 완성을 확정할 수 없음');return;}
        if(Date.now()-detailProgressAt>=30000){await returnToProfile(`추가 본문을 확인하지 못함. 빠진 순번: ${nav.activeChain.missing.join(', ')}`);return;}
        if(dirty){schedule(75);return;}
        if(!await canAct(path))return;
        if(Date.now()>=nextExpandAt&&expandReplies()){schedule(intervalMs);return;}
      } else {
        const candidates=chains?.candidates(page,[...known.values()]) || [];
        for(let index=0;index<candidates.length;index++){
          if(candidates[index].status!=='complete')continue;
          if(!await saveChain(candidates[index])||!await canAct(path))return;
          candidates[index]=known.get(candidates[index].rootId);
        }
        if(dirty){schedule(75);return;}
        const candidate=candidates.find(chain=>chain.status!=='complete'&&!nav.visitedRoots.includes(chain.rootId));
        if(candidate){
          const link=findLink(candidate.rootId),scroller=threadsArchiveScroller();
          if(!link||!scroller){candidate.status='incomplete';candidate.reason='상세 화면 링크를 찾지 못함';nav.visitedRoots.push(candidate.rootId);if(!await saveChain(candidate))return;}
          else{
            nav.resume={top:scroller.scrollTop,anchorId:candidate.rootId,anchorOffset:link.getBoundingClientRect().top};
            nav.activeChain=candidate;nav.mode='opening';nav.detailStartedAt=Date.now();transitionAt=Date.now();nextExpandAt=0;expanded.clear();
            delete nav.activeChain.completedFrom;
            if(!await saveChain(candidate)||!await checkpoint())return;
            if(!await canAct(nav.profilePath))return;
            link.click();schedule(intervalMs);return;
          }
        }
        if(!page.loading&&Date.now()-lastChange>=30000){await end('30초 동안 새 글 없음. 현재 목록 끝 또는 로딩 제한인지 미확인');return;}
      }
      if(Date.now()<nextScrollAt){schedule(nextScrollAt-Date.now());return;}
      if(!await canAct(path))return;
      const scroller=threadsArchiveScroller();
      if(!scroller){await end('스크롤 영역을 찾지 못함');return;}
      scroller.scrollBy({top:Math.max(1,Math.min(innerHeight,scroller.clientHeight)*0.65),behavior:'instant'});
      rounds++;nextScrollAt=Date.now()+intervalMs;schedule(intervalMs);
    }catch(error){await end(`화면 읽기 또는 저장 실패: ${error.message}. 이미 저장한 글은 내보낼 수 있음`);}
    finally{busy=false;}
  }
  observer=new MutationObserver(()=>{if(stopped)return;dirty=true;if(!busy)schedule(75);});
  observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['role','aria-modal','src']});
  deadline=setTimeout(()=>end('자동 탐색 시간 상한 도달. 전체 범위 미확인'),Math.max(0,started+maxRounds*intervalMs-Date.now()));
  tick();
})();
