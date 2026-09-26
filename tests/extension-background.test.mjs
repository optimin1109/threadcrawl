import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {CaptureStore} from '../browser-extension/storage.mjs';
import {createMessageHandler} from '../browser-extension/background.mjs';

function environment() {
  let config, connected = true, closed = false, running = true;
  const tab = {id: 7, url: 'https://www.threads.com/@tester', status: 'complete', discarded: false, frozen: false};
  const calls = [], updates = [];
  const chrome = {
    runtime: {id: 'test-extension', getURL: path => `chrome-extension://test-extension/${path}`},
    tabs: {query: async () => [tab], get: async () => {if(closed)throw new Error('No tab with id: 7');return {...tab};},
      update: async (tabId, changes) => {updates.push({tabId, ...changes});tab.pendingUrl = changes.url;tab.status = 'loading';return {...tab};}, sendMessage: async (_tab, message) => {
      if (!connected) throw new Error('tab gone');
      return message.type === 'ping' ? {running, runId: config?.runId, reason: running ? null : '시간 상한 도달'} : {ok: true};
    }},
    scripting: {executeScript: async options => {calls.push(options); if (options.args) config = options.args[0];}},
  };
  return {chrome, calls, updates, tab, arrive: () => {tab.url = tab.pendingUrl;delete tab.pendingUrl;tab.status = 'complete';}, disconnect: () => {connected = false;}, connect: () => {connected = true;}, stopContent: () => {running = false;}, close: () => {closed = true;}, config: () => config};
}
const page = {version: 2, adapter: 'threads-dom-2026-09-19', account: 'tester', capturedAt: '2026-09-19T01:00:00Z', issues: [], blocked: false,
  cards: [{id: '/@tester/post/one', timestamp: '2026-09-19T00:00:00Z', text: '확정된 글', label: null, groupIds: [], issues: [], context: 'threads', attachments: []}]};

const popupSender = {id: 'test-extension', url: 'chrome-extension://test-extension/popup.html'};

const repairPart = (root, part) => ({...page.cards[0], id: `/@tester/post/${root}${part}`, label: `${part}/2`});
const repairChain = (root, status = 'incomplete', parts = [1]) => ({rootId: `/@tester/post/${root}1`, total: 2,
  status, members: parts.map(part => ({part, id: `/@tester/post/${root}${part}`})), missing: parts.includes(2) ? [] : [2], reason: status === 'incomplete' ? '2번 미확인' : null});
async function savedRepair(store) {
  const identity = {tabId: 7, runId: 'old-run'};
  await store.start('tester', identity.tabId, identity.runId);
  await store.append({...page, cards: [repairPart('A', 1), repairPart('B', 1), repairPart('C', 1), repairPart('C', 2)]}, identity);
  for (const chain of [repairChain('A'), repairChain('B', 'pending'), repairChain('C', 'complete', [1, 2])]) await store.recordChain(chain, identity);
  await store.finish('중단', '사용자 중지', identity);
  return {type: 'repair', account: 'tester', runId: identity.runId};
}

