export const WARNING = '[수집 실패: 이 게시물의 일부 내용을 확인하지 못함]';
export function accountName(value) {
  const name = value.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    throw new Error('계정명은 영문, 숫자, 밑줄, 중간 마침표로 입력하세요 (1~30자).');
  return name;
}
export function kst(timestamp) {
  if (typeof timestamp !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp)))
    throw new Error('시간대가 명시된 실제 게시 날짜가 필요합니다.');
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}
// Escape all Markdown punctuation; URLs remain visibly identical after rendering.
// Hard line breaks preserve source newlines; leading whitespace is encoded to avoid code blocks.
export function literal(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => line
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#+.!|~\-])/g, '\\$1')
    .replace(/^[ \t]+/, s => [...s].map(c => c === '\t' ? '&#9;' : '&#32;').join(''))).join('  \n');
}
export function classify(item, account) {
  const fail = reason => ({ disposition: 'failed', failures: [{ id: item.id, reason }] });
  if (item.kind === 'reply' || item.actor !== account) return { disposition: 'reply', failures: [] };
  if (!['original', 'quote', 'repost', 'bundle'].includes(item.kind)) return fail('게시물 유형 또는 답글 관계 미확인');
  if (item.kind === 'bundle' && !item.bundleEvidence) return fail('최초 작성 시 묶음 관계를 확인하지 못함');
  if (item.kind === 'repost' && !item.repostTimestampVerified) return fail('리포스트 시점을 확인하지 못함');
  try { kst(item.timestamp); } catch (e) { return fail(e.message); }
  if (!Array.isArray(item.parts) || !item.parts.length) return fail('본문 확인 결과 없음');
  if (item.kind !== 'bundle' && item.parts.length !== 1) return fail('단일 게시물에 여러 본문이 제공됨');
  const failures = [];
  const parts = item.parts.map(p => {
    let reason = p.failure;
    if (p.text !== null && typeof p.text !== 'string') reason = '본문 형식 오류';
    if (p.text === null && !reason) reason = '본문 미확인';
    try { kst(p.timestamp); } catch { reason = '부분 게시 날짜 미확인'; }
    if (p.label && (!/^\d+\/\d+$/.test(p.label) || !p.orderEvidence)) reason = '순번 검증 근거 없음';
    if (reason) failures.push({ id: p.id, reason });
    return { ...p, failure: reason };
  });
  if (!failures.length && parts.every(p => !p.text.trim())) return { disposition: 'media', failures };
  // A verified label is the only permitted ordering key. No inferred labels/counts.
  if (item.kind === 'bundle' && parts.every(p => p.label && p.orderEvidence)) {
    const labels = parts.map(p => p.label.split('/').map(Number));
    if (new Set(labels.map(x => x[0])).size !== labels.length || new Set(labels.map(x => x[1])).size !== 1 || labels.some(([n,t]) => n < 1 || n > t) || labels[0][1] !== parts.length)
      return fail('묶음 순번 충돌 또는 확인된 위치 누락: 명시적 실패 부분이 필요함');
    parts.sort((a,b) => Number(a.label.split('/')[0]) - Number(b.label.split('/')[0]));
  }
  // Date-spanning bundle policy is intentionally conservative until service validation.
  if (item.kind === 'bundle' && new Set(parts.map(p => { try { return kst(p.timestamp); } catch { return '?'; } })).size > 1)
    failures.push({ id: item.id, reason: '날짜를 넘는 묶음: 대표 날짜 정책 실서비스 미검증 (확인된 묶음 시작 날짜 사용)' });
  return { disposition: 'stored', failures, post: { ...item, parts } };
}
export function project(records, account) {
  const results = records.map(item => ({ id: item.id, ...classify(item, account) }));
  const posts = results.filter(r => r.post).map(r => r.post).sort((a,b) => Date.parse(a.timestamp)-Date.parse(b.timestamp) || a.id.localeCompare(b.id));
  const bodies = posts.map(p => {
    const body = p.parts.filter(x => x.failure || x.text.trim()).map(x => {
      const heading = p.kind === 'bundle' ? `### ${x.label && x.orderEvidence ? x.label : '이어지는 글'}\n\n` : '';
      return heading + (typeof x.text === 'string' && x.text.trim() ? literal(x.text) : '') + (x.failure ? `${x.text ? '\n\n' : ''}${WARNING}` : '');
    }).join('\n\n');
    return `## ${kst(p.timestamp)}\n\n${p.kind === 'repost' ? '**리포스트**\n\n' : ''}${body}`;
  });
  return { markdown: `# @${account} Threads 보관본\n\n${bodies.join('\n\n---\n\n')}\n`, results,
    failures: results.flatMap(r => r.failures), stored: posts.length,
    media: results.filter(r => r.disposition === 'media').length, replies: results.filter(r => r.disposition === 'reply').length };
}
