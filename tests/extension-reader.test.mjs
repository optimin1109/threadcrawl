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
