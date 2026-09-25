import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {CaptureStore} from '../browser-extension/storage.mjs';

const source = name => readFileSync(new URL(`../browser-extension/${name}`, import.meta.url), 'utf8');
const id = index => `/@sample/post/P${index}`;
const badge = index => `<div class="x1rg5ohu"><span>${index % 2 + 1}</span><span>/</span><span>2</span></div>`;
const row = (index, {numbered = false, media = false, changed = false} = {}) =>
  `<div data-pressable-container="true"><a href="${id(index)}"><time datetime="2026-09-19T04:00:00Z"></time></a>` +
  '<div class="x1xdureb xkbb5z x13vxnyz"><div><div class="x1a6qonq"><div><span dir="auto">' +
  `${changed ? '새 내용' : '저장한 긴 본문'} ${index} ${'같은 본문의 다음 문장입니다. '.repeat(80)}${numbered ? badge(index) : ''}` +
  '</span></div></div>' + (media ? `<div><a href="${id(index)}/media"><img alt="사진"></a></div>` : '') +
  '<div><button>좋아요</button></div></div></div></div>';
const group = rows => `<div data-virtualized="true">${rows}</div>`;

// Unlike the short-card fixture, moving the viewport here updates scrollTop
// without requiring Threads to replace the DOM of a tall, already mounted card.
async function setup({tall = false, known = true, historicalGroup = false, historicalNotes = false, changedAt = null,
  stagnant = false, uncovered = false, newNotesAt = null, tallHeight = 2400} = {}) {
  const dom = new JSDOM('<main data-column-scrollable role="region"></main>', {
    url: 'https://www.threads.com/@sample', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window, store = new CaptureStore({indexedDB: new IDBFactory()});
  const identity = {tabId: 7, runId: 'realistic-fast'};
  let now = 1000, timerId = 0, top = 0, mounted = 0;
  const timers = new Map(), pending = new Set(), scrolls = [], acks = [];
  w.structuredClone = structuredClone;
  w.Date.now = () => now;
  w.setTimeout = (fn, delay = 0) => {timers.set(++timerId, {fn, at: now + delay}); return timerId;};
  w.clearTimeout = value => timers.delete(value);
  const mount = html => {w.document.querySelector('main').innerHTML = html;};
  const renderCurrent = index => mount(group(row(index, {numbered: historicalGroup, changed: index === changedAt, media: index === newNotesAt})));
  w.eval(source('reader.js'));
  w.eval(source('chains.js'));
  await store.start('sample', identity.tabId, identity.runId);
  if (known) {
    if (historicalGroup) {
      for (let index = 0; index < 6; index += 2) {
        mount(group(row(index, {numbered: true}) + row(index + 1, {numbered: true})));
        await store.append(structuredClone(w.readThreadsPage()), identity);
        await store.recordChain({rootId: id(index), total: 2, status: 'complete', missing: [],
          members: [{part: 1, id: id(index)}, {part: 2, id: id(index + 1)}]}, identity);
      }
    } else {
      for (let index = 0; index < 6; index++) {
        mount(group(row(index, {media: historicalNotes})));
        await store.append(structuredClone(w.readThreadsPage()), identity);
      }
    }
  }
  const baseline = await store.exportCapture();
  const knownChains = await store.getChains();
  renderCurrent(0);
  Object.defineProperty(w.document, 'scrollingElement', {value: w.document.documentElement});
  const scroller = w.document.documentElement;
  Object.defineProperties(scroller, {
    scrollTop: {get: () => top, set: value => {top = value;}},
    clientHeight: {value: 600}, scrollHeight: {value: tallHeight * 6},
  });
  const originalBounds = w.HTMLElement.prototype.getBoundingClientRect;
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    if (!this.matches('[data-pressable-container="true"]')) return originalBounds.call(this);
    const index = Number(this.querySelector('time').closest('a').getAttribute('href').match(/P(\d+)$/)[1]);
    const rowTop = (tall ? index * tallHeight : index * 390) - top;
    const height = uncovered ? 600 : tallHeight;
    return {top: rowTop, bottom: rowTop + height, height, left: 0, right: 600, width: 600};
  };
  scroller.scrollBy = ({top: delta}) => {
    const from = top;
    if (!stagnant) top = Math.min(tallHeight * 6 - 600, top + delta);
    scrolls.push({at: now, from, to: top});
    const next = tall ? Math.min(5, Math.floor(top / tallHeight)) : Math.min(5, mounted + 1);
    if (next !== mounted) {mounted = next; renderCurrent(mounted);}
  };
  w.chrome = {runtime: {onMessage: {addListener() {}, removeListener() {}}, sendMessage: message => {
    const work = (async () => {
      if (message.type === 'snapshot') {
        const result = await store.append(structuredClone(message.page), identity);
        acks.push({at: now, page: structuredClone(message.page), result});
        return result;
      }
      if (message.type === 'chain') return store.recordChain(structuredClone(message.chain), identity);
      if (message.type === 'checkpoint') return store.checkpoint(structuredClone(message.navigation), identity);
      if (message.type === 'ended') return store.finish('불완전', message.reason, identity);
      return {ok: true};
    })();
    pending.add(work); work.finally(() => pending.delete(work)); return work;
  }}};
  w.threadsArchiveConfig = {runId: identity.runId, intervalMs: 1500, maxRounds: 1800, startedAt: now,
    navigation: {mode: 'profile', profilePath: '/@sample', activeChain: null, resume: null, visitedRoots: []}, chains: knownChains};
  w.eval(source('content.js'));
  const settle = async () => {for (let index = 0; index < 6; index++) {await Promise.all([...pending]); await new Promise(setImmediate);}};
  await settle();
  const advance = async count => {
    for (let guard = 0; scrolls.length < count && guard < 100; guard++) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(next, 'collector must remain scheduled');
      timers.delete(next[0]); now = next[1].at; await next[1].fn(); await settle();
    }
    assert.ok(scrolls.length >= count, 'requested viewport count was reached');
  };
  return {scrolls, acks, baseline, advance, capture: () => store.exportCapture(),
    close: async () => {w.threadsArchiveStop(); await settle(); dom.window.close(); await store.close();}};
}

