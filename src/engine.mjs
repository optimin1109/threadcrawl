import fs from 'node:fs';
import path from 'node:path';
import { accountName, project } from './domain.mjs';
import { atomicWrite, acquireLock, validate, schema } from './storage.mjs';
const now = () => new Date().toISOString();
export async function collect({ account, output, source, signal, onProgress = () => {}, wait = (ms) => new Promise(r => setTimeout(r,ms)) }) {
  account = accountName(account);
  const release = acquireLock();
  try {
    const dir = path.join(path.resolve(output), account);
    fs.mkdirSync(dir, { recursive: true });
    const stateFile = path.join(dir, 'collection-state.json');
    const stateSchema = schema('collection-state'), reportSchema = schema('collection-report');
    let state;
    if (fs.existsSync(stateFile)) {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); validate(stateSchema, state);
      if (state.account !== account || state.sourceId !== source.id || state.scope !== source.scope) throw new Error('기존 상태의 계정/수집 소스가 다릅니다. 다른 결과 폴더를 선택하세요.');
      if (new Set(state.discoveredIds).size !== state.discoveredIds.length || state.records.length !== state.discoveredIds.length || state.records.some((r,i) => r.id !== state.discoveredIds[i])) throw new Error('상태 파일 식별자 무결성 오류');
    } else state = { schemaVersion: 1, account, sourceId: source.id, scope: source.scope, startedAt: now(), runStartedAt: now(), startPosition: null, lastConfirmedPosition: null, nextCursor: null, discoveredIds: [], records: [], processed: [], deduplication: { complete: true, duplicates: 0 }, resume: { supported: true, attempts: 0 }, endReached: false, coverageKnown: false, issues: [], status: '진행 중', outputGeneration: 0 };
    state.runStartedAt = now(); state.resume.attempts++; state.status = '진행 중';
    state.deduplication.complete = true; // Re-established by the identifier integrity check above.
    // Source run errors are retryable on resume; page issues and item failures persist.
    let runFailures = [];
    function save(status) {
      const result = project(state.records, account);
      state.processed = result.results.map(r => ({ id: r.id, disposition: r.disposition }));
      state.outputGeneration++; state.status = '진행 중';
      validate(stateSchema, state); atomicWrite(stateFile, state);
      const failures = [...result.failures, ...state.issues, ...runFailures];
      const report = { schemaVersion: 1, account, sourceId: source.id, scope: source.scope, startedAt: state.runStartedAt, endedAt: status === '진행 중' ? null : now(), discoveredCount: state.discoveredIds.length, savedCount: result.stored, excludedNoTextCount: result.media, excludedReplyCount: result.replies, duplicateCount: state.deduplication.duplicates, failedItems: failures, finalStatus: status, endReached: state.endReached, coverageKnown: state.coverageKnown, outputGeneration: state.outputGeneration, completionScope: source.scope === 'fixture' ? '데모 fixture 범위만; 실제 계정 백업 아님' : '현재 접근 가능한 실제 공개 목록' };
      validate(reportSchema, report);
      atomicWrite(path.join(dir, `${account}.md`), result.markdown);
      atomicWrite(path.join(dir, 'collection-report.json'), report);
      state.status = status; atomicWrite(stateFile, state);
      onProgress(report); return report;
    }
    save('진행 중');
    const seenCursors = new Set();
    while (!state.endReached && !signal?.aborted) {
      const position = state.nextCursor;
      if (seenCursors.has(position)) { runFailures.push({ id: null, reason: '페이지 위치 반복: 끝까지 탐색 여부 미확인' }); break; }
      seenCursors.add(position);
      let page;
      for (let attempt = 0; attempt < 3 && !signal?.aborted; attempt++) {
        try { page = await source.fetch(position, { signal }); break; }
        catch (e) {
          // Security/login/access restriction signals are NEVER retried.
          if (!['transient', 'rate_limit'].includes(e.code) || attempt === 2) { runFailures.push({ id: null, reason: `${e.code || 'error'}: ${e.message}` }); break; }
          onProgress({ finalStatus: '진행 중', discoveredCount: state.discoveredIds.length, savedCount: project(state.records,account).stored, message: `일시 오류: ${2 ** attempt}초 후 재시도 (${attempt+1}/2)` });
          // Short bounded slices allow prompt stop during backoff; injectable deterministic wait.
          for (let ms = 0; ms < 1000 * 2 ** attempt && !signal?.aborted; ms += 100) await wait(100);
        }
      }
      if (signal?.aborted || !page) break;
      try {
        validate(schema('page'), page);
        if (!page.end && (page.next === null || page.next === position)) throw new Error('다음 페이지 위치 미확인');
        // Validate entire page before advancing cursor; malformed pages cannot partially commit.
        for (const item of page.items) {
          validate(schema('item'), item);
          if (!item.id.trim() || !item.actor.trim() || item.parts.some(p => !p.id.trim()) || new Set(item.parts.map(p => p.id)).size !== item.parts.length) throw new Error('식별자 누락 또는 부분 식별자 충돌');
        }
      } catch (e) { runFailures.push({ id: null, reason: `수집 소스 계약 오류: ${e.message}` }); break; }
      for (const item of page.items) {
        const index = state.discoveredIds.indexOf(item.id);
        if (index !== -1) {
          state.deduplication.duplicates++;
          if (JSON.stringify(state.records[index]) !== JSON.stringify(item)) state.issues.push({ id: item.id, reason: '동일 식별자의 내용 충돌: 먼저 확인한 내용을 보존함' });
        } else { state.discoveredIds.push(item.id); state.records.push(item); }
      }
      state.lastConfirmedPosition = position; state.nextCursor = page.next;
      state.endReached = page.end; state.coverageKnown = page.coverageKnown;
      if (!page.coverageKnown) state.issues.push({ id: null, reason: '페이지 접근 범위 미확인: 뒤 페이지의 정상 응답으로 누락 의심을 해제하지 않음' });
      state.issues.push(...page.issues); save('진행 중');
    }
    const projection = project(state.records, account);
    const status = signal?.aborted ? '중단' : state.endReached && state.coverageKnown && !projection.failures.length && !state.issues.length && !runFailures.length ? '완료' : '불완전';
    if (status === '불완전' && !state.coverageKnown) runFailures.push({ id: null, reason: '접근 가능한 전체 범위 또는 목록 끝을 확인하지 못함' });
    return save(status);
  } finally { release(); }
}
