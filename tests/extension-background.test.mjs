import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {CaptureStore} from '../browser-extension/storage.mjs';
import {createMessageHandler} from '../browser-extension/background.mjs';

function environment() {
  let config, connected = true, closed = false, running = true;
  const tab = {id: 7, url: 'https://www.threads.com/@tester', status: 'complete', discarded: false, frozen: false};
  const calls = [];
  const chrome = {
    tabs: {query: async () => [tab], get: async () => {if(closed)throw new Error('No tab with id: 7');return {...tab};}, sendMessage: async (_tab, message) => {
      if (!connected) throw new Error('tab gone');
      return message.type === 'ping' ? {running, runId: config?.runId, reason: running ? null : '시간 상한 도달'} : {ok: true};
    }},
    scripting: {executeScript: async options => {calls.push(options); if (options.args) config = options.args[0];}},
  };
  return {chrome, calls, tab, disconnect: () => {connected = false;}, connect: () => {connected = true;}, stopContent: () => {running = false;}, close: () => {closed = true;}, config: () => config};
}
const page = {version: 2, adapter: 'threads-dom-2026-09-19', account: 'tester', capturedAt: '2026-09-19T01:00:00Z', issues: [], blocked: false,
  cards: [{id: '/@tester/post/one', timestamp: '2026-09-19T00:00:00Z', text: '확정된 글', label: null, groupIds: [], issues: [], context: 'threads', attachments: []}]};

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
