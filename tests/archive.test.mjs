import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { classify, project, literal, kst, accountName, WARNING } from '../src/domain.mjs';
import { collect } from '../src/engine.mjs';
import { FixtureSource, SourceError, ThreadsSource } from '../src/sources.mjs';
import { validate, schema, acquireLock } from '../src/storage.mjs';
const demo = JSON.parse(fs.readFileSync(new URL('../fixtures/demo.json',import.meta.url)));
const records = demo.pages.flatMap(p => p.items).slice(0,-1).map(x => ({ ...x, actor: x.actor === '$account' ? 'tester' : x.actor }));
const get = id => structuredClone(records.find(x => x.id === id));
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(),'threads-tests-'));
const read = (root,file) => JSON.parse(fs.readFileSync(path.join(root,'tester',file)));
const fixture = name => new FixtureSource(new URL(`../fixtures/${name}.json`, import.meta.url),'tester');
function source(pages) { return { id:'test-source',scope:'fixture', calls:[],async fetch(cursor) {this.calls.push(cursor);return pages[cursor === null ? 0 : Number(cursor)];} }; }
const page = (items = [],extra = {}) => ({items,next:null,end:true,coverageKnown:true,issues:[],...extra});
test('일반 원글 및 같은 날짜 제목 반복 / 별개 게시물 구분', () => {
  const out=project([get('quote'),get('repost')],'tester');
  assert.equal(out.stored,2); assert.equal(out.markdown.match(/## 2025-01-02/g).length,2);
  assert.equal(out.markdown.split('\n\n---\n\n').length,2);
  assert.equal(classify(get('original'),'tester').disposition,'stored');
});
test('확인된 묶음 순서만 사용하고 관계 없는 묶음은 실패', () => {
  const out=project([get('numbered')],'tester'); assert.equal(out.stored,1);
  assert.ok(out.markdown.indexOf('### 1/2') < out.markdown.indexOf('### 2/2'));
  const item=get('numbered'); item.bundleEvidence=null;
  assert.equal(classify(item,'tester').disposition,'failed');
  item.bundleEvidence='verified'; item.parts[0].orderEvidence=null;
  assert.ok(classify(item,'tester').failures.length);
});
test('순서 없는 묶음은 이어지는 글, 순번 추측 없음', () => {
  const out=project([get('unordered')],'tester').markdown;
  assert.equal(out.match(/### 이어지는 글/g).length,2); assert.doesNotMatch(out,/### \d/);
});
test('나중 자기 답글 / 다른 사용자 답글 / 다른 글의 답글 제외', () => {
  assert.equal(project([get('self-late'),get('other-reply')],'tester').replies,2);
  const item=get('self-late'); item.id='reply-to-other';
  assert.equal(classify(item,'tester').disposition,'reply');
});
test('단순 리포스트는 한 원문만, 시점 미확인은 실패', () => {
  const item=get('repost'); const out=project([item],'tester');
  assert.match(out.markdown,/\*\*리포스트\*\*/); assert.equal(out.stored,1);
  item.parts.push(get('original').parts[0]); assert.equal(classify(item,'tester').disposition,'failed');
  item.parts.pop(); item.repostTimestampVerified=false; assert.equal(classify(item,'tester').disposition,'failed');
});
test('인용은 덧붙인 본문만, 미디어 전용과 빈 인용 흔적 없음', () => {
  const item=get('quote'); assert.match(project([item],'tester').markdown,/덧붙인 텍스트만/);
  item.parts[0].text=''; const out=project([item,get('media')],'tester'); assert.equal(out.media,2); assert.doesNotMatch(out.markdown,/## |---/);
});
test('긴 전문, 줄바꿈, 링크, 이모지 및 특수문자의 표시 보존', () => {
  const item=get('long'); assert.ok(item.parts[0].text.length > 5000);
  const out=project([item],'tester').markdown; assert.equal((out.match(/😀/g)||[]).length,350); assert.ok(out.includes('  \n'));
  assert.equal(literal('https://example.com/a?q=1&v=2'), 'https://example\\.com/a?q=1&amp;v=2');
  assert.equal(literal('# * [ ] ` <b> &\n    code'), '\\# \\* \\[ \\] \\` &lt;b&gt; &amp;  \n&#32;&#32;&#32;&#32;code');
  assert.equal(literal('---\n1. list\n![image](url)'), '\\-\\-\\-  \n1\\. list  \n\\!\\[image\\]\\(url\\)');
});
test('KST 날짜 경계, 시간대 없는 날짜 거부, 오래된 순 정렬', () => {
  assert.equal(kst('2025-01-01T15:00:00Z'),'2025-01-02');
  assert.throws(()=>kst('2025-01-01T15:00:00'));
  const out=project([get('quote'),get('original')],'tester').markdown;
  assert.ok(out.indexOf('2024-12-31') < out.indexOf('2025-01-02')); assert.doesNotMatch(out,/16:00|timestamp|fixture:/);
});
test('일부 묶음 실패는 해당 순번 위치에 정확한 경고', async () => {
  const p=await fixture('partial').fetch(null); const out=project(p.items,'tester');
  assert.ok(out.markdown.includes('### 2/2\n\n'+WARNING)); assert.ok(out.failures.length);
});
test('날짜를 넘는 묶음은 대표 날짜 실검증 미완료를 명시', () => {
  const item=get('numbered'); item.parts[0].timestamp='2025-01-02T16:00:00Z';
  assert.match(classify(item,'tester').failures[0].reason,/대표 날짜/);
});
test('중복 제거 및 완료 보고 / 필수 스키마 필드', async () => {
  const root=dir(); const r=await collect({account:'tester',output:root,source:fixture('demo')});
  assert.equal(r.finalStatus,'완료'); assert.equal(r.scope,'fixture'); assert.equal(r.discoveredCount,9); assert.equal(r.savedCount,6);
  assert.equal(r.excludedNoTextCount,1); assert.equal(r.excludedReplyCount,2); assert.equal(r.duplicateCount,1);
  for(const name of ['collection-state','collection-report']) {
    const value=read(root,name+'.json'); validate(schema(name),value);
    for(const field of schema(name).required) {const bad=structuredClone(value);delete bad[field];assert.throws(()=>validate(schema(name),bad),field);}
  }
  const state=read(root,'collection-state.json'); assert.equal(state.processed.length,9); assert.equal(state.status,'완료');
  assert.ok(state.records.every(r=>r.parts.every(p=>p.timestamp)));
});
test('중지 후 이어받기: 현재 위치부터, 이전 페이지 재요청 없음', async () => {
  const root=dir(), c=new AbortController(), s=source([page([get('original')],{end:false,next:'1'}),page([get('quote')])]);
  const stopped=await collect({account:'tester',output:root,source:s,signal:c.signal,onProgress:r=>{if(r.discoveredCount===1)c.abort();}});
  assert.equal(stopped.finalStatus,'중단'); assert.deepEqual(s.calls,[null]);
  const resumed=await collect({account:'tester',output:root,source:s}); assert.equal(resumed.finalStatus,'완료'); assert.deepEqual(s.calls,[null,'1']); assert.equal(resumed.savedCount,2);
});
test('불완전 판정: 부분 실패, 미확인 범위, 실제 서비스 골격', async () => {
  for(const s of [fixture('partial'),new ThreadsSource(),source([page([],{coverageKnown:false})])]) {
    const r=await collect({account:'tester',output:dir(),source:s}); assert.equal(r.finalStatus,'불완전'); assert.ok(r.failedItems.length);
  }
});
test('접근 제한/CAPTCHA/로그인/보안 확인 즉시 정지', async () => {
  for(const code of ['access_restricted','captcha','login_required','security_check']) {
    let calls=0; const s={id:code,scope:'fixture',async fetch(){calls++;throw new SourceError(code,'접근 중지');}};
    const r=await collect({account:'tester',output:dir(),source:s,wait:()=>assert.fail('retry forbidden')});
    assert.equal(calls,1); assert.equal(r.finalStatus,'불완전'); assert.match(r.failedItems[0].reason,new RegExp(code));
  }
});
test('일시 오류/제한 응답은 순차 지수 지연, 세 번까지', async () => {
  for(const code of ['transient','rate_limit']) {
    let calls=0; const waits=[]; const s={id:code,scope:'fixture',async fetch(){calls++;throw new SourceError(code,'일시 오류');}};
    const r=await collect({account:'tester',output:dir(),source:s,wait:async ms=>waits.push(ms)});
    assert.equal(calls,3); assert.equal(waits.reduce((a,b)=>a+b,0),3000); assert.equal(r.finalStatus,'불완전');
  }
});
test('재시도 회복 / 지연 중 사용자 중단', async () => {
  let calls=0; const s={id:'recover',scope:'fixture',async fetch(){if(++calls<3)throw new SourceError('transient','retry'); return page([get('original')]);}};
  assert.equal((await collect({account:'tester',output:dir(),source:s,wait:async()=>{}})).finalStatus,'완료');
  const c=new AbortController(); calls=0;
  const r=await collect({account:'tester',output:dir(),source:s,signal:c.signal,wait:async()=>c.abort()}); assert.equal(r.finalStatus,'중단'); assert.equal(calls,1);
});
test('잘못된 페이지는 커서 진행 없음 / 중복 내용 충돌은 불완전', async () => {
  const bad=get('original');bad.cookie='must-not-persist'; const root=dir();
  const r=await collect({account:'tester',output:root,source:source([page([get('quote'),bad])])});
  assert.equal(r.finalStatus,'불완전'); assert.equal(r.discoveredCount,0); assert.equal(read(root,'collection-state.json').nextCursor,null);
  const changed=get('original');changed.parts[0].text='conflict';
  assert.equal((await collect({account:'tester',output:dir(),source:source([page([get('original'),changed])])})).finalStatus,'불완전');
});
test('손상된 상태 / 다른 소스는 덮어쓰지 않음', async () => {
  const root=dir(); await collect({account:'tester',output:root,source:fixture('demo')});
  await assert.rejects(collect({account:'tester',output:root,source:fixture('partial')}),/다릅니다/);
  const file=path.join(root,'tester','collection-state.json');fs.writeFileSync(file,'BROKEN');
  await assert.rejects(collect({account:'tester',output:root,source:fixture('demo')}));assert.equal(fs.readFileSync(file,'utf8'),'BROKEN');
});
test('프로세스 강제 종료 후 원본 상태로 파생 파일 복구', async () => {
  const root=dir(); const fixtureFile=new URL('../fixtures/demo.json',import.meta.url).href;
  const engine=new URL('../src/engine.mjs',import.meta.url).href, sources=new URL('../src/sources.mjs',import.meta.url).href;
  const code=`import {collect} from ${JSON.stringify(engine)}; import {FixtureSource} from ${JSON.stringify(sources)}; await collect({account:'tester',output:${JSON.stringify(root)},source:new FixtureSource(new URL(${JSON.stringify(fixtureFile)}),'tester'),onProgress:r=>{if(r.discoveredCount===1)process.exit(7)}});`;
  assert.equal(spawnSync(process.execPath,['--input-type=module','-e',code]).status,7);
  fs.writeFileSync(path.join(root,'tester','tester.md'),'stale projection');
  const r=await collect({account:'tester',output:root,source:fixture('demo')}); assert.equal(r.finalStatus,'완료');assert.equal(r.duplicateCount,1);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'tester','tester.md'),'utf8'),/stale projection/);
});
test('동시 계정 수집 방지', async () => {
  const release=acquireLock();try{await assert.rejects(collect({account:'tester',output:dir(),source:fixture('demo')}),/이미 다른 계정/);}finally{release();}
});
test('경로 탈출과 Windows 예약명 거부', () => {
  for(const input of ['../other','a/b','a\\b','con','nul.txt','hello.','C:thing'])assert.throws(()=>accountName(input));
  assert.equal(accountName('@Some_One'),'some_one');
});
test('저장 실패를 완료로 보고하지 않음', async () => {
  const root=dir();fs.mkdirSync(path.join(root,'tester'));fs.mkdirSync(path.join(root,'tester','tester.md'));
  const reports=[]; await assert.rejects(collect({account:'tester',output:root,source:fixture('demo'),onProgress:r=>reports.push(r)})); assert.ok(!reports.some(r=>r.finalStatus==='완료'));
});
test('앞 페이지의 누락 의심은 마지막 페이지 성공으로 지워지지 않음', async () => {
  const s=source([page([get('original')],{end:false,next:'1',coverageKnown:false}),page([get('quote')])]);
  const r=await collect({account:'tester',output:dir(),source:s}); assert.equal(r.finalStatus,'불완전'); assert.ok(r.failedItems.some(x=>x.reason.includes('페이지 접근 범위')));
});
test('다음 위치 반복은 실패이며 무한 탐색하지 않음', async () => {
  const s=source([page([get('original')],{end:false,next:'1'}),page([get('quote')],{end:false,next:'1'})]);
  const r=await collect({account:'tester',output:dir(),source:s}); assert.equal(r.finalStatus,'불완전');assert.equal(s.calls.length,2);assert.equal(r.discoveredCount,1);
});
test('빈 식별자와 미디어/원본 URL 메타데이터를 거부', async () => {
  for(const mutate of [x=>x.id='',x=>x.permalink='https://www.threads.com/@test/post/123',x=>x.media_url='https://example.com/media.jpg']) {
    const item=get('original');mutate(item);const root=dir();
    const r=await collect({account:'tester',output:root,source:source([page([item])])});
    assert.equal(r.finalStatus,'불완전');assert.equal(r.discoveredCount,0);
    assert.doesNotMatch(fs.readFileSync(path.join(root,'tester','tester.md'),'utf8'),/https:/);
  }
});
test('빈 페이지라도 끝과 접근 범위가 확인되면 fixture 완료', async () => {
  const r=await collect({account:'tester',output:dir(),source:source([page()])});assert.equal(r.finalStatus,'완료');assert.equal(r.savedCount,0);
});