test('미완료 재수집은 저장한 첫 글만 직접 열고 저장 확인 후 다음 글로 이동하며 프로필에서 종료한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()}), env = environment();
  let time = 1000;
  const send = createMessageHandler({store, chrome: env.chrome, now: () => time});
  try {
    const repair = await savedRepair(store);
    assert.equal((await send(repair, popupSender)).ok, true);
    assert.deepEqual(env.updates.map(item => item.url), ['https://www.threads.com/@tester/post/A1']);
    assert.equal(env.calls.length, 0, 'do not inject a detail collector into the departure profile');
    assert.equal((await send({type: 'status'})).running, true);
    const queued = (await store.getControl()).navigation;
    assert.equal(queued.workflow, 'repair'); assert.deepEqual(queued.repairQueue, ['/@tester/post/A1', '/@tester/post/B1']);
    assert.equal(queued.repairIndex, 0);
    env.arrive(); env.tab.url += '?xmt=synthetic'; await send.onUpdated(7, {status: 'complete'}, {...env.tab});
    const first = env.config();
    assert.equal(first.navigation.activeChain.rootId, '/@tester/post/A1');
    assert.equal(first.startedAt, 1000);
    const next = {type: 'repair-next', rootId: '/@tester/post/A1', runId: first.runId};
    assert.equal((await send(next, {tab: {id: 7}})).ok, false, 'a saved previous failure is not this run completion');
    await send({type: 'snapshot', runId: first.runId, page: {...page, view: 'detail', cards: [repairPart('A', 1), repairPart('A', 2)]}}, {tab: {id: 7}});
    await send({type: 'chain', runId: first.runId, chain: repairChain('A', 'complete', [1, 2])}, {tab: {id: 7}});
    await send({type: 'checkpoint', runId: first.runId, navigation: {...first.navigation, mode: 'returning'}}, {tab: {id: 7}});
    assert.equal((await send(next, {tab: {id: 8}})).ok, false);
    assert.equal((await send({...next, rootId: '/@tester/post/B1'}, {tab: {id: 7}})).ok, false);
    time = 6000;
    assert.equal((await send(next, {tab: {id: 7}})).ok, true);
    assert.equal((await send(next, {tab: {id: 7}})).ok, false, 'late duplicate must not skip B');
    assert.equal(env.updates.at(-1).url, 'https://www.threads.com/@tester/post/B1');
    const injectionCount = env.calls.length;
    await send.onUpdated(7, {status: 'complete'}, {id: 7, status: 'complete', url: 'https://www.threads.com/@tester/post/A1'});
    assert.equal(env.calls.length, injectionCount, 'old completion event cannot inject while next target is pending');
    assert.equal((await store.status()).running, true);
    env.arrive(); await send.onUpdated(7, {status: 'complete'}, {id: 7, status: 'complete', url: 'https://www.threads.com/@tester/post/A1'});
    const second = env.config();
    assert.notEqual(second.runId, first.runId); assert.equal(second.startedAt, 1000);
    assert.equal(second.navigation.activeChain.rootId, '/@tester/post/B1'); assert.equal(second.navigation.repairIndex, 1);
    await send({type: 'chain', runId: second.runId, chain: repairChain('B')}, {tab: {id: 7}});
    await send({type: 'checkpoint', runId: second.runId, navigation: {...second.navigation, mode: 'returning'}}, {tab: {id: 7}});
    assert.equal((await send({type: 'repair-next', rootId: '/@tester/post/B1', runId: second.runId}, {tab: {id: 7}})).ok, true);
    assert.equal(env.updates.at(-1).url, 'https://www.threads.com/@tester');
    assert.equal((await store.status()).running, false);
    assert.match((await store.status()).capture.reason, /미완료 글 재수집/);
    assert.equal((await store.exportCapture()).cards.length, 5);
    assert.equal((await store.getChains()).find(chain => chain.rootId.endsWith('/A1')).status, 'complete');
    env.arrive(); await send.onUpdated(7, {status: 'complete'}, {...env.tab});
    assert.equal(env.calls.length, injectionCount + 2, 'completion never starts a profile scanner');
  } finally { await store.close(); }
});

test('미완료 재수집은 확인한 멈춘 계정과 같은 계정 탭만 허용하고 임의 URL·완료 글은 큐에서 제외한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()}), env = environment();
  const send = createMessageHandler({store, chrome: env.chrome});
  try {
    const repair = await savedRepair(store);
    await assert.rejects(send(repair, {tab: {id: 7}, ...popupSender}), /확장 팝업/);
    await assert.rejects(send({...repair, account: 'other'}, popupSender), /대상이 바뀌/);
    await assert.rejects(send({...repair, runId: 'stale'}, popupSender), /대상이 바뀌/);
    for (const url of ['https://www.threads.com/', 'https://www.threads.com/@other', 'https://example.com/@tester']) {
      env.tab.url = url; await assert.rejects(send(repair, popupSender), /같은 계정/);
    }
    assert.equal(env.updates.length, 0);
    await store.transaction('readwrite', stores => {
      for (const chain of [{...repairChain('X'), rootId: '/@other/post/X1'}, {...repairChain('X'), rootId: 'https://evil.example/'}, {...repairChain('X'), total: 0}])
        stores.chains.put({account: 'tester', rootId: chain.rootId, chain});
    });
    env.tab.url = 'https://www.threads.com/@tester/post/Another';
    await send(repair, popupSender);
    assert.deepEqual((await store.getControl()).navigation.repairQueue, ['/@tester/post/A1', '/@tester/post/B1']);
    await assert.rejects(send({...repair, runId: (await store.getControl()).runId}, popupSender), /먼저 중지/);
    await send({type: 'stop'}); const before = env.calls.length;
    env.arrive(); await send.onUpdated(7, {status: 'complete'}, {...env.tab}); await send.onActivated({tabId: 7});
    assert.equal(env.calls.length, before); assert.equal((await store.status()).running, false);
  } finally { await store.close(); }
});

