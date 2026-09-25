import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {CaptureStore} from '../browser-extension/storage.mjs';
import {exportCaptureMarkdown} from '../browser-extension/export.mjs';

const card = (id, text = '보관할 글') => ({id: `/@tester/post/${id}`, timestamp: '2026-09-19T00:00:00Z', text, label: null, groupIds: [], issues: [], context: 'threads', attachments: []});
const page = (...cards) => ({version: 2, adapter: 'threads-dom-2026-09-19', account: 'tester', capturedAt: '2026-09-19T01:00:00Z', cards, issues: [], blocked: false});
const identity = {tabId: 7, runId: 'first-run'};
const completeChain = cards => ({rootId: cards[0].id, total: cards.length, status: 'complete',
  members: cards.map((item, index) => ({part: index + 1, id: item.id})), missing: [], reason: null});

const allRecords = store => store.transaction('readonly', async stores => Object.fromEntries(await Promise.all(
  Object.entries(stores).map(async ([name, objectStore]) => [name, await new Promise((resolve, reject) => {
    const reading = objectStore.getAll(); reading.onsuccess = () => resolve(reading.result); reading.onerror = () => reject(reading.error);
  })]))));

async function seedResetCapture(store, account = 'tester', runId = identity.runId) {
  const run = {tabId: 7, runId};
  await store.start(account, run.tabId, run.runId);
  const item = {...card('one'), id: `/@${account}/post/one`, label: '1/1'};
  await store.append({...page(item), account, issues: [{id: item.id, reason: '보존할 진단'}]}, run);
  await store.recordChain(completeChain([item]), run);
  await store.finish('중단', '사용자 중지', run);
  return {account, runId};
}

test('계정 초기화는 해당 계정의 모든 기록과 실행만 지우고 다른 계정 및 다운로드 원본은 보존한다', async () => {
  const indexedDB = new IDBFactory();
  const store = new CaptureStore({indexedDB});
  try {
    await seedResetCapture(store, 'other', 'other-run');
    const beforeOther = await allRecords(store);
    const target = await seedResetCapture(store);
    const downloaded = await store.exportCapture();
    assert.equal((await store.resetCapture(target)).ok, true);
    assert.equal((await store.status()).capture, null);
    assert.equal((await store.status()).running, false);
    assert.equal((await store.status()).navigation, null);
    assert.equal(await store.getControl(), undefined);
    assert.equal(await store.exportCapture(), null);
    assert.deepEqual(await store.getChains(), []);
    const after = await allRecords(store);
    for (const name of ['captures', 'cards', 'issues', 'chains']) assert.deepEqual(after[name], beforeOther[name], name);
    assert.deepEqual(after.control, []);
    assert.equal(downloaded.cards.length, 1);
    assert.equal(downloaded.chains.length, 1);
    await store.close();
    const reopened = new CaptureStore({indexedDB});
    try {
      assert.equal((await reopened.status()).capture, null);
      await reopened.start('tester', 7, 'new-run');
      const fresh = await reopened.exportCapture();
      assert.deepEqual(fresh.cards, []); assert.deepEqual(fresh.chains, []); assert.deepEqual(fresh.issues, []);
      assert.equal(fresh.snapshots, 0); assert.notEqual(fresh.sessionId, downloaded.sessionId);
    } finally { await reopened.close(); }
  } finally { await store.close(); }
});

test('초기화 중 일부 저장소 삭제가 실패하면 앞선 삭제와 실행 정보까지 함께 복구한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  try {
    const target = await seedResetCapture(store), before = await allRecords(store);
    const transaction = store.transaction.bind(store);
    store.transaction = (mode, work) => transaction(mode, stores => {
      stores.issues.delete = () => { throw new Error('초기화 삭제 실패'); };
      return work(stores);
    });
    await assert.rejects(store.resetCapture(target), /초기화 삭제 실패/);
    store.transaction = transaction;
    assert.deepEqual(await allRecords(store), before);
  } finally { await store.close(); }
});

test('진행 중 또는 확인한 계정·실행이 바뀐 초기화는 자료를 지우지 않는다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  try {
    const target = await seedResetCapture(store);
    await store.start('tester', 7, 'new-run');
    const running = await allRecords(store);
    await assert.rejects(store.resetCapture({account: 'tester', runId: 'new-run'}), /먼저 중지/);
    assert.deepEqual(await allRecords(store), running);
    await store.finish('중단', '사용자 중지', {tabId: 7, runId: 'new-run'});
    const stopped = await allRecords(store);
    await assert.rejects(store.resetCapture(target), /대상이 바뀌/);
    await assert.rejects(store.resetCapture({account: 'other', runId: 'new-run'}), /대상이 바뀌/);
    assert.deepEqual(await allRecords(store), stopped);
  } finally { await store.close(); }
});

