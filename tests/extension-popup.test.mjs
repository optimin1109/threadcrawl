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

async function popup({status = captured(), confirmed = true, resetError = null} = {}) {
  const dom = new JSDOM(html, {runScripts: 'outside-only'}), sent = [], confirmations = [];
  const state = {status};
  dom.window.chrome = {runtime: {sendMessage: async message => {
    sent.push({...message});
    if (message.type === 'status') return structuredClone(state.status);
    if (message.type === 'reset') {
      if (resetError) return {error: resetError};
      state.status = {capture: null, running: false, resetRunId: null}; return {ok: true};
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