test('재수집 복구는 큐·상세 제한·전체 마감을 보존하며 저장 후 재로딩한 다음 요청도 한 번만 처리한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()}), env = environment();
  let time = 1000;
  const send = createMessageHandler({store, chrome: env.chrome, now: () => time});
  try {
    await send(await savedRepair(store), popupSender); env.arrive(); await send.onUpdated(7, {status: 'complete'}, {...env.tab});
    const first = env.config();
    await send({type: 'chain', runId: first.runId, chain: repairChain('A')}, {tab: {id: 7}});
    await send({type: 'checkpoint', runId: first.runId, navigation: {...first.navigation, mode: 'returning'}}, {tab: {id: 7}});
    env.disconnect(); time = 9000; await send.onUpdated(7, {status: 'complete'}, {...env.tab});
    const resumed = env.config();
    assert.notEqual(resumed.runId, first.runId); assert.equal(resumed.startedAt, first.startedAt);
    assert.deepEqual(resumed.navigation, {...first.navigation, mode: 'returning'});
    assert.equal((await send({type: 'repair-next', rootId: '/@tester/post/A1', runId: first.runId}, {tab: {id: 7}})).ok, false);
    assert.equal((await send({type: 'repair-next', rootId: '/@tester/post/A1', runId: resumed.runId}, {tab: {id: 7}})).ok, true);
    time = 45 * 60 * 1000 + 1000;
    await send({type: 'status'});
    assert.equal((await store.status()).running, false);
    assert.match((await store.status()).capture.reason, /시간 상한/);
  } finally { await store.close(); }
});

test('재수집 이동 완료가 프로필·홈·다른 화면이면 무한 대기하지 않고 저장 자료를 보존한 채 중단한다', async () => {
  for (const destination of ['https://www.threads.com/@tester', 'https://www.threads.com/', 'https://www.threads.com/login']) {
    const store = new CaptureStore({indexedDB: new IDBFactory()}), env = environment();
    const send = createMessageHandler({store, chrome: env.chrome});
    try {
      await send(await savedRepair(store), popupSender);
      const before = await store.exportCapture();
      env.arrive(); env.tab.url = destination;
      await send.onUpdated(7, {status: 'complete'}, {...env.tab});
      const status = await store.status(), after = await store.exportCapture();
      assert.equal(status.running, false, destination);
      assert.match(status.capture.reason, /다른 화면.*중단/);
      assert.deepEqual(after.cards, before.cards); assert.deepEqual(after.chains, before.chains);
      assert.equal(env.calls.length, 0, 'do not inject on a committed unexpected route');
      assert.equal(env.updates.length, 1, 'do not move on to another chain');
      await send.onActivated({tabId: 7});
      assert.equal(env.calls.length, 0, 'opening the tab again must not restart it');
    } finally { await store.close(); }
  }
});

