import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const html = readFileSync(new URL('../browser-extension/popup.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../browser-extension/popup.mjs', import.meta.url), 'utf8').replace(/^import .*;\r?\n/, '');
const captured = () => ({running: false, resetRunId: 'confirmed-run', capture: {
  account: 'tester', status: '중단', cardCount: 3, sessionId: 'capture-session', snapshots: 1, duplicateCount: 0,
}});
const settled = () => new Promise(resolve => setImmediate(resolve));

async function popup({status = captured(), confirmed = true, resetError = null, repairError = null} = {}) {
  const dom = new JSDOM(html, {runScripts: 'outside-only'}), sent = [], confirmations = [];
  const state = {status};
  dom.window.chrome = {runtime: {sendMessage: async message => {
    sent.push({...message});
    if (message.type === 'status') return structuredClone(state.status);
    if (message.type === 'reset') {
      if (resetError) return {error: resetError};
      state.status = {capture: null, running: false, resetRunId: null}; return {ok: true};
    }
    if (message.type === 'repair') {
      if (repairError) return {error: repairError};
      state.status = {...state.status, running: true,
        navigation: {workflow: 'repair', repairQueue: ['/@tester/post/one'], repairIndex: 0}};
      return {ok: true};
    }
    return {ok: true};
  }}};
  dom.window.confirm = text => {confirmations.push(text); return confirmed;};
  dom.window.setInterval = () => 0;
  dom.window.eval(script); await settled();
  return {dom, state, sent, confirmations, button: id => dom.window.document.getElementById(id)};
}

test('초기화는 멈춘 계정에서만 제공하고 빈 상태에서는 수집 시작으로 표시한다', async () => {
  for (const status of [captured(), {...captured(), running: true}, {capture: null, running: false}]) {
    const ui = await popup({status});
    try {
      assert.ok(ui.button('reset'), 'account reset button is present');
      assert.equal(ui.button('reset').disabled, Boolean(status.running || !status.capture));
      assert.equal(ui.button('start').textContent, status.capture ? '이 계정 수집 계속하기' : '이 계정 수집 시작');
    } finally { ui.dom.window.close(); }
  }
});

test('초기화 확인은 계정·삭제 범위·복구 불가·JSON 보관을 알리고 확인한 실행만 삭제 요청한다', async () => {
  const ui = await popup();
  try {
    assert.ok(ui.button('reset'));
    ui.button('reset').click(); await settled();
    assert.equal(ui.confirmations.length, 1);
    assert.match(ui.confirmations[0], /@tester/);
    assert.match(ui.confirmations[0], /글.*연속글.*수집/);
    assert.match(ui.confirmations[0], /되돌릴 수 없/);
    assert.match(ui.confirmations[0], /JSON/);
    assert.match(ui.confirmations[0], /다른 계정.*삭제하지 않/);
    assert.deepEqual(ui.sent.filter(item => item.type === 'reset'), [{type: 'reset', account: 'tester', runId: 'confirmed-run'}]);
    assert.equal(ui.sent.some(item => item.type === 'start'), false);
    assert.equal(ui.button('reset').disabled, true);
    assert.equal(ui.button('save').disabled, true);
    assert.equal(ui.button('start').textContent, '이 계정 수집 시작');
  } finally { ui.dom.window.close(); }
});

test('초기화 확인 취소와 서버 거부는 기존 기록과 계속하기 상태를 보존한다', async () => {
  for (const options of [{confirmed: false}, {resetError: '초기화 대상이 바뀌었습니다.'}]) {
    const ui = await popup(options);
    try {
      assert.ok(ui.button('reset'));
      ui.button('reset').click(); await settled();
      assert.equal(ui.sent.filter(item => item.type === 'reset').length, options.confirmed === false ? 0 : 1);
      assert.equal(ui.button('start').textContent, '이 계정 수집 계속하기');
      assert.equal(ui.button('save').disabled, false);
      assert.equal(ui.button('reset').disabled, false);
      if (options.resetError) assert.match(ui.dom.window.document.getElementById('message').textContent, /초기화 대상이 바뀌/);
    } finally { ui.dom.window.close(); }
  }
});

