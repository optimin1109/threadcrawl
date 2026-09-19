import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {CaptureStore} from '../browser-extension/storage.mjs';
import {createMessageHandler} from '../browser-extension/background.mjs';

function environment() {
  let config, connected = true;
  const calls = [];
  const chrome = {
    tabs: {query: async () => [{id: 7, url: 'https://www.threads.com/@tester'}], sendMessage: async (_tab, message) => {
      if (!connected) throw new Error('tab gone');
      return message.type === 'ping' ? {running: true, runId: config?.runId} : {ok: true};
    }},
    scripting: {executeScript: async options => {calls.push(options); if (options.args) config = options.args[0];}},
  };
  return {chrome, calls, disconnect: () => {connected = false;}, config: () => config};
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
  assert.deepEqual(env.calls.filter(call => call.files).flatMap(call => call.files), ['reader.js', 'content.js']);
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
  env.disconnect();
  const status = await send({type: 'status'});
  assert.equal(status.running, false);
  assert.match(status.capture.reason, /연결이 끊김/);
  await send({type: 'stop'});
  const exported = (await send({type: 'export'})).capture;
  assert.equal(exported.cards[0].text, '확정된 글');
  assert.match(exported.reason, /연결이 끊김/);
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
