import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {CaptureStore} from '../browser-extension/storage.mjs';

const source = name => readFileSync(new URL(`../browser-extension/${name}`, import.meta.url), 'utf8');
const timestamp = '2026-09-19T04:00:00Z';
const rootId = '/@sample/post/A1';
const row = part => `<div data-pressable-container="true"><a href="/@sample/post/A${part}"><time datetime="${timestamp}"></time></a><div class="x1rg5ohu"><span>${part}</span><span>/</span><span>2</span></div><div class="${part === 1 ? 'xqti54a x49hn82 xcrlgei x889kno' : 'x1xdureb xkbb5z'} x13vxnyz"><div><div class="x1a6qonq"><div><span dir="auto">확인한 ${part}번 본문</span></div></div><div><button>좋아요</button></div></div></div></div>`;
const card = part => ({id: `/@sample/post/A${part}`, timestamp, text: `확인한 ${part}번 본문`,
  label: `${part}/2`, context: 'threads', groupIds: [], issues: [], attachments: []});
const waitUntil = async predicate => {
  for (let turn = 0; turn < 200 && !predicate(); turn++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'bounded IndexedDB and content work must settle');
};

test('repair rechecks a historical missing body after storage acknowledgements retain its old member relationship', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  let dom;
  try {
    const oldIdentity = {tabId: 7, runId: 'old-run'};
    await store.start('sample', oldIdentity.tabId, oldIdentity.runId);
    await store.append({version: 2, adapter: 'threads-dom-2026-09-19', account: 'sample',
      capturedAt: timestamp, issues: [], blocked: false, cards: [
        {...card(1), text: null, issues: [{id: rootId, reason: '확인된 본문 컨테이너를 찾지 못함'}]}, card(2),
      ]}, oldIdentity);
    await store.recordChain({rootId, total: 2, status: 'incomplete', missing: [1],
      members: [1, 2].map(part => ({part, id: `/@sample/post/A${part}`}))}, oldIdentity);
    await store.finish('중단', '사용자 중지', oldIdentity);
    const [historical] = await store.getChains();
    assert.deepEqual(historical.members.map(member => member.part), [1, 2]);
    assert.deepEqual(historical.missing, [1]);

    const identity = {tabId: 7, runId: 'repair-run'};
    const navigation = {workflow: 'repair', mode: 'opening', profilePath: '/@sample',
      repairQueue: [rootId], repairIndex: 0, detailStartedAt: 1000, visitedRoots: [], resume: null,
      activeChain: {...historical, status: 'pending', members: historical.members.filter(member => !historical.missing.includes(member.part))}};
    await store.start('sample', identity.tabId, identity.runId, {navigation, startedAt: 1000});
    dom = new JSDOM(`<main data-column-scrollable role="region">${row(2)}</main>`, {
      url: `https://www.threads.com${rootId}`, runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const w = dom.window, messages = [], acknowledgements = [], events = [], timers = new Map(), inFlight = new Set();
    let now = 1000, timerId = 0, top = 0;
    w.structuredClone = structuredClone;
    w.Date.now = () => now;
    w.setTimeout = (fn, delay = 0) => {timers.set(++timerId, {fn, at: now + delay}); return timerId;};
    w.clearTimeout = id => timers.delete(id);
    const scroller = w.document.documentElement;
    Object.defineProperty(w.document, 'scrollingElement', {value: scroller});
    Object.defineProperties(scroller, {
      scrollTop: {get: () => top, set: value => {top = value;}}, clientHeight: {value: 600}, scrollHeight: {value: 4000},
    });
    scroller.scrollBy = ({top: delta}) => {top += delta;};
    w.chrome = {runtime: {onMessage: {addListener() {}, removeListener() {}}, sendMessage: raw => {
      const message = structuredClone(raw);
      messages.push(message); events.push(message.type);
      const response = (async () => {
        let result;
        if (message.type === 'snapshot') result = await store.append(message.page, identity);
        else if (message.type === 'chain') result = await store.recordChain(message.chain, identity);
        else if (message.type === 'checkpoint') result = await store.checkpoint(message.navigation, identity);
        else if (message.type === 'repair-next') result = {ok: true};
        else if (message.type === 'ended') result = await store.finish('불완전', message.reason, identity);
        else throw new Error(`Unexpected boundary message: ${message.type}`);
        acknowledgements.push({type: message.type, result: structuredClone(result)});
        events.push(`ack:${message.type}${message.type === 'chain' ? `:${result.chain.status}` : ''}`);
        return result;
      })();
      inFlight.add(response);
      response.then(() => inFlight.delete(response), () => inFlight.delete(response));
      return response;
    }}};
    w.threadsArchiveConfig = {runId: identity.runId, intervalMs: 1500, maxRounds: 1800,
      startedAt: now, navigation, chains: [historical]};
    for (const name of ['reader.js', 'chains.js', 'content.js']) w.eval(source(name));
    const readyForTick = () => inFlight.size === 0 && [...timers.values()].some(timer => timer.at < 100000);
    await waitUntil(readyForTick);
    const advance = async () => {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(next, 'the collector must schedule its next bounded tick');
      assert.ok(next[1].at < 100000, 'do not skip to the overall deadline');
      timers.delete(next[0]); now = next[1].at;
      await next[1].fn();
    };
    for (let tick = 0; tick < 2; tick++) await advance();
    const merged = acknowledgements.filter(item => item.type === 'chain');
    assert.ok(merged.length > 0, 'initial numbered observation must be stored');
    assert.ok(merged.some(({result}) => result.chain.members.some(member => member.part === 1)
      && result.chain.missing.includes(1)), 'real storage must retain the historical relationship without validating its body');
    assert.equal(messages.filter(message => message.type === 'repair-next').length, 0);
    assert.deepEqual((await store.getChains())[0].missing, [1]);

    w.document.querySelector('main').innerHTML = row(1) + row(2);
    await new Promise(resolve => setImmediate(resolve));
    await advance();
    await waitUntil(() => inFlight.size === 0 && messages.some(message => message.type === 'repair-next'));
    const capture = await store.exportCapture();
    assert.equal(capture.chains[0].status, 'complete');
    assert.deepEqual(capture.chains[0].missing, []);
    assert.deepEqual(capture.cards.find(item => item.id === rootId).issues, []);
    assert.equal(capture.cards.find(item => item.id === rootId).text, '확인한 1번 본문');
    assert.equal(messages.filter(message => message.type === 'repair-next').length, 1);
    const advancing = events.indexOf('repair-next');
    assert.deepEqual(events.slice(advancing - 4, advancing), ['chain', 'ack:chain:complete', 'checkpoint', 'ack:checkpoint']);
    assert.equal((await store.getControl()).navigation.mode, 'returning');
    assert.equal(messages.some(message => message.type === 'ended'), false);
  } finally {
    dom?.window.threadsArchiveStop?.();
    dom?.window.close();
    await store.close();
  }
});
