import {newCapture, mergeCard, assertPage} from './capture.mjs';

const request = value => new Promise((resolve, reject) => {
  value.onsuccess = () => resolve(value.result);
  value.onerror = () => reject(value.error);
});
const storeNames = ['captures', 'cards', 'issues', 'control', 'chains'];
const matches = (control, identity) => control?.running && identity.tabId === control.tabId && identity.runId === control.runId;
const initialNavigation = account => ({mode: 'profile', profilePath: `/@${account}`, activeChain: null, resume: null, visitedRoots: []});
const chainValidationVersion = 1;
const cleanCard = card => typeof card?.text === 'string' && Array.isArray(card.issues) && !card.issues.length;
const cardContent = card => JSON.stringify([card.id, card.timestamp, card.text, card.label, card.context,
  card.attachments, card.notes ?? [], card.groupIds]);
async function storedMissing(stores, account, chain, members = new Map(chain.members.map(member => [member.part, member.id]))) {
  const missing = [], conflictParts = new Set((chain.conflicts ?? []).map(item => item.part));
  for (let part = 1; part <= chain.total; part++) {
    const item = members.has(part) ? (await request(stores.cards.get([account, members.get(part)])))?.card : null;
    if (!item || (part === 1 && item.id !== chain.rootId) || item.label !== `${part}/${chain.total}`
      || typeof item.text !== 'string' || !Array.isArray(item.issues) || item.issues.length || conflictParts.has(part)) missing.push(part);
  }
  return missing;
}
export class CaptureStore {
  constructor({indexedDB = globalThis.indexedDB, name = 'threads-text-archive-v2'} = {}) {
    this.database = new Promise((resolve, reject) => {
      const opening = indexedDB.open(name, 2);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains('captures')) db.createObjectStore('captures', {keyPath: 'account'});
        if (!db.objectStoreNames.contains('control')) db.createObjectStore('control');
        for (const name of ['cards', 'issues', 'chains']) {
          if (!db.objectStoreNames.contains(name))
            db.createObjectStore(name, {keyPath: ['account', name === 'issues' ? 'key' : name === 'chains' ? 'rootId' : 'id']}).createIndex('account', 'account');
        }
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
  }
  async transaction(mode, work) {
    const db = await this.database;
    const tx = db.transaction(storeNames, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error ?? new Error('저장 트랜잭션이 중단되었습니다.'));
      tx.onerror = () => {};
    });
    done.catch(() => {});
    const stores = Object.fromEntries(storeNames.map(name => [name, tx.objectStore(name)]));
    try {
      const result = await work(stores);
      await done;
      return result;
    } catch (error) {
      try { tx.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  async validatedMeta(stores, account) {
    const meta = await request(stores.captures.get(account));
    if (!meta || meta.chainValidationVersion === chainValidationVersion) return meta;
    // Upgrade old completion claims once per account, in the same transaction
    // as their counters. Never alter archived cards to make a claim pass.
    const rows = await request(stores.chains.index('account').getAll(account));
    meta.chainCount = rows.length; meta.completedChainCount = 0; meta.incompleteChainCount = 0;
    for (const row of rows) {
      const chain = row.chain;
      if (chain.status === 'complete') {
        const missing = await storedMissing(stores, account, chain);
        if (missing.length || chain.conflictDetected || chain.conflicts?.length) {
          row.chain = {...chain, status: 'incomplete', missing,
            reason: chain.reason || '기존 완료 기록 재검증: 저장된 게시물의 순번·본문 또는 관계 확인이 끝나지 않음'};
          stores.chains.put(row);
        }
      }
      meta.completedChainCount += Number(row.chain.status === 'complete');
      meta.incompleteChainCount += Number(row.chain.status === 'incomplete');
    }
    meta.chainValidationVersion = chainValidationVersion;
    stores.captures.put(meta);
    return meta;
  }
  async start(account, tabId, runId, options = {}) {
    return this.transaction('readwrite', async stores => {
      let meta = await this.validatedMeta(stores, account);
      if (!meta) {
        const {cards, issues, ...initial} = newCapture(account, crypto.randomUUID());
        meta = {...initial, cardCount: 0, issueCount: 0, oldestTimestamp: null, newestTimestamp: null, chainValidationVersion};
      }
      meta.chainCount ??= 0; meta.completedChainCount ??= 0; meta.incompleteChainCount ??= 0;
      meta.status = '진행 중'; meta.reason = null;
      stores.captures.put(meta);
      stores.control.put({account, tabId, runId, running: true, startedAt: options.startedAt ?? Date.now(),
        recoveryAttempts: options.recoveryAttempts ?? 0,
        repairOpening: Boolean(options.repairOpening), repairSavedRoot: options.repairSavedRoot ?? null,
        navigation: structuredClone(options.navigation ?? initialNavigation(account))}, 'active');
      return {ok: true};
    });
  }
  async getControl() { return this.transaction('readonly', stores => request(stores.control.get('active'))); }
  async resetCapture(expected = {}) {
    return this.transaction('readwrite', async stores => {
      const control = await request(stores.control.get('active'));
      if (control?.running) throw new Error('수집 중에는 초기화할 수 없습니다. 먼저 중지하세요.');
      if (!control || control.account !== expected.account || control.runId !== expected.runId)
        throw new Error('초기화 대상이 바뀌었습니다. 팝업에서 계정을 다시 확인하세요.');
      // Delete every account-owned row and its old run identity atomically, so
      // late collector messages cannot restore a partially reset capture.
      stores.captures.delete(control.account);
      for (const name of ['cards', 'issues', 'chains']) {
        const keys = await request(stores[name].index('account').getAllKeys(control.account));
        for (const key of keys) stores[name].delete(key);
      }
      stores.control.delete('active');
      return {ok: true};
    });
  }
  async checkpoint(navigation, identity) {
    return this.transaction('readwrite', async stores => {
      const control = await request(stores.control.get('active'));
      if (!matches(control, identity)) return {ok: false};
      if (control.navigation?.workflow === 'repair' && (navigation?.workflow !== 'repair' ||
          !['opening', 'detail', 'returning'].includes(navigation.mode) ||
          navigation.repairIndex !== control.navigation.repairIndex ||
          JSON.stringify(navigation.repairQueue) !== JSON.stringify(control.navigation.repairQueue) ||
          navigation.activeChain?.rootId !== control.navigation.activeChain?.rootId))
        throw new Error('재수집할 글과 순서는 변경할 수 없습니다.');
      if (control.navigation?.workflow !== 'repair' && navigation?.workflow === 'repair')
        throw new Error('재수집은 팝업에서 시작하세요.');
      if (!navigation || !['profile', 'opening', 'detail', 'returning'].includes(navigation.mode) || navigation.profilePath !== `/@${control.account}`)
        throw new Error('현재 계정의 탐색 위치가 아닙니다.');
      if (navigation.activeChain != null && (typeof navigation.activeChain.rootId !== 'string' ||
          !navigation.activeChain.rootId.startsWith(`/@${control.account}/post/`) || !/^\/@[a-z0-9_.]+\/post\/[A-Za-z0-9_-]+$/i.test(navigation.activeChain.rootId)))
        throw new Error('현재 계정의 연속글 상세 위치가 아닙니다.');
      control.navigation = structuredClone(navigation);
      stores.control.put(control, 'active');
      return {ok: true};
    });
  }
  async recordChain(chain, identity) {
    return this.transaction('readwrite', async stores => {
      const control = await request(stores.control.get('active'));
      if (!matches(control, identity)) return {ok: false};
      if (control.navigation?.workflow === 'repair' && chain?.rootId !== control.navigation.activeChain?.rootId)
        throw new Error('현재 재수집 중인 첫 글의 기록이 아닙니다.');
      const validId = id => typeof id === 'string' && id.startsWith(`/@${control.account}/post/`) && /^\/@[a-z0-9_.]+\/post\/[A-Za-z0-9_-]+$/i.test(id);
      if (!validId(chain?.rootId) || !Number.isInteger(chain.total) || chain.total < 1 || chain.total > 10000 ||
          !['pending', 'complete', 'incomplete'].includes(chain.status) || !Array.isArray(chain.members)) throw new Error('연속글 확인 기록 형식이 잘못되었습니다.');
      const meta = await this.validatedMeta(stores, control.account);
      const previous = await request(stores.chains.get([control.account, chain.rootId]));
      const members = new Map((previous?.chain.members ?? []).map(member => [member.part, member.id]));
      const conflicts = [...new Map([...(previous?.chain.conflicts ?? []), ...(chain.conflicts ?? [])].map(item => [JSON.stringify(item), item])).values()];
      let conflict = Boolean(previous?.chain.conflictDetected) || (previous && previous.chain.total !== chain.total) || conflicts.length > 0;
      for (const member of chain.members) {
        if (!Number.isInteger(member.part) || member.part < 1 || member.part > chain.total || !validId(member.id)) throw new Error('연속글 번호 또는 게시물 식별자가 잘못되었습니다.');
        if (members.has(member.part) && members.get(member.part) !== member.id) {
          conflict = true; conflicts.push({part: member.part, ids: [members.get(member.part), member.id]});
        }
        else members.set(member.part, member.id);
      }
      const total = Math.max(previous?.chain.total ?? 0, chain.total);
      const missing = await storedMissing(stores, control.account, {...chain, total, conflicts}, members);
      if (members.has(1) && members.get(1) !== chain.rootId) conflict = true;
      if (new Set(members.values()).size !== members.size) conflict = true;
      const status = conflict || (chain.status === 'complete' && missing.length) ? 'incomplete' : chain.status;
      const normalized = {...chain, total, status, missing, conflicts, conflictDetected: Boolean(conflict), members: [...members].sort((a, b) => a[0] - b[0]).map(([part, id]) => ({part, id})),
        reason: conflict ? '연속글 번호·총수·게시물 관계 충돌' : status === 'incomplete' && missing.length ? (chain.reason ?? '저장된 게시물의 순번·본문 확인이 끝나지 않음') : chain.reason ?? null};
      stores.chains.put({account: control.account, rootId: chain.rootId, chain: normalized});
      meta.chainCount = (meta.chainCount ?? 0) + Number(!previous);
      for (const [field, value] of [['completedChainCount', 'complete'], ['incompleteChainCount', 'incomplete']])
        meta[field] = (meta[field] ?? 0) + Number(status === value) - Number(previous?.chain.status === value);
      stores.captures.put(meta);
      if (control.navigation?.workflow === 'repair' && ['complete', 'incomplete'].includes(normalized.status)) {
        control.repairSavedRoot = normalized.rootId;
        stores.control.put(control, 'active');
      }
      return {ok: true, chain: normalized};
    });
  }
  async getChains() {
    return this.transaction('readwrite', async stores => {
      const control = await request(stores.control.get('active'));
      if (control) await this.validatedMeta(stores, control.account);
      return control ? (await request(stores.chains.index('account').getAll(control.account))).map(row => row.chain) : [];
    });
  }
  async finish(status, reason, identity) {
    return this.transaction('readwrite', async stores => {
      const control = await request(stores.control.get('active'));
      if (!control?.running || identity.tabId !== control.tabId || identity.runId !== control.runId) return {ok: false};
      const meta = await request(stores.captures.get(control.account));
      meta.status = status; meta.reason = reason; meta.updatedAt = new Date().toISOString();
      control.running = false;
      stores.captures.put(meta); stores.control.put(control, 'active');
      return {ok: true};
    });
  }
  async status() {
    return this.transaction('readwrite', async stores => {
      const control = await request(stores.control.get('active'));
      const capture = control ? await this.validatedMeta(stores, control.account) : null;
      return {capture: capture ? {chainCount: 0, completedChainCount: 0, incompleteChainCount: 0, ...capture} : null,
        resetRunId: control?.runId ?? null,
        running: Boolean(control?.running), navigation: control?.navigation ?? (control ? initialNavigation(control.account) : null)};
    });
  }
  async append(page, identity) {
    return this.transaction('readwrite', async stores => {
      const control = await request(stores.control.get('active'));
      if (!control?.running || identity.tabId !== control.tabId || identity.runId !== control.runId) return {ok: false};
      assertPage(page, control.account);
      const meta = await request(stores.captures.get(control.account));
      const issues = [...page.issues];
      let unchangedCleanPage = page.view === 'profile' && control.navigation?.mode === 'profile' &&
        !page.blocked && !page.loading && page.cards.length > 0 && !page.issues.length;
      for (const incoming of page.cards) {
        const old = await request(stores.cards.get([control.account, incoming.id]));
        const merged = mergeCard(old?.card, incoming);
        if (!cleanCard(old?.card) || !cleanCard(incoming) || merged.issue || cardContent(old.card) !== cardContent(merged.card))
          unchangedCleanPage = false;
        if (old) meta.duplicateCount++;
        else meta.cardCount++;
        stores.cards.put({account: control.account, id: incoming.id, card: merged.card, order: old?.order ?? meta.cardCount});
        if (merged.issue) issues.push(merged.issue);
        if (Number.isFinite(Date.parse(incoming.timestamp))) {
          if (!meta.oldestTimestamp || Date.parse(incoming.timestamp) < Date.parse(meta.oldestTimestamp)) meta.oldestTimestamp = incoming.timestamp;
          if (!meta.newestTimestamp || Date.parse(incoming.timestamp) > Date.parse(meta.newestTimestamp)) meta.newestTimestamp = incoming.timestamp;
        }
      }
      for (const issue of issues) {
        const key = JSON.stringify([issue.id, issue.reason]);
        if (!await request(stores.issues.get([control.account, key]))) {
          stores.issues.put({account: control.account, key, issue}); meta.issueCount++;
        }
      }
      meta.snapshots++; meta.updatedAt = page.capturedAt;
      control.recoveryAttempts = 0;
      if (page.blocked) {
        control.running = false; meta.status = '불완전'; meta.reason = '로그인/보안 확인/지원하지 않는 페이지 감지';
      }
      stores.control.put(control, 'active');
      stores.captures.put(meta);
      return {ok: control.running, unchangedCleanPage};
    });
  }
  async exportCapture() {
    return this.transaction('readwrite', async stores => {
      const control = await request(stores.control.get('active'));
      if (!control) return null;
      const meta = await this.validatedMeta(stores, control.account);
      const rows = await request(stores.cards.index('account').getAll(control.account));
      const issues = await request(stores.issues.index('account').getAll(control.account));
      const chains = await request(stores.chains.index('account').getAll(control.account));
      const {cardCount, issueCount, oldestTimestamp, newestTimestamp, ...capture} = meta;
      return {...capture, cards: rows.sort((a, b) => a.order - b.order).map(row => row.card), issues: issues.map(row => row.issue), chains: chains.map(row => row.chain)};
    });
  }
  async close() { (await this.database).close(); }
}
