import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {CaptureStore} from '../browser-extension/storage.mjs';
import {exportCaptureMarkdown} from '../browser-extension/export.mjs';

const card = (id, text = '보관할 글') => ({id: `/@tester/post/${id}`, timestamp: '2026-09-19T00:00:00Z', text, label: null, groupIds: [], issues: [], context: 'threads', attachments: []});
const page = (...cards) => ({version: 2, adapter: 'threads-dom-2026-09-19', account: 'tester', capturedAt: '2026-09-19T01:00:00Z', cards, issues: [], blocked: false});
const identity = {tabId: 7, runId: 'first-run'};

test('확정한 게시물과 긴 첨부는 저장소를 다시 열어도 남고 상태 조회에는 본문을 싣지 않는다', async () => {
  const indexedDB = new IDBFactory();
  const store = new CaptureStore({indexedDB});
  await store.start('tester', 7, identity.runId);
  const first = card('one');
  first.attachments = [{type: 'long-text', url: 'https://www.threads.com/@tester/post/one/media', text: '첫 줄\n마지막 줄', source: 'profile-dom'}];
  assert.equal((await store.append(page(first), identity)).ok, true);
  await store.close();
  const reopened = new CaptureStore({indexedDB});
  const summary = await reopened.status();
  assert.equal(summary.capture.cardCount, 1);
  assert.equal('cards' in summary.capture, false);
  const exported = await reopened.exportCapture();
  assert.equal(exported.version, 2);
  assert.equal(exported.cards[0].attachments[0].text, '첫 줄\n마지막 줄');
  assert.ok(exportCaptureMarkdown(exported).includes('첫 줄\n마지막 줄'));
  await reopened.close();
});

test('중지·재시작 후 이전 실행 메시지를 무시하고 같은 ID는 최초 본문과 충돌 근거를 남긴다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  await store.start('tester', 7, identity.runId);
  await store.append(page(card('one', '첫 본문')), identity);
  await store.finish('중단', '사용자 중지', identity);
  await store.start('tester', 7, 'second-run');
  assert.equal((await store.append(page(card('late')), identity)).ok, false);
  await store.finish('불완전', '늦은 종료 메시지', identity);
  assert.equal((await store.status()).running, true);
  await store.append(page(card('one', '달라진 본문')), {tabId: 7, runId: 'second-run'});
  const exported = await store.exportCapture();
  assert.equal(exported.cards.length, 1);
  assert.equal(exported.cards[0].text, '첫 본문');
  assert.equal(exported.duplicateCount, 1);
  assert.match(exported.issues[0].reason, /최초 확인/);
  await store.close();
});

test('화면 중간의 저장 실패는 앞 카드와 개수까지 되돌리고 이전 확정 자료는 보존한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  await store.start('tester', 7, identity.runId);
  await store.append(page(card('confirmed')), identity);
  const invalid = card('invalid');
  delete invalid.id;
  await assert.rejects(store.append(page(card('must-rollback'), invalid), identity));
  const exported = await store.exportCapture();
  assert.deepEqual(exported.cards.map(item => item.id), ['/@tester/post/confirmed']);
  assert.equal(exported.snapshots, 1);
  assert.equal((await store.status()).capture.cardCount, 1);
  await store.close();
});

test('본문 구조를 못 읽은 첫 결과는 나중의 확인된 긴 첨부 결과로 회복한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  await store.start('tester', 7, identity.runId);
  const incomplete = card('one');
  incomplete.issues = [{id: incomplete.id, reason: '첨부 구조 미확인'}];
  await store.append(page(incomplete), identity);
  const complete = card('one');
  complete.attachments = [{type: 'long-text', url: 'https://www.threads.com/@tester/post/one/media', text: '확인한 첨부 전문', source: 'profile-dom'}];
  await store.append(page(complete), identity);
  const result = await store.exportCapture();
  assert.equal(result.cards[0].attachments[0].text, '확인한 첨부 전문');
  assert.equal(result.cards[0].issues.length, 0);
  assert.equal(result.cards.length, 1);
  await store.close();
});

test('오류 없는 첫 캡션 뒤 늦게 로딩된 첨부와 더 긴 전문을 보강하고 축약·충돌 결과로 덮어쓰지 않는다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  await store.start('tester', 7, identity.runId);
  await store.append(page(card('late')), identity);
  const expanded = card('late');
  expanded.attachments = [{type: 'long-text', url: 'https://www.threads.com/@tester/post/late/media', text: '첫 부분', source: 'profile-dom'}];
  await store.append(page(expanded), identity);
  assert.equal((await store.exportCapture()).cards[0].attachments[0]?.text, '첫 부분');
  expanded.attachments[0].text = '첫 부분\n마지막 부분';
  await store.append(page(expanded), identity);
  assert.equal((await store.exportCapture()).cards[0].attachments[0].text, '첫 부분\n마지막 부분');
  await store.append(page(card('late')), identity);
  expanded.attachments[0].text = '다른 전문';
  await store.append(page(expanded), identity);
  const result = await store.exportCapture();
  assert.equal(result.cards[0].attachments[0].text, '첫 부분\n마지막 부분');
  assert.equal(result.cards.length, 1);
  assert.ok(result.issues.some(issue => /최초 확인/.test(issue.reason)));
  await store.close();
});