test('대기 중이던 재수집 다음 요청은 사용자가 이동한 홈·외부·이동 예정 탭을 덮어쓰지 않는다', async () => {
  for (const destination of ['home', 'external', 'pending-away']) {
    const store = new CaptureStore({indexedDB: new IDBFactory()}), env = environment();
    const send = createMessageHandler({store, chrome: env.chrome});
    try {
      await send(await savedRepair(store), popupSender); env.arrive(); await send.onUpdated(7, {status: 'complete'}, {...env.tab});
      const config = env.config();
      await send({type: 'chain', runId: config.runId, chain: repairChain('A')}, {tab: {id: 7}});
      await send({type: 'checkpoint', runId: config.runId, navigation: {...config.navigation, mode: 'returning'}}, {tab: {id: 7}});
      const before = await store.exportCapture(), exportCapture = store.exportCapture.bind(store);
      let release, entered;
      const exportEntered = new Promise(resolve => {entered = resolve;});
      store.exportCapture = async () => {const waiting = new Promise(resolve => {release = resolve;});entered();await waiting;return exportCapture();};
      const preceding = send({type: 'export'});
      await exportEntered;
      const next = send({type: 'repair-next', rootId: '/@tester/post/A1', runId: config.runId}, {tab: {id: 7}});
      if (destination === 'home') env.tab.url = 'https://www.threads.com/';
      if (destination === 'external') env.tab.url = 'https://example.com/';
      if (destination === 'pending-away') {env.tab.pendingUrl = 'https://www.threads.com/';env.tab.status = 'loading';}
      release(); await preceding;
      assert.equal((await next).ok, false, destination);
      store.exportCapture = exportCapture;
      assert.equal(env.updates.length, 1, 'queued next must not overwrite user navigation');
      assert.equal((await store.status()).running, false);
      assert.match((await store.status()).capture.reason, /다른 화면.*중단/);
      const after = await store.exportCapture();
      assert.deepEqual(after.cards, before.cards); assert.deepEqual(after.chains, before.chains);
    } finally { await store.close(); }
  }
});

test('팝업이 확인한 현재 계정만 초기화하고 이전 실행 메시지·복원 이벤트는 다시 수집하지 않는다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()}), env = environment();
  const send = createMessageHandler({store, chrome: env.chrome});
  try {
    await send({type: 'start'});
    const runId = env.config().runId;
    await send({type: 'snapshot', runId, page}, {tab: {id: 7}});
    await send({type: 'stop'});
    const status = await send({type: 'status'}), before = env.calls.length;
    assert.equal(status.resetRunId, runId);
    assert.equal((await send({type: 'reset', account: status.capture.account, runId: status.resetRunId}, popupSender)).ok, true);
    assert.equal((await send({type: 'snapshot', runId, page}, {tab: {id: 7}})).ok, false);
    assert.equal((await send({type: 'ended', runId, reason: '늦은 종료'}, {tab: {id: 7}})).ok, false);
    await send.onActivated({tabId: 7});
    await send.onUpdated(7, {status: 'complete'}, {...env.tab});
    assert.equal(env.calls.length, before);
    assert.equal((await send({type: 'status'})).capture, null);
    assert.equal((await send({type: 'status'})).resetRunId, null);
    assert.equal((await send({type: 'export'})).capture, null);
  } finally { await store.close(); }
});

test('웹페이지·콘텐츠 스크립트·다른 확장·오래된 팝업은 초기화할 계정을 임의 지정하지 못한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()}), env = environment();
  const send = createMessageHandler({store, chrome: env.chrome});
  try {
    await send({type: 'start'});
    const runId = env.config().runId;
    await send({type: 'snapshot', runId, page}, {tab: {id: 7}});
    const reset = {type: 'reset', account: 'tester', runId};
    await assert.rejects(send(reset, popupSender), /먼저 중지/);
    await send({type: 'stop'});
    for (const sender of [{}, {tab: {id: 7}, id: 'test-extension', url: env.tab.url},
      {...popupSender, tab: {id: 7}}, {...popupSender, id: 'another-extension'},
      {...popupSender, url: 'https://www.threads.com/@tester'}])
      await assert.rejects(send(reset, sender), /확장 팝업/);
    await assert.rejects(send({...reset, account: 'other'}, popupSender), /대상이 바뀌/);
    await assert.rejects(send({...reset, runId: 'old-run'}, popupSender), /대상이 바뀌/);
    assert.equal((await send({type: 'export'})).capture.cards.length, 1);
  } finally { await store.close(); }
});

