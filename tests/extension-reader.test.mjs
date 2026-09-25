import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../browser-extension/reader.js', import.meta.url), 'utf8');
const id = '/@sample/post/ABC123';
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
function read(extra = '', caption = '소개글', url = 'https://www.threads.com/@sample', outside = '', bodyClass = 'xkbb5z') {
  const dom = new JSDOM(`<main data-column-scrollable role="region"><div data-virtualized><div data-pressable-container="true"><a href="${id}"><time datetime="2026-09-19T04:00:00Z"></time></a><div class="x1xdureb xkbb5z x13vxnyz"><div><div class="x1a6qonq"><div><span dir="auto">${caption}</span></div></div>${extra}<div><div role="button">좋아요</div></div></div></div></div></div></main>`, {url, runScripts: 'outside-only'});
  dom.window.document.body.insertAdjacentHTML('beforeend', outside);
  dom.window.document.querySelector('.xkbb5z').classList.replace('xkbb5z', bodyClass);
  dom.window.eval(source);
  const page = JSON.parse(JSON.stringify(dom.window.readThreadsPage()));
  dom.window.close();
  return page;
}
const attachment = (text, path = id) => `<div><a href="${path}/media"><div><div><div><span dir="auto"><span style="-webkit-line-clamp:6"><span>${escape(text)}</span></span></span><span dir="auto">더 보기</span></div></div></div><div role="none"></div></a></div>`;
const photoButton = '<div role="button" tabindex="0"><div><picture><img alt=""></picture></div></div>';
const panoramaButton = '<button aria-label="미디어를 파노라마로 결합" type="button"></button>';
const photoCarousel = `<div><div>${photoButton}</div>${panoramaButton}<div>${photoButton}</div></div>`;

test('keeps the whole long attachment, whitespace and caption independently', () => {
  const long = '첫 문단\n\n' + '긴 글 😀 '.repeat(1500) + '\n 마지막 문장  ';
  const page = read(attachment(long));
  assert.equal(page.version, 2);
  assert.equal(page.cards[0].text, '소개글');
  assert.equal(page.cards[0].attachments[0].text, long);
  assert.equal(page.cards[0].attachments[0].url, 'https://www.threads.com/@sample/post/ABC123/media');
  assert.deepEqual(page.cards[0].issues, []);
});
test('refuses to attach text belonging to another post', () => {
  const card = read(attachment('인용된 다른 글', '/@other/post/XYZ')).cards[0];
  assert.deepEqual(card.attachments, []);
  assert.ok(card.issues.length);
});
test('retains ordinary captions and service continuation labels', () => {
  const card = read('', '후속글&nbsp;<div class="x1rg5ohu"><span>2</span><span>/</span><span>3</span></div>').cards[0];
  assert.equal(card.text, '후속글');
  assert.equal(card.label, '2/3');
  assert.deepEqual(card.attachments, []);
  assert.deepEqual(card.issues, []);
});
test('unknown extra content is reported instead of silently lost', () => {
  const card = read('<div>알 수 없는 첨부</div>').cards[0];
  assert.equal(card.text, '소개글');
  assert.ok(card.issues.length);
});

test('observed image and location siblings do not invalidate a fully read caption', () => {
  const extra=`<div><a href="${id}/media"><img alt="사진"></a></div><div class="x78zum5 x1gslohp"><a href="/search?location_id=123&amp;q=sample&amp;serp_type=location_tag">장소</a></div>`;
  const card=read(extra, '본문&nbsp;<div class="x1rg5ohu"><span>1</span><span>/</span><span>2</span></div>').cards[0];
  assert.equal(card.text,'본문');
  assert.equal(card.label,'1/2');
  assert.deepEqual(card.issues,[]);
  assert.deepEqual(card.notes,[{type:'image',url:`https://www.threads.com${id}/media`},{type:'location',text:'장소'}]);
  assert.deepEqual(card.attachments,[], 'image bytes and OCR are outside text capture');
});

