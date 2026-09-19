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
