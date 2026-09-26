import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {exportCaptureHtml} from '../browser-extension/html-export.mjs';

const card = (part, overrides = {}) => ({id: `/@sample/post/Part${part}`, timestamp: '2026-09-18T15:00:00Z',
  text: `확보한 ${part}번 본문`, label: `${part}/3`, context: 'threads', groupIds: [], issues: [], attachments: [], ...overrides});
const chain = (cards, overrides = {}) => ({rootId: cards[0].id, total: cards.length, status: 'complete', missing: [],
  members: cards.map((item, index) => ({part: index + 1, id: item.id})), conflicts: [], ...overrides});
const capture = (cards, chains = [], overrides = {}) => ({version: 2, account: 'sample', status: '중단', reason: '사용자 중지', cards, chains, issues: [], ...overrides});
const documentOf = input => new JSDOM(exportCaptureHtml(input)).window.document;
const assertEveryCardOnce = (document, count) => {
  const indexes = [...document.querySelectorAll('[data-card-index]')].map(item => Number(item.getAttribute('data-card-index'))).sort((a, b) => a - b);
  assert.deepEqual(indexes, Array.from({length: count}, (_, index) => index));
};

test('확인된 연속글을 번호순 한 카드로 읽고 모든 원문을 한 번씩 보존한다', () => {
  const cards = [1, 2, 3].map(part => card(part));
  const input = capture([cards[2], cards[0], cards[1]], [chain(cards)]), before = structuredClone(input);
  const document = documentOf(input), groups = document.querySelectorAll('article[data-kind="chain"]');
  assert.equal(groups.length, 1);
  assert.deepEqual([...groups[0].querySelectorAll('.post-body')].map(item => item.textContent), cards.map(item => item.text));
  assert.match(groups[0].textContent, /3\/3 확보 · 완료/);
  assert.equal(groups[0].querySelectorAll('.post').length, 3);
  assert.equal(document.querySelectorAll('.post-body').length, 3);
  assert.equal(document.querySelector('.post-body').tagName, 'DIV');
  for (const item of document.querySelectorAll('.post-body')) assert.equal(item.closest('details'), null);
  assertEveryCardOnce(document, cards.length);
  assert.deepEqual(input, before);
});

test('빠진 번호를 묶음 안 제자리에 표시하며 미검증 본문과 소속 없는 번호글을 버리지 않는다', () => {
  const cards = [card(1), card(2, {text: null, issues: [{reason: '본문 미확인'}]}), card(3),
    card(2, {id: '/@sample/post/Unassigned', text: '별개 번호글', groupIds: ['/ @sample/post/Part1']})];
  const input = capture(cards, [chain(cards.slice(0, 3), {status: 'incomplete', missing: [2]})]);
  const document = documentOf(input), group = document.querySelector('article[data-kind="chain"]');
  assert.deepEqual([...group.querySelectorAll('[data-part]')].map(item => Number(item.getAttribute('data-part'))), [1, 2, 3]);
  assert.match(group.querySelector('.missing-part').textContent, /2\/3.*미확보/);
  assert.match(group.textContent, /2\/3 확보 · 미완료/);
  const unresolved = document.querySelector('[data-card-index="1"]');
  assert.match(unresolved.textContent, /본문 미확보/);
  const independent = document.querySelector('[data-card-index="3"]');
  assert.equal(independent.closest('article').getAttribute('data-kind'), 'single');
  assert.match(independent.textContent, /연결 미확인/);
  assert.equal(independent.querySelector('.post-body').textContent, '별개 번호글');
  assertEveryCardOnce(document, cards.length);
});

test('누락으로 기록된 과거 관계를 확보로 계산하거나 완료 문구로 덮어쓰지 않는다', () => {
  const cards = [card(1, {label: '1/2'}), card(2, {label: '2/2'})];
  const document = documentOf(capture(cards, [chain(cards, {missing: [1], status: 'incomplete'})]));
  const group = document.querySelector('article[data-kind="chain"]');
  assert.match(group.textContent, /1\/2 확보 · 미완료/);
  assert.match(group.querySelector('.missing-part').textContent, /1\/2.*미확보/);
  assert.equal(document.querySelector('[data-card-index="0"]').closest('article').getAttribute('data-kind'), 'single');
  assertEveryCardOnce(document, 2);
});