test('연속글 20개 부분과 탐색 위치를 다시 열어도 보존하고 빠진 번호가 있으면 완료로 표시하지 않는다', async () => {
  const indexedDB = new IDBFactory();
  const store = new CaptureStore({indexedDB});
  await store.start('tester', 7, identity.runId);
  const cards = Array.from({length: 20}, (_, index) => card(`part${index + 1}`));
  await store.append(page(...cards), identity);
  const members = cards.map((item, index) => ({part: index + 1, id: item.id}));
  const chain = {rootId: cards[0].id, total: 20, status: 'complete', members: members.slice(0, 19), missing: [], reason: null, updatedAt: '2026-09-19T01:00:00Z'};
  await store.recordChain(chain, identity);
  assert.equal((await store.getChains())[0].status, 'incomplete');
  assert.deepEqual((await store.getChains())[0].missing, [20]);
  chain.members = members;
  await store.recordChain(chain, identity);
  const navigation = {mode: 'detail', profilePath: '/@tester', activeChain: chain, resume: {scrollTop: 1234}, visitedRoots: []};
  await store.checkpoint(navigation, identity);
  await store.close();
  const reopened = new CaptureStore({indexedDB});
  const status = await reopened.status();
  assert.equal(status.capture.chainCount, 1);
  assert.equal(status.capture.completedChainCount, 1);
  assert.equal(status.capture.incompleteChainCount, 0);
  assert.equal(status.navigation.resume.scrollTop, 1234);
  assert.equal((await reopened.exportCapture()).chains[0].members.length, 20);
  assert.equal((await reopened.getControl()).startedAt > 0, true);
  await reopened.close();
});

test('기존 DB version 1의 카드·본문·실행 정보를 지우지 않고 chains 저장소를 추가한다', async () => {
  const indexedDB = new IDBFactory();
  const db = await new Promise((resolve, reject) => {
    const opening = indexedDB.open('threads-text-archive-v2', 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore('captures', {keyPath: 'account'}); db.createObjectStore('control');
      db.createObjectStore('cards', {keyPath: ['account', 'id']}).createIndex('account', 'account');
      db.createObjectStore('issues', {keyPath: ['account', 'key']}).createIndex('account', 'account');
    };
    opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
  });
  const tx = db.transaction(['captures', 'cards', 'control'], 'readwrite');
  tx.objectStore('captures').put({account: 'tester', version: 2, cardCount: 1, status: '중단', snapshots: 1, duplicateCount: 0});
  tx.objectStore('cards').put({account: 'tester', id: '/@tester/post/old', card: card('old', '기존에 저장한 전문'), order: 1});
  tx.objectStore('control').put({account: 'tester', tabId: 7, runId: 'old-run', running: false}, 'active');
  await new Promise((resolve, reject) => {tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);});
  db.close();
  const store = new CaptureStore({indexedDB});
  assert.equal((await store.exportCapture()).cards[0].text, '기존에 저장한 전문');
  assert.deepEqual(await store.getChains(), []);
  assert.equal((await store.status()).capture.chainCount, 0);
  await store.start('tester', 7, identity.runId);
  await store.recordChain({rootId: '/@tester/post/old', total: 1, status: 'complete', members: [{part: 1, id: '/@tester/post/old'}], missing: [], reason: null}, identity);
  assert.equal((await store.status()).capture.completedChainCount, 1);
  assert.equal((await store.exportCapture()).cards.length, 1);
  await store.close();
});

test('서로 다른 연속글 20개를 분리 보존하고 번호 충돌이 있으면 완료를 거부한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  await store.start('tester', 7, identity.runId);
  for (let index = 1; index <= 20; index++) {
    const item = card(`root${index}`);
    await store.append(page(item), identity);
    await store.recordChain({rootId: item.id, total: 1, status: 'complete', members: [{part: 1, id: item.id}], missing: [], reason: null,
      conflicts: index === 20 ? [{part: 1, ids: [item.id, '/@tester/post/other']}] : []}, identity);
  }
  const status = await store.status();
  assert.equal(status.capture.chainCount, 20);
  assert.equal(status.capture.completedChainCount, 19);
  assert.equal(status.capture.incompleteChainCount, 1);
  assert.equal((await store.exportCapture()).chains.length, 20);
  assert.equal((await store.getChains()).find(chain => chain.rootId.endsWith('/root20')).status, 'incomplete');
  await store.close();
});

test('다른 계정의 상세글을 복구 위치로 저장하지 않고 기존 위치를 보존한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  await store.start('tester', 7, identity.runId);
  await assert.rejects(store.checkpoint({mode: 'detail', profilePath: '/@tester', activeChain: {rootId: '/@other/post/one'}}, identity));
  assert.equal((await store.status()).navigation.mode, 'profile');
  await store.close();
});
