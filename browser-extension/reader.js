// Read-only DOM adapter. Long-text structure observed on @hongso0921, 2026-09-19.
// No cookie/storage/network access. An unsupported structure yields an explicit issue.
function threadsArchiveVisible(node) {
  for (let current=node; current; current=current.parentElement) {
    const style=getComputedStyle(current);
    if(current.hidden || current.getAttribute('aria-hidden')==='true' || style.display==='none' || ['hidden','collapse'].includes(style.visibility)) return false;
  }
  return true;
}
function threadsArchiveRegion() {
  let regions=[...document.querySelectorAll('[data-column-scrollable][role="region"]')].filter(threadsArchiveVisible);
  if(regions.length>1) regions=regions.filter(r=>r.getBoundingClientRect().height>0);
  return regions.length===1 ? regions[0] : null;
}
function threadsArchiveScroller(region=threadsArchiveRegion()) {
  for(let current=region;current;current=current.parentElement) {
    if(current.scrollHeight>current.clientHeight+2 && /^(auto|scroll|overlay)$/.test(getComputedStyle(current).overflowY)) return current;
  }
  return document.scrollingElement;
}
function threadsArchiveBlockReason() {
  const securityWords=/^(로그인(?:하기)?|log in|sign in)$|로봇이 아닙니다|사람인지 확인|보안 확인|잠시 후 다시|try again later|verify (?:that )?you are human|unusual activity/i;
  if ([...document.querySelectorAll('button,a,[role="button"],h1,h2')].some(x=>!x.closest('[data-pressable-container]') && securityWords.test(x.textContent.trim()) && threadsArchiveVisible(x))) return '로그인/보안/대기 안내 감지: 재시도하지 않고 중단';
  if ([...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].some(threadsArchiveVisible)) return '대화상자 감지: 로그인·보안 확인 또는 다른 팝업일 수 있어 중단';
  if ([...document.querySelectorAll('input[type="password"],iframe[src*="captcha"],iframe[title*="challenge"],iframe[title*="CAPTCHA"]')].some(threadsArchiveVisible)) return '로그인 입력 또는 보안 확인 프레임 감지: 중단';
  return null;
}
function readThreadsPage(options={}) {
  const result = { version: 2, adapter: 'threads-dom-2026-09-19', account: '', capturedAt: new Date().toISOString(), page: location.pathname, cards: [], issues: [], blocked: false };
  const issue = (id, reason) => result.issues.push({ id, reason });
  const match = location.pathname.match(/^\/@([a-z0-9_.]+)(?:\/(replies|reposts)|\/post\/([A-Za-z0-9_-]+))?\/?$/i);
  const detail=Boolean(match?.[3]);
  if (location.hostname !== 'www.threads.com' || !match ||
      (options.account && options.account!==match[1].toLowerCase()) ||
      (detail && options.detailRoot!==location.pathname)) { result.blocked = true; issue(null,'대상 프로필 또는 수집기가 연 연속글 상세 화면이 아님'); return result; }
  result.account = match[1].toLowerCase();
  result.view=detail ? 'detail' : 'profile';
  result.detailRoot=detail ? options.detailRoot : null;
  const visible=threadsArchiveVisible;
  const blockedReason=threadsArchiveBlockReason();
  if(blockedReason){result.blocked=true;issue(null,blockedReason);return result;}
  const region=threadsArchiveRegion();
  if (!region) { result.blocked = true; issue(null,'활성 목록 영역이 없거나 여러 개임: DOM 구조/접근 상태 확인 필요'); return result; }
  result.loading=[...region.querySelectorAll('[aria-label],[role="progressbar"]')].some(x=>visible(x) && (x.getAttribute('role')==='progressbar' || /^(읽어들이는 중|Loading)/i.test(x.getAttribute('aria-label')||'')));
  const pathOf = t => t?.closest('a')?.getAttribute('href')?.split('?')[0] || null;
  const textOf = (node, skip) => {
    if (node === skip) return '';
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1 || ['SCRIPT','STYLE','SVG','IMG','VIDEO'].includes(node.tagName)) return '';
    if (node.tagName === 'BR') return '\n';
    return [...node.childNodes].map(c => textOf(c,skip)).join('');
  };
  for (const row of region.querySelectorAll('[data-pressable-container="true"]')) {
    const times = [...row.querySelectorAll('time[datetime]')].filter(t=>t.closest('[data-pressable-container="true"]')===row);
    if (!times.length) continue;
    const id = pathOf(times[0]);
    if (!id || !/^\/@[a-z0-9_.]+\/post\/[A-Za-z0-9_-]+$/i.test(id)) { issue(null,'게시물 식별자 구조 미확인'); continue; }
    if(detail && id.split('/')[1].toLowerCase()!==`@${result.account}`) continue;
    const card = { id, timestamp: times[0].getAttribute('datetime'), text: null, attachments: [], label: null, groupIds: [], issues: [], context: match[2] || 'threads' };
    result.cards.push(card);
    const fail = reason => card.issues.push({id,reason});
    const group = row.closest('[data-virtualized]');
    card.groupIds = group ? [...group.querySelectorAll('time[datetime]')].map(pathOf).filter(Boolean) : [];
    if (times.length !== 1 || row.querySelector('[data-pressable-container="true"]')) { fail('인용/중첩 게시물 본문 분리 미검증'); continue; }
    const bodies = row.querySelectorAll('.x1xdureb.xkbb5z.x13vxnyz, .x1xdureb.xqti54a.x13vxnyz' + (detail && id===options.detailRoot ? ', .xqti54a.x13vxnyz.x49hn82.xcrlgei.x889kno' : ''));
    if (bodies.length !== 1) { fail('확인된 본문 컨테이너를 찾지 못함'); continue; }
    const badges=[...row.querySelectorAll('.x1rg5ohu')].filter(x=>x.closest('[data-pressable-container="true"]')===row && /^\d+\/\d+$/.test(x.textContent.replace(/\s/g,'')));
    if(badges.length===1) {
      const tokens=[...badges[0].querySelectorAll('span')].map(s=>s.textContent.trim());
      if(tokens.length===3 && tokens[1]==='/') card.label=badges[0].textContent.replace(/\s/g,'');
      else fail('서비스 순번 표식 구조 미검증');
    } else if(badges.length>1) fail('서로 다른 순번 표식이 한 게시물에 있음');
    const content=bodies[0].firstElementChild;
    if(!content){fail('본문 구조 변경 또는 미디어/첨부 전용 구조 미검증');continue;}
    const siblings=[...content.children];
    const toolbar=siblings.at(-1);
    if (siblings.length<2 || !toolbar?.querySelector('[role="button"],button')) fail('본문 뒤 도구 모음 구조 미검증');
    const body=siblings[0], hasCaption=body?.classList.contains('x1a6qonq');
    const texts=[];
    if(hasCaption) for (const p of body.children) {
      const span = p.firstElementChild;
      if (p.tagName !== 'DIV' || span?.tagName !== 'SPAN' || span.getAttribute('dir') !== 'auto' || p.children.length !== 1) { fail('본문 단락/긴 첨부/펼치기 구조 미검증'); continue; }
      const markers = [...span.children].filter(x=>x.tagName==='DIV' && x.classList.contains('x1rg5ohu'));
      // Account mentions share the badge wrapper class. Preserve their text;
      // only the service's numeric marker is removed from the author's body.
      const isMention = marker => {
        const outer=marker.firstElementChild, inner=outer?.firstElementChild, link=inner?.firstElementChild, name=link?.firstElementChild;
        const href=link?.getAttribute('href'), account=href?.match(/^\/@([A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?)$/)?.[1];
        return marker.childElementCount===1 && outer?.matches('span.xjp7ctv') && outer.childElementCount===1 &&
          inner?.tagName==='DIV' && inner.childElementCount===1 && link?.matches('a[role="link"][tabindex="0"]') &&
          link.childElementCount===1 && name?.matches('span[translate="no"]') && name.childElementCount===0 &&
          account && name.textContent===`@${account}` && marker.textContent===name.textContent &&
          !marker.querySelector('button,[role="button"],img,video,time,input,iframe,[contenteditable]');
      };
      const numeric=markers.filter(marker=>/^\d+\/\d+$/.test(marker.textContent.replace(/\s/g,'')));
      if(numeric.length>1 || markers.some(marker=>!numeric.includes(marker)&&!isMention(marker))) {
        fail('서비스 순번 표식 구조 미검증'); continue;
      }
      const badge = numeric[0];
      if (badge) {
        const label = badge.textContent.replace(/\s/g,'');
        const tokens = [...badge.querySelectorAll('span')].map(s=>s.textContent.trim());
        if (!/^\d+\/\d+$/.test(label) || tokens.length!==3 || tokens[1]!=='/' || (card.label && card.label!==label)) { fail('서비스 순번 표식 구조 미검증'); continue; }
        card.label=label;
      }
      if (span.querySelector('[role="button"],button, time')) { fail('펼치기 또는 중첩 콘텐츠가 포함된 본문'); continue; }
      texts.push(textOf(span,badge).replace(badge ? /\u00a0$/ : /$^/,'').replace(/\r\n?/g,'\n'));
    }
    card.text=texts.join('\n');
    // Attachments are siblings of the optional caption. Numbered media-only
    // posts are valid empty-text parts when every visible image links back to
    // that same post's media surface.
    for (const extra of siblings.slice(hasCaption ? 1 : 0, -1)) {
      const unavailable=extra.querySelector(':scope > div > span[dir="auto"]');
      if(extra.matches('div.x9f619.xh8yej3.x1c1uobl.xyri2b.x14vqqas') &&
          !extra.matches('[role],[tabindex],[contenteditable]') && !extra.querySelector('[role],[tabindex],[contenteditable]') &&
          extra.querySelectorAll('*').length===2 &&
          unavailable?.childElementCount===0 && unavailable.textContent.trim()==='이용할 수 없는 게시물' &&
          extra.textContent.trim()===unavailable.textContent.trim()) {
        (card.notes ??= []).push({type:'unavailable-content',text:unavailable.textContent.trim()});
        continue;
      }
      const links=[...extra.querySelectorAll('a[href]')];
      const link=links.length===1 ? links[0] : null;
      const href=link?.getAttribute('href');
      const spans=link ? [...link.querySelectorAll('span[dir="auto"]')] : [];
      // The observed UI uses one full text span and a separate localized expansion label.
      // Never strip a suffix from the author's text or follow a different post's media link.
      const validHref=href===`${id}/media` || href===`https://www.threads.com${id}/media`;
      // Observed photo + location siblings are not missing text. Keep their
      // presence separately without downloading media or treating alt text as OCR.
      const imageLinks=links.length>0 && links.every(item=>{
        const itemHref=item.getAttribute('href');
        return (itemHref===`${id}/media` || itemHref===`https://www.threads.com${id}/media`) && item.querySelector('img');
      });
      // The observed multi-photo layout has photo buttons instead of media
      // links. Accept its picture-backed controls and empty panorama button only.
      const photos=[...extra.querySelectorAll('picture > img')];
      const photoButton=node=>node?.matches('div[role="button"][tabindex="0"]') &&
        node.querySelectorAll('img').length===1 && node.querySelector('picture > img');
      const photoButtons=photos.length>1 && extra.querySelectorAll('img').length===photos.length &&
        !extra.matches('button,[role="button"],a') && !extra.textContent.trim() &&
        !extra.querySelector('a,video,audio,input,textarea,select,iframe,canvas,object,embed,time,[data-pressable-container]') &&
        photos.every(photo=>photoButton(photo.closest('[role="button"]')) && extra.contains(photo.closest('[role="button"]'))) &&
        [...extra.querySelectorAll('button,[role="button"]')].every(control=>photoButton(control) ||
          (control.tagName==='BUTTON' && control.getAttribute('aria-label')==='미디어를 파노라마로 결합' &&
            control.childElementCount===0));
      if(photoButtons || (imageLinks && !extra.textContent.trim() &&
          !extra.querySelector('video,button,[role="button"],time'))) {
        if(!(card.notes || []).some(note=>note.type==='image'))
          (card.notes ??= []).push({type:'image',url:`https://www.threads.com${id}/media`});
        continue;
      }
      // Observed inline video: retain its presence, not the CDN source, audio
      // or captions. Unknown controls or extra text still need verification.
      const videoFrame=extra.firstElementChild;
      if(extra.tagName==='DIV' && extra.childElementCount===1 &&
          videoFrame?.matches('div.x78zum5.xdt5ytf.x1xmf6yo.xf68679') &&
          extra.querySelectorAll('video').length===1 && extra.querySelector('video[playsinline]') &&
          extra.querySelectorAll('[aria-label="Video player"][role="group"]').length===1 &&
          !extra.textContent.trim() && !extra.matches('[role],[tabindex],[contenteditable]') &&
          [...extra.querySelectorAll('*')].every(node=>['DIV','SPAN','IMG','VIDEO'].includes(node.tagName)) &&
          !extra.querySelector('[tabindex],[contenteditable],[data-pressable-container]') &&
          [...extra.querySelectorAll('[role]')].every(node=>node.matches('[aria-label="Video player"][role="group"],div[role="presentation"]'))) {
        (card.notes ??= []).push({type:'video',url:`https://www.threads.com${id}`});
        continue;
      }
      if(href?.startsWith('/search?') && !extra.querySelector('img,video,button,[role="button"],time')) {
        const locationUrl=new URL(href,location.origin);
        if(/^\d+$/.test(locationUrl.searchParams.get('location_id') || '') &&
            locationUrl.searchParams.get('serp_type')==='location_tag' &&
            link.textContent.trim() && extra.textContent.trim()===link.textContent.trim()) {
          (card.notes ??= []).push({type:'location',text:link.textContent.trim()});
          continue;
        }
      }
      // Preserve the visible preview metadata, not the linked article or CDN
      // image. Decode only the observed Threads redirect without following it.
      const previewBody=link?.firstElementChild;
      const previewParts=[...(previewBody?.children || [])];
      const previewText=previewParts.at(-1), metadata=previewText?.firstElementChild;
      const [domainRow,titleRow]=metadata?.children || [];
      const domainSpan=domainRow?.querySelector(':scope > span[dir="auto"][translate="no"]');
      const titleSpan=titleRow?.querySelector(':scope > span[dir="auto"]');
      const plainSpan=span=>span?.childElementCount===1 && span.firstElementChild.tagName==='SPAN' &&
        span.firstElementChild.childElementCount===0 && span.textContent===span.firstElementChild.textContent;
      const icon=domainRow?.firstElementChild;
      const siteIcon=icon?.matches('div.x14hiurz.xr9e8f9.x1e4oeot.x1ui04y5.x6en5u8.x2lah0s') &&
        icon.childElementCount===1 && icon.firstElementChild.tagName==='IMG' && !icon.textContent.trim();
      const previewShape=extra.matches('div.x1e56ztr.xw7yly9.x1j9u4d2') && extra.childElementCount===1 &&
        link===extra.firstElementChild && extra.querySelectorAll('a').length===1 &&
        link.matches('a[role="link"][tabindex="0"][target="_blank"]') &&
        ['nofollow','noreferrer'].every(token=>link.relList.contains(token)) && link.childElementCount===1 &&
        previewBody?.tagName==='DIV' && (previewParts.length===1 ||
          (previewParts.length===2 && previewParts[0].tagName==='IMG')) &&
        previewText?.tagName==='DIV' && previewText.childElementCount===1 && metadata?.matches('div.xcrlgei') &&
        metadata.childElementCount===2 && domainRow?.tagName==='DIV' && domainRow.childElementCount===2 &&
        (icon?.tagName.toLowerCase()==='svg' || siteIcon) && domainRow.lastElementChild===domainSpan &&
        titleRow?.matches('div.x1gslohp') && titleRow.childElementCount===1 && plainSpan(domainSpan) && plainSpan(titleSpan) &&
        domainSpan.textContent.trim() && titleSpan.textContent.trim() &&
        extra.textContent.replace(/\s/g,'')===(domainSpan.textContent+titleSpan.textContent).replace(/\s/g,'') &&
        !extra.matches('[role],[tabindex],[contenteditable]') && !extra.querySelector('[contenteditable]') &&
        [...extra.querySelectorAll('[role],[tabindex]')].every(control=>control===link) &&
        !extra.querySelector('button,[role="button"],video,audio,input,textarea,select,iframe,object,embed,canvas,time,[data-pressable-container]');
      if(previewShape && /^https?:\/\//i.test(href) && !/[\u0000-\u0020\u007f-\u009f\\]/.test(href)) {
        let destination=null;
        try {
          const redirect=new URL(href), raw=redirect.searchParams.get('u');
          if(redirect.origin==='https://l.threads.com' && redirect.pathname==='/' &&
              !redirect.username && !redirect.password && redirect.searchParams.getAll('u').length===1 &&
              /^https?:\/\//i.test(raw || '') && !/[\u0000-\u0020\u007f-\u009f\\]/.test(raw)) {
            const url=new URL(raw);
            if(['http:','https:'].includes(url.protocol) && !url.username && !url.password) destination=url.href;
          }
        } catch { /* Unsupported URLs remain an explicit attachment issue. */ }
        if(destination) {
          (card.notes ??= []).push({type:'link-preview',url:destination,domain:domainSpan.textContent.trim(),title:titleSpan.textContent.trim()});
          continue;
        }
      }
      const shortText=spans.length===1 && link?.firstElementChild?.matches('div.x78zum5.xdt5ytf.x1n2onr6.x1o1r8g3') &&
        spans[0].parentElement.matches('div.x78zum5.xdt5ytf.x1n2onr6') &&
        extra.textContent===spans[0].textContent &&
        !extra.querySelector('a a,input,iframe,audio,[contenteditable],[data-pressable-container]');
      const expandedLabel=spans.length===2 && /^(더 보기|See more|See More|View more)$/.test(spans[1].textContent.trim());
      if (!validHref || !(shortText || expandedLabel) || !spans[0].querySelector('span') ||
          link.querySelector('img,video,button,[role="button"],time')) {
        fail('첨부/설문/본문 뒤 구조 미검증'); continue;
      }
      const text=textOf(spans[0]).replace(/\r\n?/g,'\n');
      if (!text.trim()) { fail('긴 첨부 본문이 비어 있음'); continue; }
      card.attachments.push({type:'long-text',url:`https://www.threads.com${id}/media`,text,source:'profile-dom'});
    }
    if(!hasCaption && !(card.notes || []).some(note=>['image','video'].includes(note.type))) fail('본문 구조 변경 또는 미디어/첨부 전용 구조 미검증');
  }
  result.virtualizedPlaceholders = region.querySelectorAll('[data-virtualized="true"]').length;
  if (!result.cards.length && !result.issues.length) issue(null,'읽을 수 있는 게시물 없음: 빈 계정 또는 접근/로딩 상태 미확인');
  return result;
}