test('초기화 뒤 도착한 이전 수집 메시지는 기록을 되살리지 않고 재시작한 새 실행도 바꾸지 않는다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  try {
    const target = await seedResetCapture(store);
    const late = async () => {
      assert.equal((await store.append(page(card('late')), identity)).ok, false);
      assert.equal((await store.recordChain(completeChain([{...card('late'), label: '1/1'}]), identity)).ok, false);
      assert.equal((await store.checkpoint({mode: 'profile', profilePath: '/@tester'}, identity)).ok, false);
      assert.equal((await store.finish('불완전', '늦은 종료', identity)).ok, false);
    };
    await store.resetCapture(target); await late();
    assert.equal(await store.exportCapture(), null);
    await store.start('tester', 7, 'new-run'); await late();
    assert.equal((await store.status()).running, true);
    assert.deepEqual((await store.exportCapture()).cards, []);
  } finally { await store.close(); }
});

async function legacyCompletedCapture() {
  const indexedDB = new IDBFactory();
  const cards = ['bad1', 'bad2', 'good1', 'good2'].map((id, index) => ({...card(id), label: `${index % 2 + 1}/2`}));
  cards[0].label = '1/3';
  const chains = [completeChain(cards.slice(0, 2)), completeChain(cards.slice(2))];
  const db = await new Promise((resolve, reject) => {
    const opening = indexedDB.open('threads-text-archive-v2', 2);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore('captures', {keyPath: 'account'}); db.createObjectStore('control');
      for (const name of ['cards', 'issues', 'chains'])
        db.createObjectStore(name, {keyPath: ['account', name === 'cards' ? 'id' : name === 'chains' ? 'rootId' : 'key']}).createIndex('account', 'account');
    };
    opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
  });
  const tx = db.transaction(['captures', 'cards', 'chains', 'control'], 'readwrite');
  tx.objectStore('captures').put({account: 'tester', version: 2, status: '중단', cardCount: 4,
    chainCount: 2, completedChainCount: 2, incompleteChainCount: 0, snapshots: 3, duplicateCount: 0});
  cards.forEach((item, order) => tx.objectStore('cards').put({account: 'tester', id: item.id, card: item, order}));
  chains.forEach(chain => tx.objectStore('chains').put({account: 'tester', rootId: chain.rootId, chain}));
  tx.objectStore('control').put({account: 'tester', tabId: 7, runId: 'legacy', running: false}, 'active');
  await new Promise((resolve, reject) => {tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);});
  db.close();
  return {indexedDB, cards, chains};
}

test('기존 잘못된 완료 기록을 처음 읽을 때 재검증하고 정상 완료와 원문은 보존한다', async () => {
  const legacy = await legacyCompletedCapture();
  const store = new CaptureStore({indexedDB: legacy.indexedDB});
  try {
    const chains = await store.getChains();
    assert.equal(chains[0].status, 'incomplete');
    assert.deepEqual(chains[0].missing, [1]);
    assert.deepEqual(chains[1], legacy.chains[1]);
    const status = await store.status();
    assert.equal(status.capture.chainCount, 2);
    assert.equal(status.capture.completedChainCount, 1);
    assert.equal(status.capture.incompleteChainCount, 1);
    const capture = await store.exportCapture();
    assert.deepEqual(capture.cards, legacy.cards);
    assert.match(exportCaptureMarkdown(capture), /연속글 1\/2 확보 · 미완료/);
    assert.match(exportCaptureMarkdown(capture), /연속글 2\/2 확보 · 완료/);
  } finally { await store.close(); }
});

test('팝업·내보내기가 첫 접근이어도 기존 완료 개수를 바로잡고 재개방 후 유지한다', async () => {
  for (const firstRead of ['status', 'exportCapture']) {
    const legacy = await legacyCompletedCapture();
    const store = new CaptureStore({indexedDB: legacy.indexedDB});
    try {
      const response = await store[firstRead]();
      const meta = firstRead === 'status' ? response.capture : response;
      assert.equal(meta.completedChainCount, 1, firstRead);
      assert.equal(meta.incompleteChainCount, 1, firstRead);
      if (firstRead === 'exportCapture') assert.equal(response.chains[0].status, 'incomplete');
    } finally { await store.close(); }
    const reopened = new CaptureStore({indexedDB: legacy.indexedDB});
    try {
      await reopened.start('tester', 7, 'resumed');
      const capture = await reopened.exportCapture();
      assert.equal(capture.completedChainCount, 1);
      assert.equal(capture.incompleteChainCount, 1);
      assert.equal(capture.chains[0].status, 'incomplete');
      assert.deepEqual(capture.cards, legacy.cards);
    } finally { await reopened.close(); }
  }
});