test('확장 메시지는 본문 없는 상태와 별도 export를 제공하고 같은 탭의 오래된 실행은 거부한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  const env = environment();
  const send = createMessageHandler({store, chrome: env.chrome});
  await send({type: 'start'});
  const firstRun = env.config().runId;
  assert.equal(env.config().maxRounds, 1800);
  assert.deepEqual(env.calls.filter(call => call.files).flatMap(call => call.files), ['reader.js', 'chains.js', 'content.js']);
  await send({type: 'snapshot', runId: firstRun, page}, {tab: {id: 7}});
  assert.equal((await send({type: 'status'})).capture.cardCount, 1);
  assert.equal('cards' in (await send({type: 'status'})).capture, false);
  await send({type: 'stop'});
  await send({type: 'start'});
  assert.equal((await send({type: 'snapshot', runId: firstRun, page}, {tab: {id: 7}})).ok, false);
  assert.equal((await send({type: 'export'})).capture.cards.length, 1);
  await store.close();
});

test('탭 연결이 끊겨도 확정한 자료는 내보낼 수 있고 중단된 원인을 보존한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  const env = environment();
  const send = createMessageHandler({store, chrome: env.chrome});
  await send({type: 'start'});
  await send({type: 'snapshot', runId: env.config().runId, page}, {tab: {id: 7}});
  env.close();
  await send.onRemoved(7);
  const status = await send({type: 'status'});
  assert.equal(status.running, false);
  assert.match(status.capture.reason, /탭이 닫힘/);
  await send({type: 'stop'});
  const exported = (await send({type: 'export'})).capture;
  assert.equal(exported.cards[0].text, '확정된 글');
  assert.match(exported.reason, /탭이 닫힘/);
  await store.close();
});

test('일시적인 ping 오류는 살아 있는 실행을 종료하거나 다음 화면 저장을 거부하지 않는다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  const env = environment();
  const send = createMessageHandler({store, chrome: env.chrome});
  await send({type: 'start'});
  const runId = env.config().runId;
  env.disconnect();
  const status = await send({type: 'status'});
  assert.equal(status.running, true);
  assert.match(status.connectionStatus, /연결 확인/);
  env.connect();
  assert.equal((await send({type: 'snapshot', runId, page}, {tab: {id: 7}})).ok, true);
  assert.equal((await send({type: 'export'})).capture.cards.length, 1);
  await store.close();
});

test('다른 탭의 메시지와 보안 중단 후 늦은 화면을 받아들이지 않는다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  const env = environment();
  const send = createMessageHandler({store, chrome: env.chrome});
  await send({type: 'start'});
  const runId = env.config().runId;
  assert.equal((await send({type: 'snapshot', runId, page}, {tab: {id: 8}})).ok, false);
  await send({type: 'snapshot', runId, page: {...page, blocked: true, cards: []}}, {tab: {id: 7}});
  assert.equal((await send({type: 'snapshot', runId, page}, {tab: {id: 7}})).ok, false);
  await send({type: 'stop'});
  const result = (await send({type: 'export'})).capture;
  assert.equal(result.cards.length, 0);
  assert.equal(result.status, '불완전');
  assert.match(result.reason, /보안/);
  await store.close();
});

test('폐기·동결된 탭은 기다리고 복원 완료 때 새 실행 ID로 위치와 원래 마감 시간을 이어간다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  const env = environment();
  const send = createMessageHandler({store, chrome: env.chrome});
  await send({type: 'start'});
  const first = env.config();
  await send({type: 'snapshot', runId: first.runId, page}, {tab: {id: 7}});
  const navigation = {mode: 'detail', profilePath: '/@tester', activeChain: {rootId: '/@tester/post/one'}, resume: {top: 850}, visitedRoots: []};
  await send({type: 'checkpoint', runId: first.runId, navigation}, {tab: {id: 7}});
  env.disconnect(); env.tab.discarded = true; env.tab.frozen = true;
  const before = env.calls.length;
  assert.equal((await send({type: 'status'})).running, true);
  await send.onUpdated(7, {discarded: true}, {...env.tab});
  assert.equal(env.calls.length, before);
  env.tab.discarded = false; env.tab.frozen = false; env.tab.url = 'https://www.threads.com/@tester/post/one';
  await send.onUpdated(7, {status: 'complete'}, {...env.tab});
  const resumed = env.config();
  assert.notEqual(resumed.runId, first.runId);
  assert.equal(resumed.startedAt, first.startedAt);
  assert.equal(resumed.navigation.resume.top, 850);
  env.connect();
  assert.equal((await send({type: 'snapshot', runId: resumed.runId, page}, {tab: {id: 7}})).ok, true);
  assert.equal((await send({type: 'export'})).capture.cards.length, 1);
  await store.close();
});