test('관계 충돌·다른 작성자·순번 불일치·중복 ID는 추정 병합하지 않는다', () => {
  const base = [card(1, {label: '1/2'}), card(2, {label: '2/2'})];
  for (const input of [
    capture(base, [chain(base, {conflictDetected: true})]),
    capture([base[0], {...base[1], id: '/@other/post/Part2'}], [chain([base[0], {...base[1], id: '/@other/post/Part2'}])]),
    capture([base[0], {...base[1], label: '1/2'}], [chain(base)]),
    capture([base[0], base[1], {...base[1], text: '같은 ID의 별도 보존값'}], [chain(base)]),
  ]) {
    const document = documentOf(input);
    assertEveryCardOnce(document, input.cards.length);
    assert.equal(document.querySelectorAll('article[data-kind="chain"] .post').length < 2, true);
    assert.doesNotMatch(document.querySelector('main').textContent, /2\/2 확보 · 완료/);
  }
});

test('둘 이상의 첫 글에 연결된 동일 카드를 어느 묶음에도 임의 배정하지 않는다', () => {
  const first = card(1, {label: '1/2'}), secondRoot = card(1, {id: '/@sample/post/OtherRoot', label: '1/2'}), shared = card(2, {label: '2/2'});
  const input = capture([first, shared, secondRoot], [chain([first, shared]), chain([secondRoot, shared])]);
  const document = documentOf(input);
  assertEveryCardOnce(document, 3);
  assert.equal(document.querySelector('[data-card-index="1"]').closest('article').getAttribute('data-kind'), 'single');
  assert.match(document.querySelector('[data-card-index="1"]').textContent, /연결 미확인/);
  assert.equal(document.querySelectorAll('article[data-kind="chain"] .missing-part').length, 2);
});

test('긴 첨부와 본문 공백·탭·빈 줄·CRLF를 일반 텍스트로 끝까지 표시한다', () => {
  const body = '  시작\t😀\r\n\n끝  ', longText = '긴 첨부 시작\r\n' + '가나다라 마바사 '.repeat(1500) + '\n\n끝  ';
  const input = capture([card(1, {label: null, text: body, attachments: [{type: 'long-text', url: '/@sample/post/Part1/media', source: 'profile-dom', text: longText}]}),
    card(2, {label: null, text: ''}), card(3, {label: null, text: null})]);
  const before = JSON.stringify(input), document = documentOf(input);
  assert.equal(document.querySelector('[data-card-index="0"] .post-body').textContent, body);
  assert.equal(document.querySelector('.attachment-body').textContent, longText);
  assert.equal(document.querySelector('.attachment-body').closest('details'), null);
  assert.equal(document.querySelector('[data-card-index="1"] .post-body').textContent, '');
  assert.match(document.querySelector('[data-card-index="2"]').textContent, /본문 미확보/);
  assert.match(document.querySelector('style').textContent, /white-space:\s*pre-wrap/);
  assert.equal(JSON.stringify(input), before);
  assertEveryCardOnce(document, 3);
});