test('같은 본문의 뒤늦은 순번만 보강하면 저장본·완료 개수·Markdown이 일치한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  try {
    await store.start('tester', 7, identity.runId);
    const first = card('first');
    first.notes = [{type: 'image', url: `${first.id}/media`}];
    await store.append(page(first), identity);
    const cards = [{...first, label: '1/2'}, {...card('second'), label: '2/2'}];
    await store.append(page(...cards), identity);
    const saved = await store.recordChain(completeChain(cards), identity);
    const capture = await store.exportCapture();
    const status = await store.status();
    assert.equal(capture.cards[0].label, '1/2');
    assert.equal(capture.cards[0].text, first.text);
    assert.deepEqual(capture.cards[0].notes, first.notes);
    assert.deepEqual(capture.issues, []);
    assert.equal(saved.chain.status, 'complete');
    assert.deepEqual(saved.chain.missing, []);
    assert.equal(status.capture.completedChainCount, 1);
    assert.equal(status.capture.incompleteChainCount, 0);
    assert.match(exportCaptureMarkdown(capture), /연속글 2\/2 확보 · 완료/);
  } finally { await store.close(); }
});

test('서로 다른 기존 순번을 보존하면 완료 요청도 미완료로 정규화한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  try {
    await store.start('tester', 7, identity.runId);
    await store.append(page({...card('first'), label: '1/3'}), identity);
    const cards = [{...card('first'), label: '1/2'}, {...card('second'), label: '2/2'}];
    await store.append(page(...cards), identity);
    const saved = await store.recordChain(completeChain(cards), identity);
    const capture = await store.exportCapture();
    const status = await store.status();
    assert.equal(capture.cards[0].label, '1/3');
    assert.equal(saved.chain.status, 'incomplete');
    assert.deepEqual(saved.chain.missing, [1]);
    assert.equal(status.capture.completedChainCount, 0);
    assert.equal(status.capture.incompleteChainCount, 1);
    assert.match(exportCaptureMarkdown(capture), /연속글 1\/2 확보 · 미완료/);
    assert.match(exportCaptureMarkdown(capture), /빠진 번호: 1/);
  } finally { await store.close(); }
});

test('본문 오류·본문 미확인·오류 배열 누락은 완료를 막고 빈 문자열은 허용한다', async () => {
  for (const extra of [{text: null}, {issues: [{reason: '본문 미확인'}]}, {issues: undefined}, {text: ''}]) {
    const store = new CaptureStore({indexedDB: new IDBFactory()});
    try {
      await store.start('tester', 7, identity.runId);
      const cards = [{...card('first'), label: '1/2', ...extra}, {...card('second'), label: '2/2'}];
      await store.append(page(...cards), identity);
      const saved = await store.recordChain(completeChain(cards), identity);
      const capture = await store.exportCapture();
      const status = await store.status();
      const complete = extra.text === '';
      assert.equal(saved.chain.status, complete ? 'complete' : 'incomplete');
      assert.deepEqual(saved.chain.missing, complete ? [] : [1]);
      assert.equal(status.capture.completedChainCount, complete ? 1 : 0);
      assert.equal(status.capture.incompleteChainCount, complete ? 0 : 1);
      assert.match(exportCaptureMarkdown(capture), complete ? /연속글 2\/2 확보 · 완료/ : /연속글 1\/2 확보 · 미완료/);
    } finally { await store.close(); }
  }
});

test('순번 보강은 본문·날짜·분류 변경이나 첨부 축약·새 오류를 덮어쓰지 않는다', async () => {
  for (const extra of [{text: '다른 본문'}, {timestamp: '2026-09-18T00:00:00Z'}, {context: 'replies'},
    {attachments: []}, {issues: [{reason: '새 구조 오류'}]}]) {
    const store = new CaptureStore({indexedDB: new IDBFactory()});
    try {
      await store.start('tester', 7, identity.runId);
      const first = {...card('first'), attachments: [{type: 'long-text', url: '/@tester/post/first/media', text: '긴 첨부 전문', source: 'profile-dom'}]};
      await store.append(page(first), identity);
      await store.append(page({...first, label: '1/2', ...extra}), identity);
      const capture = await store.exportCapture();
      assert.deepEqual(capture.cards[0], first);
      assert.match(capture.issues[0].reason, /최초 확인/);
    } finally { await store.close(); }
  }
});