test('a numbered media-only carousel is a verified empty-text part', () => {
  const dom = new JSDOM(`<main data-column-scrollable role="region"><div data-virtualized>
    <div data-pressable-container="true">
      <a href="${id}"><time datetime="2026-09-19T04:00:00Z"></time></a>
      <div class="x1rg5ohu"><span>2</span><span>/</span><span>2</span></div>
      <div class="x1xdureb xkbb5z x13vxnyz"><div>
        <div><a href="${id}/media"><img alt="첫 사진"></a><a href="${id}/media"><img alt="둘째 사진"></a><a href="${id}/media"><img alt="셋째 사진"></a></div>
        <div><button>좋아요</button></div>
      </div></div>
    </div>
  </div></main>`, {url:'https://www.threads.com/@sample', runScripts:'outside-only'});
  dom.window.eval(source);
  const card = JSON.parse(JSON.stringify(dom.window.readThreadsPage())).cards[0];
  dom.window.close();
  assert.equal(card.label, '2/2');
  assert.equal(card.text, '');
  assert.deepEqual(card.issues, []);
  assert.deepEqual(card.notes, [{type:'image', url:`https://www.threads.com${id}/media`}]);
  assert.deepEqual(card.attachments, []);
});

test('observed photo-button carousel preserves a numbered caption without image links', () => {
  const card = read(photoCarousel, '사진 설명&nbsp;<div class="x1rg5ohu"><span>1</span><span>/</span><span>2</span></div>').cards[0];
  assert.equal(card.text, '사진 설명');
  assert.equal(card.label, '1/2');
  assert.deepEqual(card.issues, []);
  assert.deepEqual(card.notes, [{type:'image', url:'https://www.threads.com/@sample/post/ABC123/media'}]);
  assert.deepEqual(card.attachments, []);
});

test('observed photo-button carousel verifies a media-only 2/2 even with empty image alt text', () => {
  const dom = new JSDOM(`<main data-column-scrollable role="region"><div data-virtualized>
    <div data-pressable-container="true">
      <a href="${id}"><time datetime="2026-09-19T04:00:00Z"></time></a>
      <div class="x1rg5ohu"><span>2</span><span>/</span><span>2</span></div>
      <div class="x1xdureb xqti54a x13vxnyz"><div>${photoCarousel}<div><button>좋아요</button></div></div></div>
    </div>
  </div></main>`, {url:'https://www.threads.com/@sample', runScripts:'outside-only'});
  try {
    dom.window.eval(source);
    const card = JSON.parse(JSON.stringify(dom.window.readThreadsPage())).cards[0];
    assert.equal(card.text, '');
    assert.equal(card.label, '2/2');
    assert.deepEqual(card.issues, []);
    assert.deepEqual(card.notes, [{type:'image', url:'https://www.threads.com/@sample/post/ABC123/media'}]);
    assert.deepEqual(card.attachments, []);
  } finally { dom.window.close(); }
});

test('photo buttons never mask unknown controls, text, video, links, or a nested post', () => {
  for (const extra of [
    photoCarousel.replace(panoramaButton, '<button aria-label="알 수 없는 동작"><svg></svg></button>'),
    photoCarousel.replace(panoramaButton, '<div role="button" tabindex="0" aria-label="알 수 없는 동작"></div>'),
    photoCarousel.replace(panoramaButton, '<button aria-label="미디어를 파노라마로 결합">추가 본문</button>'),
    photoCarousel.replace(panoramaButton, '<button aria-label="미디어를 파노라마로 결합"><div></div></button>'),
    photoCarousel.replace(panoramaButton, '<span>읽어야 하는 본문</span>'),
    photoCarousel.replace(panoramaButton, '<video></video>'),
    photoCarousel.replace(panoramaButton, '<input type="radio">'),
    photoCarousel.replace(panoramaButton, '<a href="/@other/post/Other/media"></a>'),
    photoCarousel.replace(panoramaButton, '<div data-pressable-container="true"></div>'),
    photoCarousel.replace('tabindex="0"', 'tabindex="-1"'),
    photoCarousel.replace('<picture><img alt=""></picture>', '<img alt="">'),
  ]) {
    const card = read(extra).cards[0];
    assert.ok(card.issues.length, extra);
    assert.equal(card.notes?.some(note => note.type === 'image') || false, false, extra);
  }
});

