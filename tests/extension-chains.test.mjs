import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const scope = {};
runInNewContext(readFileSync(new URL('../browser-extension/chains.js', import.meta.url), 'utf8'), scope);
const { parseLabel, candidates, observe } = scope.threadsArchiveChains;
const plain = value => JSON.parse(JSON.stringify(value));
const id = part => `/@sample/post/P${part}`;
const row = (part, total = 20, extra = {}) => ({ id: id(part), label: `${part}/${total}`, text: `${part}편 본문`, issues: [], ...extra });
const page = (cards, extra = {}) => ({ account: 'sample', view: 'profile', capturedAt: '2026-09-19T06:00:00Z', cards, ...extra });
const chain = (total = 20) => ({ rootId: id(1), total, status: 'pending', members: [], missing: Array.from({ length: total }, (_, i) => i + 1), reason: null, updatedAt: '2026-09-19T05:00:00Z' });
const detail = (cards, extra = {}) => page(cards, { view: 'detail', detailRoot: id(1), ...extra });

test('service numbering accepts bounded whole parts only', () => {
  assert.deepEqual(plain(parseLabel('1/20')), { part: 1, total: 20 });
  assert.deepEqual(plain(parseLabel('1000/1000')), { part: 1000, total: 1000 });
  for (const invalid of ['0/20', '21/20', '1/1001', '1.5/20', '-1/20', '01/20', '1/020', '1 / 20', '1/20\n', null, 1]) {
    assert.equal(parseLabel(invalid), null, String(invalid));
  }
});

test('candidates are distinct own-author roots and completed roots are skipped', () => {
  const cards = [row(1), row(1), row(2), row(1, 1), row(1, 20, { id: '/@other/post/P1' }), row(1, 20, { id: 'https://evil.example/@sample/post/P1' }), row(1, 3, { id: '/@sample/post/OtherRoot' })];
  const found = plain(candidates(page(cards), [{ rootId: '/@sample/post/OtherRoot', status: 'complete' }]));
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], { ...chain(), updatedAt: '2026-09-19T06:00:00Z' });
  assert.equal(candidates(page([row(1)], { blocked: true })).length, 0);
  assert.equal(candidates(page([row(1)]), [{ ...chain(), status: 'incomplete' }]).length, 1);
});

test('20/20 is complete only after verified detail pages accumulate every numbered body', () => {
  const initial = chain();
  const first = detail(Array.from({ length: 10 }, (_, i) => row(i + 1)));
  const original = structuredClone({ initial, first });
  const partial = observe(initial, first);
  assert.equal(partial.status, 'incomplete');
  assert.deepEqual(plain(partial.missing), Array.from({ length: 10 }, (_, i) => i + 11));
  const complete = observe(partial, detail(Array.from({ length: 11 }, (_, i) => row(i + 10))));
  assert.equal(complete.status, 'complete');
  assert.equal(complete.members.length, 20);
  assert.deepEqual(plain(complete.missing), []);
  assert.deepEqual({ initial, first }, original);
});

test('a missing middle part stays incomplete even after the final part is read', () => {
  const result = observe(chain(), detail(Array.from({ length: 20 }, (_, i) => i + 1).filter(i => i !== 5).map(i => row(i))));
  assert.equal(result.status, 'incomplete');
  assert.equal(result.members.length, 19);
  assert.deepEqual(plain(result.missing), [5]);
  assert.match(result.reason, /5/);
});

test('profile rows and another detail root cannot update a chain', () => {
  const initial = chain(3);
  const cards = [row(1, 3), row(2, 3), row(3, 3)];
  for (const snapshot of [page(cards), detail(cards, { detailRoot: '/@sample/post/AnotherRoot' }), detail(cards, { account: 'other' }), detail(cards, { blocked: true })]) {
    assert.deepEqual(plain(observe(initial, snapshot)), initial);
  }
});

test('other authors, denominators, roots and unresolved bodies never fill missing numbers', () => {
  const result = observe(chain(5), detail([
    row(1, 5, { id: '/@sample/post/DifferentFirst' }), row(2, 5, { id: '/@outsider/post/P2' }),
    row(3, 6), row(4, 5, { text: null }), row(5, 5, { issues: [{ reason: '본문 구조 미확인' }] }),
  ]));
  assert.equal(result.status, 'incomplete');
  assert.equal(result.members.length, 0);
  assert.deepEqual(plain(result.missing), [1, 2, 3, 4, 5]);
  const withEmptyBody = observe(result, detail([row(1, 5, { text: '' })]));
  assert.deepEqual(plain(withEmptyBody.members), [{ part: 1, id: id(1) }]);
});

test('different IDs for one part remain ambiguous across revisits and cannot become complete', () => {
  const first = observe(chain(3), detail([row(1, 3), row(2, 3)]));
  const conflict = observe(first, detail([row(2, 3, { id: '/@sample/post/OtherP2' }), row(3, 3)]));
  assert.equal(conflict.status, 'incomplete');
  assert.match(conflict.reason, /2.*(?:충돌|서로 다른)/);
  assert.equal(conflict.conflicts.length, 1);
  const revisited = observe(plain(conflict), detail([row(1, 3), row(2, 3), row(3, 3)]));
  assert.equal(revisited.status, 'incomplete');
  assert.match(revisited.reason, /2.*(?:충돌|서로 다른)/);
});

test('one post ID cannot supply multiple part numbers', () => {
  const result = observe(chain(3), detail([row(1, 3), row(2, 3), row(3, 3, { id: id(2) })]));
  assert.equal(result.status, 'incomplete');
  assert.ok(result.missing.length || result.conflicts?.length);
});

test('a persisted relationship conflict prevents completion even if all numbers later appear', () => {
  const saved = { ...chain(3), conflictDetected: true, reason: '연속글 총수 충돌' };
  const result = observe(saved, detail([row(1, 3), row(2, 3), row(3, 3)]));
  assert.equal(result.status, 'incomplete');
  assert.match(result.reason, /충돌/);
});

test('popup keeps diagnostic counts folded and distinguishes date span from coverage', async () => {
  const html = readFileSync(new URL('../browser-extension/popup.html', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../browser-extension/popup.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?\n/, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.chrome = { runtime: { sendMessage: async () => ({ running: true,
    capture: { account: 'sample', status: '수집 중', cardCount: 40, snapshots: 125, duplicateCount: 730, oldestTimestamp: '2025-09-09T00:00:00Z', newestTimestamp: '2026-09-19T00:00:00Z', chainCount: 2, completedChainCount: 1, incompleteChainCount: 1 },
    navigation: { mode: 'detail', activeChain: { rootId: id(1), total: 20, members: Array.from({ length: 19 }, (_, i) => ({ part: i + 1, id: id(i + 1) })), missing: [20] } },
  }) } };
  dom.window.setInterval = () => 0;
  try {
    dom.window.eval(script);
    await new Promise(resolve => setImmediate(resolve));
    const text = dom.window.document.getElementById('message').textContent;
    assert.match(text, /저장된 글 40개/);
    assert.match(text, /연속글.*2.*완료 1.*미완료 1/);
    assert.match(text, /19\/20/);
    assert.match(text, /저장된 글 작성일 범위/);
    assert.match(text, /고정 글 포함.*사이 글 확보 의미 아님/);
    assert.doesNotMatch(text, /125|730|확정 화면|재등장/);
    const details = dom.window.document.querySelector('details');
    assert.equal(details.open, false);
    assert.match(details.textContent, /화면 저장 횟수.*125/);
    assert.match(details.textContent, /중복 저장 방지 횟수.*730/);
  } finally { dom.window.close(); }
});
