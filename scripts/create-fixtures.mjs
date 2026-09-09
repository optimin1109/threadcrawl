// Maintainer utility: deterministic synthetic fixtures and machine-readable contracts.
import fs from 'node:fs';
const string = { type: 'string' }, bool = { type: 'boolean' }, nullable = { type: ['string','null'] }, count = { type: 'integer', minimum: 0 };
const array = items => ({ type: 'array', items });
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const failure = object({ id: nullable, reason: string });
const part = object({ id: string, timestamp: string, text: nullable, label: nullable, orderEvidence: nullable, failure: nullable });
const item = object({ id: string, actor: string, kind: { enum: ['original','quote','repost','bundle','reply','unknown'] }, timestamp: string, bundleEvidence: nullable, repostTimestampVerified: bool, parts: array(part) });
const status = { enum: ['진행 중','완료','불완전','중단'] };
const schemas = {
  item,
  page: object({ items: array(item), next: nullable, end: bool, coverageKnown: bool, issues: array(failure) }),
  'collection-state': object({ schemaVersion: { enum: [1] }, account: string, sourceId: string, scope: { enum: ['fixture','live'] }, startedAt: string, runStartedAt: string, startPosition: nullable, lastConfirmedPosition: nullable, nextCursor: nullable, discoveredIds: array(string), records: array(item), processed: array(object({ id: string, disposition: { enum: ['stored','media','reply','failed'] } })), deduplication: object({ complete: bool, duplicates: count }), resume: object({ supported: bool, attempts: count }), endReached: bool, coverageKnown: bool, issues: array(failure), status, outputGeneration: count }),
  'collection-report': object({ schemaVersion: { enum: [1] }, account: string, sourceId: string, scope: { enum: ['fixture','live'] }, startedAt: string, endedAt: nullable, discoveredCount: count, savedCount: count, excludedNoTextCount: count, excludedReplyCount: count, duplicateCount: count, failedItems: array(failure), finalStatus: status, endReached: bool, coverageKnown: bool, outputGeneration: count, completionScope: string })
};
fs.mkdirSync('schemas',{recursive:true});
for (const [name,s] of Object.entries(schemas)) fs.writeFileSync(`schemas/${name}.schema.json`, JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: name, ...s }, null, 2)+'\n');
const p = (id,text,label=null) => ({ id, timestamp: '2025-01-01T16:00:00Z', text, label, orderEvidence: label ? 'synthetic fixture: explicitly observed label' : null, failure: null });
const post = (id,kind,text) => ({ id, actor: '$account', kind, timestamp: '2025-01-01T16:00:00Z', bundleEvidence: null, repostTimestampVerified: kind === 'repost', parts: [p(id+'-text', text)] });
const first = post('original','original','첫 글입니다. 😀\n둘째 줄과 외부 링크 https://example.com/path?q=1&v=2\n# 제목 아님 *강조 아님* [링크 아님](주소) <b>태그 아님</b>');
first.timestamp = '2024-12-31T14:00:00Z'; first.parts[0].timestamp = first.timestamp;
const numbered = post('numbered','bundle',''); numbered.bundleEvidence = 'synthetic fixture: created together'; numbered.parts = [p('n2','두 번째','2/2'),p('n1','첫 번째','1/2')];
const unordered = post('unordered','bundle',''); unordered.bundleEvidence = 'synthetic fixture: created together; order unknown'; unordered.parts = [p('u1','관계만 확인한 부분 가'),p('u2','관계만 확인한 부분 나')];
const other = post('other-reply','reply','다른 사용자 답글'); other.actor = 'someone_else';
const long = post('long','original','긴 텍스트 전문\n' + '한글 😀와 줄바꿈을 보존합니다.\n'.repeat(350));
const items = [post('quote','quote','대상 계정이 덧붙인 텍스트만'),post('media','original',''),numbered,post('self-late','reply','나중에 추가한 자기 답글'),other,post('repost','repost','리포스트된 원글 한 개만'),unordered,long,first,first];
const demo = { description: '합성 데이터. 실제 Threads 응답/DOM 또는 관계 증거가 아님. 어떤 입력 계정에도 같은 데모를 표시함.', coverageKnown: true, pages: items.map(item => ({ items: [item] })) };
fs.mkdirSync('fixtures',{recursive:true}); fs.writeFileSync('fixtures/demo.json',JSON.stringify(demo,null,2)+'\n');
const partial = structuredClone(numbered); partial.id = 'partial'; partial.parts[0].text = null; partial.parts[0].failure = 'fixture: 두 번째 본문 접근 실패';
fs.writeFileSync('fixtures/partial.json',JSON.stringify({ description: demo.description, coverageKnown:false, pages:[{items:[first,partial],issues:[{id:null,reason:'fixture: 접근 범위 미확인'}]}] },null,2)+'\n');
