import {CaptureStore} from './storage.mjs';

export function createMessageHandler({store, chrome, now = Date.now, maxRecoveryAttempts = 3}) {
  let sequence = Promise.resolve();
  const duration = 1800 * 1500;
  const fromPopup = sender => !sender.tab && chrome.runtime?.id && sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html');
  const ownPost = (id, account) => typeof id === 'string' && id.startsWith(`/@${account}/post/`) && /^\/@[a-z0-9_.]+\/post\/[A-Za-z0-9_-]+$/i.test(id);
  const repairable = (chain, account) => ownPost(chain?.rootId, account) && ['pending', 'incomplete'].includes(chain.status) &&
    Number.isInteger(chain.total) && chain.total >= 2 && chain.total <= 1000 && Array.isArray(chain.members) &&
    chain.members.every(member => Number.isInteger(member.part) && member.part >= 1 && member.part <= chain.total && ownPost(member.id, account));
  const repairNavigation = (navigation, chain, index) => {
    const parts = Array.from({length: chain.total}, (_, i) => i + 1);
    const missing = new Set(Array.isArray(chain.missing) ? chain.missing : parts);
    const members = chain.members.filter(member => !missing.has(member.part));
    const activeChain = {...structuredClone(chain), status: 'pending', members,
      missing: parts.filter(part => !members.some(member => member.part === part))};
    delete activeChain.completedFrom;
    return {...navigation, mode: 'opening', repairIndex: index, activeChain, detailStartedAt: now(), resume: null};
  };
  const openRepair = async (control, navigation, startedAt) => {
    const runId = crypto.randomUUID();
    await store.start(control.account, control.tabId, runId, {navigation, startedAt, repairOpening: true});
    try { await chrome.tabs.update(control.tabId, {url: `https://www.threads.com${navigation.activeChain.rootId}`}); }
    catch (error) {
      await store.finish('불완전', `미완료 글 재수집 이동 실패: ${error.message}`, {tabId: control.tabId, runId});
      throw error;
    }
    return {ok: true};
  };
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
  const reconcile = async (recover = false, observedTab = null, navigationCompleted = false) => {
    const control = await store.getControl();
    if (!control?.running) return null;
    if (Number.isFinite(control.startedAt) && now() - control.startedAt >= duration) {
      await store.finish('불완전', '자동 탐색 시간 상한 도달. 전체 범위 미확인', control);
      await chrome.tabs.sendMessage(control.tabId, {type: 'stop', runId: control.runId}).catch(() => {});
      return null;
    }
    let tab;
    // onUpdated payloads can be queued behind a repair advancement. Read the
    // current tab again before injecting so an old root event cannot win.
    try { tab = control.navigation?.workflow === 'repair' ? await chrome.tabs.get(control.tabId) : observedTab ?? await chrome.tabs.get(control.tabId); }
    catch { return '연결 확인 중 — 탭 상태를 확인할 수 없습니다.'; }
    if (control.repairOpening) {
      if (now() - control.navigation.detailStartedAt >= 120000) {
        await store.finish('불완전', '미완료 글 재수집 상세 화면 이동 시간 상한 도달', control);
        return null;
      }
      const atExpectedRoot = allowedLocation(tab, {...control, navigation: {...control.navigation, mode: 'detail'}});
      const stillLoading = tab.discarded || tab.frozen || tab.status !== 'complete' || tab.pendingUrl;
      if (navigationCompleted && !stillLoading && tab.status === 'complete' && typeof tab.url === 'string' && tab.url && !atExpectedRoot) {
        await store.finish('불완전', '미완료 글 재수집 중 요청한 상세 글과 다른 화면으로 이동하여 중단', control);
        return null;
      }
      if (stillLoading || !atExpectedRoot)
        return '미완료 글의 상세 화면으로 이동 중입니다.';
      await store.start(control.account, control.tabId, control.runId, {navigation: control.navigation, startedAt: control.startedAt});
      try { await inject(await store.getControl()); return '저장된 미완료 글을 다시 확인합니다.'; }
      catch (error) {
        await store.finish('불완전', `미완료 글 재수집 연결 실패: ${error.message}`, control);
        return null;
      }
    }
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
      navigation: control.navigation, startedAt: control.startedAt ?? now(), recoveryAttempts: attempts, repairSavedRoot: control.repairSavedRoot});
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
      if (!fromPopup(sender))
        throw new Error('초기화는 확장 팝업에서만 요청할 수 있습니다.');
      if (!control || message.account !== control.account || message.runId !== control.runId)
        throw new Error('초기화 대상이 바뀌었습니다. 팝업에서 계정을 다시 확인하세요.');
      return store.resetCapture({account: control.account, runId: control.runId});
    }
    if (message.type === 'repair') {
      if (!fromPopup(sender)) throw new Error('미완료 글 재수집은 확장 팝업에서만 요청할 수 있습니다.');
      if (!control || message.account !== control.account || message.runId !== control.runId)
        throw new Error('재수집 대상이 바뀌었습니다. 팝업에서 계정을 다시 확인하세요.');
      if (control.running) throw new Error('이미 수집 중입니다. 먼저 중지하세요.');
      const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
      const url = new URL(tab?.url || 'about:blank');
      const path = url.pathname.replace(/\/$/, '');
      if (url.protocol !== 'https:' || url.hostname !== 'www.threads.com' || !Number.isInteger(tab.id) ||
          (path !== `/@${control.account}` && !ownPost(path, control.account)))
        throw new Error('저장된 자료와 같은 계정의 프로필 또는 게시물 탭을 먼저 여세요.');
      const chains = (await store.getChains()).filter(chain => repairable(chain, control.account));
      if (!chains.length) throw new Error('다시 수집할 미완료 연속글이 없습니다.');
      const navigation = repairNavigation({workflow: 'repair', profilePath: `/@${control.account}`,
        repairQueue: chains.map(chain => chain.rootId), visitedRoots: []}, chains[0], 0);
      return openRepair({...control, tabId: tab.id}, navigation, now());
    }
    if (message.type === 'repair-next') {
      const navigation = control?.navigation;
      if (!control?.running || sender.tab?.id !== control.tabId || message.runId !== control.runId ||
          navigation?.workflow !== 'repair' || navigation.mode !== 'returning' ||
          message.rootId !== navigation.activeChain?.rootId || control.repairSavedRoot !== message.rootId ||
          navigation.repairQueue[navigation.repairIndex] !== message.rootId) return {ok: false};
      const chains = await store.getChains(), saved = chains.find(chain => chain.rootId === message.rootId);
      if (!saved || !['complete', 'incomplete'].includes(saved.status)) return {ok: false};
      let tab;
      try { tab = await chrome.tabs.get(control.tabId); }
      catch {
        await store.finish('불완전', '미완료 글 재수집 탭을 확인하지 못해 중단', control);
        return {ok: false};
      }
      const expected = {...control, navigation: {...navigation, mode: 'detail'}};
      if (!allowedLocation(tab, expected) || (tab.pendingUrl && !allowedLocation({url: tab.pendingUrl}, expected))) {
        await store.finish('불완전', '미완료 글 재수집 중 다른 화면으로 이동하여 중단. 저장한 자료는 보존했습니다.', control);
        return {ok: false};
      }
      if (tab.discarded || tab.frozen || tab.status !== 'complete' || tab.pendingUrl) return {ok: false};
      const expired = now() - control.startedAt >= duration;
      if (!expired) for (let index = navigation.repairIndex + 1; index < navigation.repairQueue.length; index++) {
        const next = chains.find(chain => chain.rootId === navigation.repairQueue[index]);
        if (repairable(next, control.account)) return openRepair(control, repairNavigation(navigation, next, index), control.startedAt);
      }
      const unresolved = chains.filter(chain => navigation.repairQueue.includes(chain.rootId) && chain.status !== 'complete').length;
      await store.finish('중단', expired ? '미완료 글 재수집 시간 상한 도달. 저장한 자료를 보존했습니다.'
        : `미완료 글 재수집 종료. 남은 미완료 ${unresolved}묶음.`, control);
      try { await chrome.tabs.update(control.tabId, {url: `https://www.threads.com${navigation.profilePath}`}); }
      catch { return {ok: true, warning: '재수집은 종료했으나 프로필 화면으로 이동하지 못했습니다.'}; }
      return {ok: true};
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
        (changeInfo.status === 'complete' || changeInfo.discarded === false || changeInfo.frozen === false)) await reconcile(true, tab, changeInfo.status === 'complete');
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