test('a tall stored card keeps the shorter interval when the viewport moves within unchanged mounted DOM', async () => {
  const h = await setup({tall: true});
  try {
    await h.advance(4);
    assert.ok(h.scrolls.every(scroll => scroll.to - scroll.from === 390), 'each viewport really advances with overlap');
    assert.equal(h.acks.length, 1, 'the same verified card stays mounted and its text does not change');
    assert.equal(h.acks[0].result.unchangedCleanPage, true);
    assert.deepEqual(h.scrolls.map(scroll => scroll.at), [1000, 1500, 2000, 2500]);
  } finally {await h.close();}
});

test('verified progress through a very tall saved card does not trigger the thirty-second idle limit', async () => {
  const h = await setup({tall: true, tallHeight: 30000});
  try {
    await h.advance(65);
    assert.equal(h.acks.length, 1, 'verified text stayed mounted throughout the movement');
    assert.equal(h.scrolls.at(-1).at, 33000, 'scrolling continues beyond thirty seconds without a new DOM signature');
    assert.ok(h.scrolls.every(scroll => scroll.to > scroll.from));
    assert.ok(h.scrolls.every(scroll => scroll.to + 600 < 30000), 'the viewport remains inside the same verified body');
    assert.equal((await h.capture()).status, '진행 중');
  } finally {await h.close();}
});

test('stationary or uncovered viewports still reach the thirty-second idle limit', async () => {
  for (const options of [{stagnant: true}, {uncovered: true}]) {
    const h = await setup({tall: true, tallHeight: 30000, ...options});
    try {
      await assert.rejects(h.advance(65), /collector must remain scheduled/);
      const capture = await h.capture();
      assert.equal(capture.status, '불완전');
      assert.match(capture.reason, /30초 동안 새 글 없음/);
      assert.ok(h.scrolls.at(-1).at <= 31000);
    } finally {await h.close();}
  }
});