test('an image must not mask unrecognized text, another post, or a truncated long attachment', () => {
  for(const extra of [
    `<div><a href="${id}/media"><img><span dir="auto">아직 읽지 않은 글</span></a></div>`,
    '<div><a href="/@other/post/XYZ/media"><img></a></div>',
    `<div><a href="${id}/media"><img></a><div>알 수 없는 첨부 텍스트</div></div>`,
    '<div><a href="/search?q=unknown">본문일 수도 있음</a></div>',
  ]) assert.ok(read(extra).cards[0].issues.length,extra);
});
test('does not capture login pages or arbitrary URLs', () => {
  assert.equal(read('', '', 'https://example.com/@sample').blocked, true);
  assert.equal(read('', '', 'https://www.threads.com/login').blocked, true);
});
test('reads the observed alternate continuation body container', () => {
  const card = read('', '후속 본문', undefined, '', 'xqti54a').cards[0];
  assert.equal(card.text, '후속 본문');
  assert.deepEqual(card.issues, []);
});
test('hidden login and dialogs do not stop a visible profile', () => {
  const page = read('', '본문', undefined, '<div style="display:none"><button>로그인</button></div><div role="dialog" style="display:none"></div>');
  assert.equal(page.blocked, false);
  assert.equal(page.cards[0].text, '본문');
  assert.equal(read('', '', undefined, '<div role="dialog">로그인</div>').blocked, true);
});

function detailDom() {
  const badge = part => `<div class="x1rg5ohu"><span>${part}</span><span>/</span><span>12</span></div>`;
  const row = (account, part, root = false) => `<div data-pressable-container="true"><a href="/@${account}/post/P${part}"><time datetime="2026-09-19T04:00:00Z"></time></a>${root ? badge(part) : ''}<div class="${root ? 'xqti54a x49hn82 xcrlgei x889kno' : 'x1xdureb xkbb5z'} x13vxnyz"><div><div class="x1a6qonq"><div><span dir="auto">${part}편 본문${root ? '' : badge(part)}</span></div></div><div><button>좋아요</button></div></div></div></div>`;
  const dom = new JSDOM(`<div style="display:none"><main role="region" data-column-scrollable>${row('unrelated', 1)}</main></div><main role="region" data-column-scrollable>${Array.from({length:12}, (_,i)=>row('sample',i+1,i===0)).join('')}${row('outsider',3)}</main>`, {url:'https://www.threads.com/@sample/post/P1',runScripts:'outside-only'});
  dom.window.eval(source);
  return dom;
}
test('reads all twelve owner parts in the active detail region including the expanded root layout', () => {
  const dom=detailDom();
  const page=JSON.parse(JSON.stringify(dom.window.readThreadsPage({account:'sample',detailRoot:'/@sample/post/P1'})));
  assert.equal(page.blocked,false);
  assert.equal(page.view,'detail');
  assert.equal(page.detailRoot,'/@sample/post/P1');
  assert.equal(page.cards.length,12);
  assert.equal(page.cards[0].text,'1편 본문');
  assert.equal(page.cards[0].label,'1/12');
  assert.equal(page.cards[11].text,'12편 본문');
  assert.equal(page.cards[11].label,'12/12');
  assert.ok(page.cards.every(c=>c.issues.length===0 && c.context==='threads'));
  dom.window.close();
});
test('refuses a different detail post from the expected navigation checkpoint', () => {
  const dom=detailDom();
  assert.equal(dom.window.readThreadsPage({account:'sample',detailRoot:'/@sample/post/Other'}).blocked,true);
  dom.window.close();
});
test('selects a scrollable ancestor instead of a tall overflow-visible region', () => {
  const dom=new JSDOM('<section style="overflow-y:auto"><main role="region" data-column-scrollable style="overflow-y:visible"></main></section>',{url:'https://www.threads.com/@sample',runScripts:'outside-only'});
  const region=dom.window.document.querySelector('main'), parent=region.parentElement;
  for(const el of [region,parent]) {Object.defineProperty(el,'scrollHeight',{value:1200});Object.defineProperty(el,'clientHeight',{value:600});}
  dom.window.eval(source);
  assert.equal(dom.window.threadsArchiveScroller(region),parent);
  dom.window.close();
});
