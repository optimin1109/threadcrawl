import {newCapture, mergeCard, assertPage} from './capture.mjs';

const request = value => new Promise((resolve, reject) => {
  value.onsuccess = () => resolve(value.result);
  value.onerror = () => reject(value.error);
});
export class CaptureStore {
  constructor({indexedDB = globalThis.indexedDB, name = 'threads-text-archive-v2'} = {}) {
    this.database = new Promise((resolve, reject) => {
      const opening = indexedDB.open(name, 1);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        db.createObjectStore('captures', {keyPath: 'account'});
        db.createObjectStore('control');
        db.createObjectStore('cards', {keyPath: ['account', 'id']}).createIndex('account', 'account');
        db.createObjectStore('issues', {keyPath: ['account', 'key']}).createIndex('account', 'account');
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
  }
  async transaction(mode, work) {
    const db = await this.database;
    const tx = db.transaction(['captures', 'cards', 'issues', 'control'], mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error ?? new Error('저장 트랜잭션이 중단되었습니다.'));
      tx.onerror = () => {};
    });
    done.catch(() => {});
    const stores = Object.fromEntries(['captures', 'cards', 'issues', 'control'].map(name => [name, tx.objectStore(name)]));
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
  async start(account, tabId, runId) {
    return this.transaction('readwrite', async stores => {
      let meta = await request(stores.captures.get(account));
      if (!meta) {
        const {cards, issues, ...initial} = newCapture(account, crypto.randomUUID());
        meta = {...initial, cardCount: 0, issueCount: 0, oldestTimestamp: null, newestTimestamp: null};
      }
      meta.status = '진행 중'; meta.reason = null;
      stores.captures.put(meta);
      stores.control.put({account, tabId, runId, running: true}, 'active');
      return {ok: true};
    });
  }
  async getControl() { return this.transaction('readonly', stores => request(stores.control.get('active'))); }
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
    return this.transaction('readonly', async stores => {
      const control = await request(stores.control.get('active'));
      return {capture: control ? await request(stores.captures.get(control.account)) : null, running: Boolean(control?.running)};
    });
  }
  async append(page, identity) {
    return this.transaction('readwrite', async stores => {
      const control = await request(stores.control.get('active'));
      if (!control?.running || identity.tabId !== control.tabId || identity.runId !== control.runId) return {ok: false};
      assertPage(page, control.account);
      const meta = await request(stores.captures.get(control.account));
      const issues = [...page.issues];
      for (const incoming of page.cards) {
        const old = await request(stores.cards.get([control.account, incoming.id]));
        const merged = mergeCard(old?.card, incoming);
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
      if (page.blocked) {
        control.running = false; meta.status = '불완전'; meta.reason = '로그인/보안 확인/지원하지 않는 페이지 감지';
        stores.control.put(control, 'active');
      }
      stores.captures.put(meta);
      return {ok: control.running};
    });
  }
  async exportCapture() {
    return this.transaction('readonly', async stores => {
      const control = await request(stores.control.get('active'));
      if (!control) return null;
      const meta = await request(stores.captures.get(control.account));
      const rows = await request(stores.cards.index('account').getAll(control.account));
      const issues = await request(stores.issues.index('account').getAll(control.account));
      const {cardCount, issueCount, oldestTimestamp, newestTimestamp, ...capture} = meta;
      return {...capture, cards: rows.sort((a, b) => a.order - b.order).map(row => row.card), issues: issues.map(row => row.issue)};
    });
  }
  async close() { (await this.database).close(); }
}