test('사용자가 중지했거나 보안 중단된 작업은 탭 활성화·복원으로 다시 주입하지 않는다', async () => {
  for (const end of ['manual', 'security']) {
    const store = new CaptureStore({indexedDB: new IDBFactory()});
    const env = environment();
    const send = createMessageHandler({store, chrome: env.chrome});
    await send({type: 'start'});
    if (end === 'manual') await send({type: 'stop'});
    else await send({type: 'snapshot', runId: env.config().runId, page: {...page, blocked: true}}, {tab: {id: 7}});
    env.disconnect();
    const before = env.calls.length;
    await send.onActivated({tabId: 7});
    await send.onUpdated(7, {status: 'complete'}, {...env.tab});
    assert.equal(env.calls.length, before);
    assert.equal((await send({type: 'status'})).running, false);
    await store.close();
  }
});

test('살아 있는 수집기가 종료를 응답하면 채널 실패로 오인해 재주입하지 않는다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  const env = environment();
  const send = createMessageHandler({store, chrome: env.chrome});
  await send({type: 'start'});
  env.stopContent();
  const before = env.calls.length;
  await send.onActivated({tabId: 7});
  assert.equal(env.calls.length, before);
  const state = await send({type: 'status'});
  assert.equal(state.running, false);
  assert.equal(state.capture.reason, '시간 상한 도달');
  await store.close();
});

test('정상 화면이 확정되지 않는 재주입은 횟수 제한 안에서만 하고 원래 마감 뒤에는 복구하지 않는다', async () => {
  let time = 1000;
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  const env = environment();
  const send = createMessageHandler({store, chrome: env.chrome, now: () => time, maxRecoveryAttempts: 2});
  await send({type: 'start'});
  env.disconnect();
  for (let attempt = 0; attempt < 3; attempt++) await send.onActivated({tabId: 7});
  assert.equal(env.calls.filter(call => call.files).length, 3);
  assert.equal((await send({type: 'status'})).running, false);
  env.connect(); await send({type: 'start'}); env.disconnect();
  const before = env.calls.length;
  time += 45 * 60 * 1000;
  await send.onActivated({tabId: 7});
  assert.equal(env.calls.length, before);
  assert.match((await send({type: 'status'})).capture.reason, /시간 상한/);
  await store.close();
});

test('다른 게시물로 이동하면 저장한 checkpoint를 핑계로 재주입하지 않는다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  const env = environment();
  const send = createMessageHandler({store, chrome: env.chrome});
  await send({type: 'start'});
  env.disconnect(); env.tab.url = 'https://www.threads.com/@tester/post/unrelated';
  const before = env.calls.length;
  await send.onUpdated(7, {status: 'complete'}, {...env.tab});
  assert.equal(env.calls.length, before);
  assert.equal((await send({type: 'status'})).running, false);
  await store.close();
});

test('탭 주소를 아직 읽을 수 없다는 사실만으로 다른 페이지 이동이나 종료를 단정하지 않는다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  const env = environment();
  const send = createMessageHandler({store, chrome: env.chrome});
  await send({type: 'start'});
  delete env.tab.url;
  const before = env.calls.length;
  await send.onActivated({tabId: 7});
  const status = await send({type: 'status'});
  assert.equal(status.running, true);
  assert.equal(env.calls.length, before);
  assert.match(status.connectionStatus, /주소/);
  await store.close();
});
