import {CaptureStore} from './storage.mjs';

export function createMessageHandler({store, chrome, now = Date.now, maxRecoveryAttempts = 3}) {
  let sequence = Promise.resolve();
  const duration = 1800 * 1500;
  const isConnected = async control => {
    try {
      const reply = await chrome.tabs.sendMessage(control.tabId, {type: 'ping', runId: control.runId});
      if (reply?.runId === control.runId) return {state: reply.running ? 'running' : 'stopped', reason: reply.reason};
      return {state: 'unreachable'};
    } catch (error) { return {state: 'unreachable', error: error.message}; }
  };
  const allowedLocation = (tab, control) => {
    try {
      const url = new URL(tab.url);
      if (url.protocol !== 'https:' || url.hostname !== 'www.threads.com') return false;
      const navigation = control.navigation ?? {mode: 'profile', profilePath: `/@${control.account}`};
      const current = url.pathname.replace(/\/$/, '');
      const profile = navigation.profilePath;
      const detail = navigation.activeChain?.rootId;
      if (navigation.mode === 'profile') return current === profile;
      if (navigation.mode === 'detail') return current === detail;
      return ['opening', 'returning'].includes(navigation.mode) && (current === profile || current === detail);
    } catch { return false; }
  };
  const inject = async control => {
    await chrome.scripting.executeScript({target: {tabId: control.tabId},
      func: config => { globalThis.threadsArchiveConfig = config; },
      args: [{runId: control.runId, maxRounds: 1800, intervalMs: 1500, navigation: control.navigation,
        startedAt: control.startedAt, chains: await store.getChains()}]});
    await chrome.scripting.executeScript({target: {tabId: control.tabId}, files: ['reader.js', 'chains.js', 'content.js']});
  };
  const reconcile = async (recover = false, observedTab = null) => {
    const control = await store.getControl();
    if (!control?.running) return null;
    if (Number.isFinite(control.startedAt) && now() - control.startedAt >= duration) {
      await store.finish('불완전', '자동 탐색 시간 상한 도달. 전체 범위 미확인', control);
      await chrome.tabs.sendMessage(control.tabId, {type: 'stop', runId: control.runId}).catch(() => {});
      return null;
    }
    let tab;
    try { tab = observedTab ?? await chrome.tabs.get(control.tabId); }
    catch { return '연결 확인 중 — 탭 상태를 확인할 수 없습니다.'; }
    if (tab.discarded || tab.frozen || tab.status === 'loading') return '탭 복원·로딩 대기 중 — 저장한 자료와 탐색 위치를 보존합니다.';
    if (typeof tab.url !== 'string' || !tab.url) return '연결 확인 중 — 대상 탭 주소를 아직 확인할 수 없습니다.';
    if (!allowedLocation(tab, control)) {
      await store.finish('불완전', '저장한 탐색 위치 밖의 페이지로 이동하여 중단', control);
      return null;
    }
    let connection = await isConnected(control);
    if (recover && connection.state === 'unreachable') connection = await isConnected(control);
    if (connection.state === 'running') return null;
    if (connection.state === 'stopped') {
      await store.finish('불완전', connection.reason ?? '수집기가 중단됨', control);
      return null;
    }
    if (!recover) return '연결 확인 중 — 이미 저장한 자료는 보존됩니다.';
    const attempts = (control.recoveryAttempts ?? 0) + 1;
    if (attempts > maxRecoveryAttempts) {
      await store.finish('불완전', '자동 재연결 상한 도달. 저장한 자료를 확인한 뒤 다시 시작하세요.', control);
      return null;
    }
    await store.start(control.account, control.tabId, crypto.randomUUID(), {
      navigation: control.navigation, startedAt: control.startedAt ?? now(), recoveryAttempts: attempts});
    const resumed = await store.getControl();
    try { await inject(resumed); return '저장한 탐색 위치에서 다시 연결했습니다.'; }
    catch (error) {
      if (attempts === maxRecoveryAttempts) await store.finish('불완전', `자동 재연결 실패: ${error.message}`, resumed);
      return `연결 확인 중 — 재주입 실패: ${error.message}`;
    }
  };
  async function handle(message, sender = {}) {
    const control = await store.getControl();
    if (message.type === 'reset') {
      if (sender.tab || !chrome.runtime?.id || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html'))
        throw new Error('초기화는 확장 팝업에서만 요청할 수 있습니다.');
      if (!control || message.account !== control.account || message.runId !== control.runId)
        throw new Error('초기화 대상이 바뀌었습니다. 팝업에서 계정을 다시 확인하세요.');
      return store.resetCapture({account: control.account, runId: control.runId});
    }
    if (['snapshot', 'checkpoint', 'chain'].includes(message.type)) {
      const identity = {tabId: sender.tab?.id, runId: message.runId};
      try {
        if (message.type === 'checkpoint') return await store.checkpoint(message.navigation, identity);
        if (message.type === 'chain') return await store.recordChain(message.chain, identity);
        return await store.append(message.page, identity);
      }
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
        if ((await isConnected(control)).state === 'running') throw new Error('이미 수집 중입니다. 먼저 중지하세요.');
        await store.finish('불완전', '이전 수집 탭과 연결이 끊김', control);
      }
      const runId = crypto.randomUUID();
      await store.start(account, tab.id, runId, {startedAt: now()});
      try {
        await inject(await store.getControl());
      } catch (error) {
        await store.finish('불완전', `탭 접근 실패: ${error.message}`, {tabId: tab.id, runId});
        throw error;
      }
      return {ok: true};
    }
    if (message.type === 'status') {
      const connectionStatus = await reconcile();
      return {...await store.status(), connectionStatus};
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
  const enqueue = work => {
    const pending = sequence.then(work);
    sequence = pending.catch(() => {});
    return pending;
  };
  const send = (message, sender) => enqueue(() => handle(message, sender));
  send.onRemoved = tabId => enqueue(async () => {
    const control = await store.getControl();
    if (control?.running && control.tabId === tabId) await store.finish('불완전', '수집 탭이 닫힘', control);
  });
  send.onUpdated = (tabId, changeInfo, tab) => enqueue(async () => {
    const control = await store.getControl();
    if (control?.running && control.tabId === tabId &&
        (changeInfo.status === 'complete' || changeInfo.discarded === false || changeInfo.frozen === false)) await reconcile(true, tab);
  });
  send.onActivated = ({tabId}) => enqueue(async () => {
    const control = await store.getControl();
    if (control?.running && control.tabId === tabId) await reconcile(true);
  });
  return send;
}

if (globalThis.chrome?.runtime?.onMessage) {
  const handle = createMessageHandler({store: new CaptureStore(), chrome: globalThis.chrome});
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    handle(message, sender).then(reply, error => reply({error: error.message}));
    return true;
  });
  chrome.tabs.onRemoved.addListener(tabId => { handle.onRemoved(tabId).catch(() => {}); });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => { handle.onUpdated(tabId, changeInfo, tab).catch(() => {}); });
  chrome.tabs.onActivated.addListener(info => { handle.onActivated(info).catch(() => {}); });
}
