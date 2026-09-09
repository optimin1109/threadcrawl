import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export class SourceError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
// Source contract: id, scope, fetch(cursor, {signal}) -> {items,next,end,coverageKnown,issues}.
// Each item is a normalized logical candidate, never an invented Threads response.
export class FixtureSource {
  constructor(file, account, delayMs = 0) {
    const bytes = readFileSync(file);
    this.data = JSON.parse(bytes);
    this.id = 'fixture:' + createHash('sha256').update(bytes).digest('hex');
    this.scope = 'fixture'; this.account = account; this.delayMs = delayMs;
  }
  async fetch(cursor, { signal } = {}) {
    if (this.delayMs) await new Promise(resolve => {
      const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, this.delayMs); signal?.addEventListener('abort', done, { once: true });
      if (signal?.aborted) done();
    });
    const index = cursor === null ? 0 : Number(cursor);
    if (!Number.isInteger(index) || index < 0 || index > this.data.pages.length) throw new SourceError('invalid', 'fixture 위치 오류');
    const page = this.data.pages[index];
    if (!page) return { items: [], next: null, end: true, coverageKnown: true, issues: [] };
    if (page.error) throw new SourceError(page.error.code, page.error.message);
    const items = structuredClone(page.items).map(item => ({ ...item, actor: item.actor === '$account' ? this.account : item.actor }));
    const end = index === this.data.pages.length - 1;
    return { items, next: end ? null : String(index+1), end, coverageKnown: this.data.coverageKnown === true, issues: page.issues || [] };
  }
}
export class ThreadsSource {
  id = 'threads-unverified-v1'; scope = 'live';
  async fetch() {
    // No guessed selectors, private APIs, browser credentials, or automatic login.
    throw new SourceError('unverified', '실제 Threads 수집 미구현: 과거 목록 끝, 최초 작성 묶음, 리포스트 시점, 긴 첨부 전문과 로그인별 접근 범위를 검증하지 못했습니다. Chrome 창은 수동 확인 전용입니다.');
  }
}