test('a visible subset of an already completed group remains an unchanged stored body', async () => {
  const h = await setup({historicalGroup: true});
  try {
    await h.advance(3);
    assert.deepEqual(h.baseline.cards[0].groupIds, [id(0), id(1)]);
    assert.deepEqual(h.acks[0].page.cards[0].groupIds, [id(0)], 'only part of the old group is mounted now');
    assert.equal(h.acks[0].page.cards[0].text, h.baseline.cards[0].text);
    assert.equal(h.acks[0].result.unchangedCleanPage, true, 'historical group union must not make unchanged bodies look new');
    assert.deepEqual(h.scrolls.map(scroll => scroll.at), [1000, 1500, 2000]);
  } finally {await h.close();}
});

test('a preserved media note missing from the current rendered card does not make its saved body new', async () => {
  const h = await setup({historicalNotes: true});
  try {
    await h.advance(3);
    assert.equal(h.baseline.cards[0].notes[0].type, 'image');
    assert.equal(h.acks[0].page.cards[0].notes, undefined);
    assert.equal(h.acks[0].page.cards[0].text, h.baseline.cards[0].text);
    assert.equal(h.acks[0].result.unchangedCleanPage, true, 'preserved notes do not require an unchanged body to wait again');
    assert.deepEqual(h.scrolls.map(scroll => scroll.at), [1000, 1500, 2000]);
    assert.equal((await h.capture()).cards[0].notes[0].type, 'image', 'archive keeps the previously captured note');
  } finally {await h.close();}
});

test('an actually new tall body keeps the normal rendering interval', async () => {
  const h = await setup({tall: true, known: false});
  try {
    await h.advance(3);
    assert.equal(h.acks[0].result.unchangedCleanPage, false);
    assert.deepEqual(h.scrolls.map(scroll => scroll.at), [1000, 2500, 4000]);
  } finally {await h.close();}
});

test('a changed body at an existing ID still restores the normal interval', async () => {
  const h = await setup({changedAt: 1});
  try {
    await h.advance(2);
    assert.equal(h.acks[0].result.unchangedCleanPage, true);
    assert.equal(h.acks[1].result.unchangedCleanPage, false);
    assert.deepEqual(h.scrolls.map(scroll => scroll.at), [1000, 2500]);
    assert.match((await h.capture()).issues[0].reason, /동일 게시물/);
  } finally {await h.close();}
});

test('unchanged mounted text does not accelerate a stationary viewport or space below rendered cards', async () => {
  for (const options of [{tall: true, stagnant: true}, {tall: true, uncovered: true}]) {
    const h = await setup(options);
    try {
      await h.advance(3);
      assert.equal(h.acks[0].result.unchangedCleanPage, true);
      assert.deepEqual(h.scrolls.map(scroll => scroll.at), [1000, 2500, 4000]);
      if (options.stagnant) assert.ok(h.scrolls.every(scroll => scroll.to === scroll.from));
      else assert.ok(h.scrolls.every(scroll => scroll.to > scroll.from));
    } finally {await h.close();}
  }
});

test('new media information on a stored body restores normal timing and is saved', async () => {
  const h = await setup({newNotesAt: 1});
  try {
    await h.advance(2);
    assert.equal(h.acks[0].result.unchangedCleanPage, true);
    assert.equal(h.acks[1].result.unchangedCleanPage, false);
    assert.deepEqual(h.scrolls.map(scroll => scroll.at), [1000, 2500]);
    assert.equal((await h.capture()).cards.find(card => card.id === id(1)).notes[0].type, 'image');
  } finally {await h.close();}
});

test('a tall saved card restores normal timing when the viewport reaches beyond its rendered bottom', async () => {
  const h = await setup({tall: true});
  try {
    await h.advance(6);
    assert.deepEqual(h.scrolls.map(scroll => scroll.at), [1000, 1500, 2000, 2500, 3000, 4500]);
    assert.equal(h.scrolls[4].to, 1950, 'the next 600px viewport would extend beyond the known 2400px card');
    assert.equal(h.acks.length, 1);
  } finally {await h.close();}
});
