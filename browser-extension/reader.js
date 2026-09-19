// Read-only DOM adapter. Long-text structure observed on @hongso0921, 2026-09-19.
// No cookie/storage/network access. An unsupported structure yields an explicit issue.
function readThreadsPage() {
  const result = { version: 2, adapter: 'threads-dom-2026-09-19', account: '', capturedAt: new Date().toISOString(), page: location.pathname, cards: [], issues: [], blocked: false };
  const issue = (id, reason) => result.issues.push({ id, reason });
  const match = location.pathname.match(/^\/@([a-z0-9_.]+)(?:\/(replies|reposts))?\/?$/i);
  if (location.hostname !== 'www.threads.com' || !match) { result.blocked = true; issue(null,'지원 범위 밖의 페이지: 공개 계정의 스레드/답글/리포스트 목록에서만 실행'); return result; }
  result.account = match[1].toLowerCase();
  const visible = node => {
    for (let current=node; current; current=current.parentElement) {
      const style=getComputedStyle(current);
      if(current.hidden || current.getAttribute('aria-hidden')==='true' || style.display==='none' || ['hidden','collapse'].includes(style.visibility)) return false;
    }
    return true;
  };
  const securityWords=/^(로그인(?:하기)?|log in|sign in)$|로봇이 아닙니다|사람인지 확인|보안 확인|잠시 후 다시|try again later|verify (?:that )?you are human|unusual activity/i;
  if ([...document.querySelectorAll('button,a,[role="button"],h1,h2')].some(x=>!x.closest('[data-pressable-container]') && securityWords.test(x.textContent.trim()) && visible(x))) {
    result.blocked=true; issue(null,'목록 밖 로그인/보안/대기 안내 감지: 재시도하지 않고 중단'); return result;
  }
  const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter(visible);
  if (dialogs.length) { result.blocked = true; issue(null,'대화상자 감지: 로그인·보안 확인 또는 다른 팝업일 수 있어 수집 중단'); return result; }
  if ([...document.querySelectorAll('input[type="password"],iframe[src*="captcha"],iframe[title*="challenge"],iframe[title*="CAPTCHA"]')].some(visible)) {
    result.blocked = true; issue(null,'로그인 입력 또는 보안 확인 프레임 감지: 수집 중단'); return result;
  }
  const regions = document.querySelectorAll('[data-column-scrollable][role="region"]');
  if (regions.length !== 1) { result.blocked = true; issue(null,'목록 영역이 없거나 여러 개임: DOM 구조/접근 상태 확인 필요'); return result; }
  const region = regions[0];
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
    const card = { id, timestamp: times[0].getAttribute('datetime'), text: null, attachments: [], label: null, groupIds: [], issues: [], context: match[2] || 'threads' };
    result.cards.push(card);
    const fail = reason => card.issues.push({id,reason});
    const group = row.closest('[data-virtualized]');
    card.groupIds = group ? [...group.querySelectorAll('time[datetime]')].map(pathOf).filter(Boolean) : [];
    if (times.length !== 1 || row.querySelector('[data-pressable-container="true"]')) { fail('인용/중첩 게시물 본문 분리 미검증'); continue; }
    const bodies = row.querySelectorAll('.x1xdureb.xkbb5z.x13vxnyz, .x1xdureb.xqti54a.x13vxnyz');
    if (bodies.length !== 1) { fail('확인된 본문 컨테이너를 찾지 못함'); continue; }
    const body = bodies[0].firstElementChild?.firstElementChild;
    if (!body || !body.classList.contains('x1a6qonq')) { fail('본문 구조 변경 또는 미디어/첨부 전용 구조 미검증'); continue; }
    const paragraphs = [...body.children];
    const texts = [];
    for (const p of paragraphs) {
      const span = p.firstElementChild;
      if (p.tagName !== 'DIV' || span?.tagName !== 'SPAN' || span.getAttribute('dir') !== 'auto' || p.children.length !== 1) { fail('본문 단락/긴 첨부/펼치기 구조 미검증'); continue; }
      const badge = [...span.children].find(x=>x.tagName==='DIV' && x.classList.contains('x1rg5ohu'));
      if (badge) {
        const label = badge.textContent.replace(/\s/g,'');
        const tokens = [...badge.querySelectorAll('span')].map(s=>s.textContent.trim());
        if (!/^\d+\/\d+$/.test(label) || tokens.length!==3 || tokens[1]!=='/' || card.label) { fail('서비스 순번 표식 구조 미검증'); continue; }
        card.label=label;
      }
      if (span.querySelector('[role="button"],button, time')) { fail('펼치기 또는 중첩 콘텐츠가 포함된 본문'); continue; }
      texts.push(textOf(span,badge).replace(badge ? /\u00a0$/ : /$^/,'').replace(/\r\n?/g,'\n'));
    }
    card.text=texts.join('\n');
    // The attachment is a separate sibling of the caption, not part of its paragraphs.
    const siblings=[...bodies[0].firstElementChild.children];
    const toolbar=siblings.at(-1);
    if (siblings.length<2 || !toolbar?.querySelector('[role="button"]')) fail('본문 뒤 도구 모음 구조 미검증');
    for (const extra of siblings.slice(1, -1)) {
      const links=[...extra.querySelectorAll('a[href]')];
      const link=links.length===1 ? links[0] : null;
      const href=link?.getAttribute('href');
      const spans=link ? [...link.querySelectorAll('span[dir="auto"]')] : [];
      // The observed UI uses one full text span and a separate localized expansion label.
      // Never strip a suffix from the author's text or follow a different post's media link.
      const validHref=href===`${id}/media` || href===`https://www.threads.com${id}/media`;
      if (!validHref || spans.length!==2 || !spans[0].querySelector('span') ||
          !/^(더 보기|See more|See More|View more)$/.test(spans[1].textContent.trim()) ||
          link.querySelector('img,video,button,[role="button"],time')) {
        fail('첨부/설문/본문 뒤 구조 미검증'); continue;
      }
      const text=textOf(spans[0]).replace(/\r\n?/g,'\n');
      if (!text.trim()) { fail('긴 첨부 본문이 비어 있음'); continue; }
      card.attachments.push({type:'long-text',url:`https://www.threads.com${id}/media`,text,source:'profile-dom'});
    }
  }
  result.virtualizedPlaceholders = region.querySelectorAll('[data-virtualized="true"]').length;
  if (!result.cards.length && !result.issues.length) issue(null,'읽을 수 있는 게시물 없음: 빈 계정 또는 접근/로딩 상태 미확인');
  return result;
}