test('미완료 글 재수집은 멈춘 계정에 미완료 묶음이 있을 때만 제공한다', async () => {
  const pending = {...captured(), capture: {...captured().capture, chainCount: 5, completedChainCount: 3}};
  for (const status of [pending, {...pending, running: true}, captured(),
    {...pending, capture: {...pending.capture, completedChainCount: 5}}, {capture: null, running: false}]) {
    const ui = await popup({status});
    try {
      assert.ok(ui.button('repair'), '미완료 글 재수집 버튼이 있어야 합니다.');
      assert.equal(ui.button('repair').textContent, '미완료 글만 다시 수집');
      assert.equal(ui.button('repair').disabled, status !== pending);
      assert.equal(ui.button('start').textContent, status.capture ? '이 계정 수집 계속하기' : '이 계정 수집 시작');
      if (status.capture) {
        const help = ui.dom.window.document.getElementById('repairHelp').textContent;
        assert.match(help, /@tester.*미완료/);
        assert.match(help, /@tester.*프로필.*탭/);
        assert.match(help, /저장된 글.*보존/);
      }
    } finally { ui.dom.window.close(); }
  }
});

test('미완료 글 재수집은 확인한 계정·실행으로 전용 요청만 보내며 삭제 확인이나 일반 시작을 하지 않는다', async () => {
  const status = {...captured(), capture: {...captured().capture, chainCount: 2, completedChainCount: 1}};
  const ui = await popup({status, confirmed: false});
  try {
    assert.ok(ui.button('repair'));
    ui.button('repair').click(); await settled();
    assert.deepEqual(ui.sent.filter(item => item.type !== 'status'), [{type: 'repair', account: 'tester', runId: 'confirmed-run'}]);
    assert.equal(ui.confirmations.length, 0);
    assert.equal(ui.button('repair').disabled, true);
    assert.equal(ui.button('stop').disabled, false);
    assert.equal(ui.state.status.capture.cardCount, 3);
  } finally { ui.dom.window.close(); }
});

test('미완료 글 재수집은 전체 진행과 현재 묶음의 확보·누락 번호를 함께 표시한다', async () => {
  const status = {...captured(), running: true, navigation: {
    workflow: 'repair', repairQueue: ['/@tester/post/one', '/@tester/post/two', '/@tester/post/three'], repairIndex: 1,
    activeChain: {total: 3, members: [{part: 2, id: '/@tester/post/part2'}], missing: [1, 3]},
  }};
  const ui = await popup({status});
  try {
    const text = ui.dom.window.document.getElementById('message').textContent;
    assert.match(text, /미완료 글 재수집: 2\/3묶음/);
    assert.match(text, /현재 연속글: 1\/3개 확보 · 남은 번호 1, 3/);
  } finally { ui.dom.window.close(); }
});

test('저장 응답에 과거 관계가 남아도 미확보 번호를 현재 확보 개수에 포함하지 않는다', async () => {
  const status = {...captured(), running: true, navigation: {
    workflow: 'repair', repairQueue: ['/@tester/post/one'], repairIndex: 0,
    activeChain: {total: 2, members: [{part: 1, id: '/@tester/post/one'}, {part: 2, id: '/@tester/post/two'}], missing: [1]},
  }};
  const ui = await popup({status});
  try {
    const text = ui.dom.window.document.getElementById('message').textContent;
    assert.match(text, /현재 연속글: 1\/2개 확보 · 남은 번호 1/);
    assert.doesNotMatch(text, /현재 연속글: 2\/2개 확보/);
  } finally { ui.dom.window.close(); }
});

test('미완료 재수집 대상이나 탭이 바뀌어 거부되면 기존 자료와 재시도 버튼을 보존한다', async () => {
  const status = {...captured(), capture: {...captured().capture, chainCount: 2, completedChainCount: 1}};
  const ui = await popup({status, repairError: '대상 계정의 프로필 또는 글 탭을 여세요.'});
  try {
    assert.ok(ui.button('repair'));
    ui.button('repair').click(); await settled();
    assert.match(ui.dom.window.document.getElementById('message').textContent, /대상 계정의 프로필/);
    assert.equal(ui.button('repair').disabled, false);
    assert.equal(ui.button('save').disabled, false);
    assert.equal(ui.confirmations.length, 0);
    assert.deepEqual(ui.state.status, status);
  } finally { ui.dom.window.close(); }
});
