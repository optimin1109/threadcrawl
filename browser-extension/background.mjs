import {CaptureStore} from './storage.mjs';

export function createMessageHandler({store, chrome}) {
  let sequence = Promise.resolve();
  const isConnected = async control => {
    try {
      const reply = await chrome.tabs.sendMessage(control.tabId, {type: 'ping', runId: control.runId});
      return reply?.running && reply.runId === control.runId;
    } catch { return false; }
  };
  async function handle(message, sender = {}) {
    const control = await store.getControl();
    if (message.type === 'snapshot') {
      const identity = {tabId: sender.tab?.id, runId: message.runId};
      try { return await store.append(message.page, identity); }
      catch (error) {
        await store.finish('불완전', `수집 자료 저장 실패: ${error.message}`, identity).catch(() => {});
        throw error;
      }
    }
    if (message.type === 'start') {
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      const url = new URL(tab?.url || 'about:blank');
      const account = url.pathname.match(/^\/@([a-z0-9_.]+)\/?$/i)?.[1].toLowerCase();
      if (url.protocol !== 'https:' || url.hostname !== 'www.threads.com' || !account || !Number.isInteger(tab.id))
        throw new Error('대상 공개 계정의 스레드 목록 탭을 먼저 여세요.');
      if (control?.running) {
        if (await isConnected(control)) throw new Error('이미 수집 중입니다. 먼저 중지하세요.');
        await store.finish('불완전', '이전 수집 탭과 연결이 끊김', control);
      }
      const runId = crypto.randomUUID();
      await store.start(account, tab.id, runId);
      try {
        await chrome.scripting.executeScript({target: {tabId: tab.id},
          func: config => { globalThis.threadsArchiveConfig = config; },
          args: [{runId, maxRounds: 1800, intervalMs: 1500}]});
        await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['reader.js', 'content.js']});
      } catch (error) {
        await store.finish('불완전', `탭 접근 실패: ${error.message}`, {tabId: tab.id, runId});
        throw error;
      }
      return {ok: true};
    }
    if (message.type === 'status') {
      if (control?.running && !await isConnected(control))
        await store.finish('불완전', '수집 탭이 닫혔거나 새로고침되어 수집기 연결이 끊김', control);
      return store.status();
    }
    if (message.type === 'export') return {capture: await store.exportCapture()};
    if (message.type === 'stop' || message.type === 'ended') {
      if (!control) return {ok: false};
      const identity = message.type === 'stop' ? control : {tabId: sender.tab?.id, runId: message.runId};
      const result = await store.finish(message.type === 'stop' ? '중단' : '불완전',
        message.type === 'stop' ? '사용자 중지' : String(message.reason ?? '자동 탐색 중지'), identity);
      if (message.type === 'stop') await chrome.tabs.sendMessage(control.tabId, {type: 'stop', runId: control.runId}).catch(() => {});
      return result;
    }
    throw new Error('지원하지 않는 요청');
  }
  return (message, sender) => {
    const pending = sequence.then(() => handle(message, sender));
    sequence = pending.catch(() => {});
    return pending;
  };
}

if (globalThis.chrome?.runtime?.onMessage) {
  const handle = createMessageHandler({store: new CaptureStore(), chrome: globalThis.chrome});
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    handle(message, sender).then(reply, error => reply({error: error.message}));
    return true;
  });
}