test('기존 이미지 경고가 있어도 서로 다른 확정 순번을 덮어쓰지 않는다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  try {
    await store.start('tester', 7, identity.runId);
    const first = {...card('first'), label: '1/3', issues: [{reason: '첨부 구조 미확인'}]};
    await store.append(page(first), identity);
    await store.append(page({...first, label: '1/2', issues: []}), identity);
    const capture = await store.exportCapture();
    assert.equal(capture.cards[0].label, '1/3');
    assert.match(capture.issues[0].reason, /최초 확인/);
  } finally { await store.close(); }
});

test('기존 이미지 경고를 해소하고 같은 본문의 뒤늦은 미디어·장소 기록을 보존한다', async () => {
  const store=new CaptureStore({indexedDB:new IDBFactory()});
  await store.start('tester',7,identity.runId);
  const initial=card('photo');initial.issues=[{id:initial.id,reason:'첨부/설문/본문 뒤 구조 미검증'}];
  await store.append(page(initial),identity);
  const read=card('photo');read.notes=[{type:'image',url:`https://www.threads.com${read.id}/media`}];
  await store.append(page(read),identity);
  await store.append(page({...read,notes:[...read.notes,{type:'location',text:'장소'}]}),identity);
  await store.append(page(read),identity);
  const capture=await store.exportCapture();
  assert.equal(capture.cards.length,1);
  assert.deepEqual(capture.cards[0].issues,[]);
  assert.equal(capture.cards[0].notes.length,2);
  assert.equal(capture.cards[0].text,initial.text);
  assert.match(exportCaptureMarkdown(capture),/이미지.*저장하지/);
  assert.match(exportCaptureMarkdown(capture),/장소 태그: 장소/);
  await store.close();
});

test('기존 첨부 경고를 재확인한 안내·링크 미리보기로 해소하면 원문과 메타데이터를 보존해 연속글을 완료한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  try {
    await store.start('tester', 7, identity.runId);
    const cards = [{...card('first', '첫 번째 작성자 본문'), label: '1/2'},
      {...card('second', '두 번째 작성자 본문 https://example.com/article?id=42'), label: '2/2'}];
    const initial = cards.map(item => ({...item, issues: [{id: item.id, reason: '첨부/설문/본문 뒤 구조 미검증'}]}));
    await store.append(page(...initial), identity);
    await store.recordChain(completeChain(cards), identity);
    assert.equal((await store.status()).capture.completedChainCount, 0);
    assert.deepEqual((await store.getChains())[0].missing, [1, 2]);
    const verified = cards.map((item, index) => ({...item, notes: index === 0
      ? [{type: 'unavailable-content', text: '이용할 수 없는 게시물'}]
      : [{type: 'link-preview', url: 'https://example.com/article?id=42', domain: 'example.com', title: '기사 제목'}]}));
    await store.append(page(...verified), identity);
    await store.recordChain(completeChain(cards), identity);
    const capture = JSON.parse(JSON.stringify(await store.exportCapture()));
    for (const [index, item] of capture.cards.entries()) {
      assert.equal(item.text, cards[index].text); assert.equal(item.label, cards[index].label);
      assert.deepEqual(item.issues, []); assert.deepEqual(item.notes, verified[index].notes);
    }
    assert.equal(capture.chains[0].status, 'complete');
    assert.deepEqual(capture.chains[0].missing, []);
    assert.equal((await store.status()).capture.completedChainCount, 1);
    assert.equal((await store.status()).capture.incompleteChainCount, 0);
  } finally { await store.close(); }
});

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
  const cards = Array.from({length: 20}, (_, index) => ({...card(`part${index + 1}`), label: `${index + 1}/20`}));
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
  await store.append(page({...card('old', '기존에 저장한 전문'), label: '1/1'}), identity);
  await store.recordChain({rootId: '/@tester/post/old', total: 1, status: 'complete', members: [{part: 1, id: '/@tester/post/old'}], missing: [], reason: null}, identity);
  assert.equal((await store.status()).capture.completedChainCount, 1);
  assert.equal((await store.exportCapture()).cards.length, 1);
  await store.close();
});

test('서로 다른 연속글 20개를 분리 보존하고 번호 충돌이 있으면 완료를 거부한다', async () => {
  const store = new CaptureStore({indexedDB: new IDBFactory()});
  await store.start('tester', 7, identity.runId);
  for (let index = 1; index <= 20; index++) {
    const item = {...card(`root${index}`), label: '1/1'};
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
