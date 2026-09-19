import test from 'node:test';
import assert from 'node:assert/strict';
import { exportCaptureMarkdown } from '../browser-extension/export.mjs';

const card = (overrides = {}) => ({
  id: '/@hongso0921/post/First_01',
  timestamp: '2026-09-18T15:00:00Z',
  text: '확보한 본문',
  label: null,
  groupIds: [],
  issues: [],
  context: 'threads',
  attachments: [],
  ...overrides,
});
const capture = (cards, overrides = {}) => ({
  version: 2, provenance: 'browser-dom', account: 'hongso0921',
  status: '중단', reason: '사용자 중지', cards, issues: [], ...overrides,
});
// Parse literal text fences as a consumer would; compare the source payload,
// not the exporter's escaping or date-formatting implementation.
const fencePattern = /^(`{3,})text\n([\s\S]*?)\n\1(?=\n|$)/gm;
const textBlocks = markdown => [...markdown.matchAll(fencePattern)].map(match => match[2]);
const outsideText = markdown => markdown.replace(fencePattern, '');

test('7,835자를 넘는 긴 첨부의 끝·공백·빈 줄·원래 줄바꿈을 보존한다', () => {
  const longText = '  시작\t😀\r\n' + '가나다라 마바사아 자차카타 파하 '.repeat(450)
    + '\n\n  마지막 줄  \n';
  assert.ok([...longText].length > 7835);
  const output = exportCaptureMarkdown(capture([card({
    attachments: [{ type: 'long-text', url: '/@hongso0921/post/First_01/media', text: longText, source: 'profile-dom' }],
  })]));
  assert.deepEqual(textBlocks(output), ['확보한 본문', longText]);
  assert.match(output, /긴 첨부/);
  assert.match(output, /https:\/\/www\.threads\.com\/@hongso0921\/post\/First_01\/media/);
});

test('화면 순번이 있는 후속글도 개별 원문과 링크로 전부 보존한다', () => {
  const cards = [1, 2, 3].map(n => card({
    id: `/@hongso0921/post/Part_${n}`, text: `${n}번째 확보 내용`, label: `${n}/3`,
    groupIds: ['/@hongso0921/post/Part_1', '/@hongso0921/post/Part_2', '/@hongso0921/post/Part_3'],
  }));
  const output = exportCaptureMarkdown(capture(cards));
  assert.deepEqual(textBlocks(output), ['1번째 확보 내용', '2번째 확보 내용', '3번째 확보 내용']);
  assert.equal((output.match(/^## \d{4}-\d{2}-\d{2}/gm) || []).length, 3);
  for (let n = 1; n <= 3; n++) {
    assert.ok(output.includes(`https://www.threads.com/@hongso0921/post/Part_${n}`));
    assert.ok(output.includes(`${n}/3`));
  }
  assert.match(output, /분류.*미확인/);
  assert.match(output, /최초.*묶음.*미확인/);
});