test('본문과 모든 메타데이터의 HTML·이벤트·태그 탈출 문자열을 텍스트로만 표시한다', () => {
  const injected = '</style><script>bad()</script><img src=x onerror=bad()>\" onclick=bad() & <iframe src=evil></iframe>';
  const input = capture([card(1, {id: 'javascript:bad()', label: injected, text: injected, issues: [{id: injected, reason: injected}],
    notes: [{type: 'location', text: injected}, {type: 'unavailable-content', text: injected},
      {type: 'link-preview', title: injected, domain: injected, url: 'data:text/html,bad'}],
    attachments: [{type: injected, url: injected, source: injected, text: injected}]} )], [],
    {account: injected, status: injected, reason: injected, issues: [{id: injected, reason: injected}]});
  const document = documentOf(input);
  assert.equal(document.querySelector('.post-body').textContent, injected);
  assert.equal(document.querySelector('.attachment-body').textContent, injected);
  assert.equal(document.querySelectorAll('script,img,iframe,object,embed,base,link,form').length, 0);
  for (const element of document.querySelectorAll('*')) for (const attr of element.attributes)
    assert.equal(/^on/i.test(attr.name), false);
  for (const link of document.querySelectorAll('a[href]')) assert.doesNotMatch(link.getAttribute('href'), /^(?:javascript:|data:)/i);
  assert.equal(document.querySelectorAll('style').length, 1);
});

test('외부 미리보기는 안전한 HTTP 링크만 제공하고 이미지·외부 전문 미저장을 알린다', () => {
  const safe = 'https://[2001:db8::1]/article?q=a&v=(b)', unsafe = ['javascript:bad()', 'data:text/html,bad', '//example.org/article', 'https://user:pass@example.org/', 'https://example.org/\narticle'];
  const document = documentOf(capture([card(1, {label: null, notes: [
    {type: 'link-preview', url: safe, title: '보이는 제목', domain: 'example.org'},
    ...unsafe.map(url => ({type: 'link-preview', url, title: '미확인 링크', domain: 'example.org'})),
    {type: 'image', url: '/@sample/post/Part1/media'}, {type: 'unavailable-content', text: '이용할 수 없는 게시물'},
    {type: 'video', url: 'https://www.threads.com/@sample/post/Part1'},
  ]})]));
  const external = [...document.querySelectorAll('a[href]')].filter(link => link.getAttribute('href').startsWith('https://['));
  assert.equal(external.length, 1);
  assert.equal(external[0].href, safe);
  for (const link of document.querySelectorAll('a[target="_blank"]')) {
    assert.ok(link.rel.split(' ').includes('noopener')); assert.ok(link.rel.split(' ').includes('noreferrer'));
  }
  assert.match(document.body.textContent, /외부 원문 전문.*이미지.*저장하지/);
  assert.match(document.body.textContent, /이용할 수 없는 게시물/);
  assert.match(document.body.textContent, /동영상 원본·음성·자막은 저장하지 않았습니다/);
  assert.equal([...document.querySelectorAll('a')].find(link => link.textContent === '동영상 글 보기').href, 'https://www.threads.com/@sample/post/Part1');
  assert.equal(document.querySelectorAll('[src]').length, 0);
});

test('묶음은 첫 글 날짜로 오래된 순서에 놓고 날짜 미확인은 마지막에 보존한다', () => {
  const cards = [card(1, {label: '1/2', timestamp: '2026-09-19T00:00:00Z'}), card(2, {label: '2/2', timestamp: '2026-09-20T00:00:00Z'}),
    card(3, {label: null, timestamp: '2026-09-18T14:59:59Z'}), card(4, {label: null, timestamp: '2026-02-30T00:00:00Z'})];
  const document = documentOf(capture(cards, [chain(cards.slice(0, 2))]));
  assert.deepEqual([...document.querySelectorAll('main > article')].map(item => item.querySelector('[data-card-index]').getAttribute('data-card-index')), ['2', '0', '3']);
  assert.match(document.querySelector('main > article').textContent, /2026-09-18/);
  assert.match([...document.querySelectorAll('main > article')].at(-1).textContent, /날짜 미확인/);
});

test('오프라인 문서는 외부 자원과 스크립트 없이 열리고 빈 캡처도 정직하게 표시한다', () => {
  const document = documentOf(capture([]));
  assert.equal(document.querySelectorAll('main > article').length, 0);
  assert.match(document.body.textContent, /저장된 글이 없습니다/);
  const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /base-uri 'none'/);
  assert.equal(document.querySelectorAll('script,[src],link').length, 0);
  assert.match(document.body.textContent, /전체.*미검증/);
});