test('KST 경계를 적용하고 오래된 순으로 내보내되 입력 배열을 변경하지 않는다', () => {
  const input = capture([
    card({ id: '/@hongso0921/post/Later', timestamp: '2026-09-18T15:00:00Z', text: '9월 19일 글' }),
    card({ id: '/@hongso0921/post/Earlier', timestamp: '2026-09-18T14:59:59Z', text: '9월 18일 글' }),
  ]);
  const original = structuredClone(input);
  const output = exportCaptureMarkdown(input);
  assert.deepEqual(textBlocks(output), ['9월 18일 글', '9월 19일 글']);
  assert.match(output, /## 2026-09-18/);
  assert.match(output, /## 2026-09-19/);
  assert.match(output, /KST/);
  assert.deepEqual(input, original);
});

test('잘못된 날짜·시간대 없는 날짜·존재하지 않는 날짜도 내용과 경고를 남긴다', () => {
  const cards = ['not-a-date', '2026-09-18T15:00:00', '2026-02-30T12:00:00Z', null]
    .map((timestamp, i) => card({ id: `/@hongso0921/post/BadDate_${i}`, timestamp, text: `날짜 미확인 내용 ${i}` }));
  const output = exportCaptureMarkdown(capture(cards));
  for (let i = 0; i < 4; i++) assert.ok(textBlocks(output).includes(`날짜 미확인 내용 ${i}`));
  assert.equal((output.match(/^## 날짜 미확인/gm) || []).length, 4);
  assert.ok(output.includes('not-a-date'));
  assert.ok(output.includes('2026-02-30T12:00:00Z'));
});

test('확보한 빈 본문·미확인 본문·첨부만 있는 글·답글·리포스트를 제외하지 않는다', () => {
  const cards = [
    card({ id: '/@hongso0921/post/Empty', text: '' }),
    card({ id: '/@hongso0921/post/Unknown', text: null, context: 'replies' }),
    card({ id: '/@hongso0921/post/AttachmentOnly', text: null, context: 'reposts',
      attachments: [{ type: 'long-text', url: '/@hongso0921/post/AttachmentOnly/media', text: '첨부만 확보', source: 'profile-dom' }] }),
  ];
  const output = exportCaptureMarkdown(capture(cards));
  for (const item of cards) assert.ok(output.includes(`https://www.threads.com${item.id}`));
  assert.ok(textBlocks(output).includes(''));
  assert.ok(textBlocks(output).includes('첨부만 확보'));
  assert.match(output, /본문.*미확인/);
  assert.match(output, /3개/);
});

test('원문 Markdown·HTML·백틱은 보고서 제목이나 활성 링크가 되지 않는다', () => {
  const text = '# 가짜 제목\n\n[클릭](javascript:alert(1))\n<script>alert(1)</script>\n```\n```text\n#### 침범\n````\n  끝  ';
  const output = exportCaptureMarkdown(capture([card({ text })]));
  assert.deepEqual(textBlocks(output), [text]);
  assert.doesNotMatch(outsideText(output), /가짜 제목|javascript:|<script>|침범/);
});

test('계정·상태·문제 설명은 Markdown 제목과 링크를 주입할 수 없다', () => {
  const injected = '[외부](https://evil.example)\n# 가짜 제목 <img src=x>';
  const output = exportCaptureMarkdown(capture([card({ issues: [{ id: null, reason: injected }] })], {
    account: injected, status: injected, reason: injected,
    issues: [{ id: injected, reason: injected }],
  }));
  assert.doesNotMatch(outsideText(output), /^# 가짜 제목|<img src=x>|\]\(https:\/\/evil\.example\)/m);
  assert.match(output, /계정.*미확인/);
  assert.match(output, /외부/);
  assert.ok(textBlocks(output).includes('확보한 본문'));
});

test('위험한·외부·변조된 URL은 링크화하지 않고 원문과 본문을 보존한다', () => {
  const invalidIds = [
    'javascript:alert(1)', 'https://evil.example/@hongso0921/post/Fake',
    '//evil.example/@hongso0921/post/Fake', '/@hongso0921/post/Bad)[x](https://evil.example)',
  ];
  const output = exportCaptureMarkdown(capture(invalidIds.map((id, i) => card({
    id, text: `URL 미확인 내용 ${i}`,
    attachments: [{ type: 'long-text', url: 'data:text/html,<h1>bad</h1>', text: `첨부 내용 ${i}`, source: 'profile-dom' }],
  }))));
  for (let i = 0; i < invalidIds.length; i++) {
    assert.ok(textBlocks(output).includes(invalidIds[i]));
    assert.ok(textBlocks(output).includes(`URL 미확인 내용 ${i}`));
    assert.ok(textBlocks(output).includes(`첨부 내용 ${i}`));
  }
  assert.doesNotMatch(outsideText(output), /\]\((?:javascript:|data:|https:\/\/evil\.example|\/\/evil)/);
  assert.match(output, /URL.*미확인/);
});

test('여러 첨부의 원문·출처·실패 경고를 순서대로 보존한다', () => {
  const output = exportCaptureMarkdown(capture([card({
    issues: [{ id: '/@hongso0921/post/First_01', reason: '세 번째 첨부 구조 미확인' }],
    attachments: [
      { type: 'long-text', url: '/@hongso0921/post/First_01/media', text: '첫 첨부\n', source: 'profile-dom' },
      { type: 'long-text', url: 'https://www.threads.net/@hongso0921/post/First_01/media', text: '\t둘째 첨부  ', source: 'profile-dom' },
      { type: 'long-text', url: null, text: '', source: 'profile-dom' },
    ],
  })], { issues: [{ id: null, reason: '과거 목록 끝 미확인' }] }));
  assert.deepEqual(textBlocks(output).filter(value => value !== 'null'), ['확보한 본문', '첫 첨부\n', '\t둘째 첨부  ', '']);
  assert.equal((output.match(/^### 긴 첨부/gm) || []).length, 3);
  assert.match(output, /profile-dom/);
  assert.match(output, /세 번째 첨부 구조 미확인/);
  assert.match(output, /과거 목록 끝 미확인/);
});

test('빈 수집과 완료 표기가 있는 수집도 전체 개수·누락 여부를 미검증으로 표시한다', () => {
  for (const cards of [[], [card()]]) {
    const output = exportCaptureMarkdown(capture(cards, { status: '완료', allPublicPostsVerified: true }));
    assert.match(output, /전체.*개수.*미검증/);
    assert.match(output, /누락.*미검증/);
    assert.ok(output.includes(`${cards.length}개`));
  }
});
