// Browser-safe Markdown projection. It never classifies away a captured card,
// joins neighbouring posts, or mutates the JSON capture used as the source.
const ACCOUNT = '[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?';
const accountPattern = new RegExp(`^${ACCOUNT}$`);
const origin = 'https://www.threads.com';
const dateFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});

function inline(value) {
  return String(value ?? '미확인')
    .replace(/\r\n?|\n|\u2028|\u2029/g, ' ↵ ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#!|])/g, '\\$1');
}

function literalBlock(value) {
  const text = String(value);
  let longest = 2;
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const fence = '`'.repeat(longest + 1);
  // The extra framing newline is not part of the source text. In particular,
  // do not trim or normalize the payload's own whitespace or line endings.
  return `${fence}text\n${text}\n${fence}`;
}

function threadsUrl(value, attachment = false) {
  if (typeof value !== 'string') return null;
  const suffix = attachment ? '(?:/media)?' : '';
  const pattern = new RegExp(`^(?:https://(?:www\\.)?threads\\.(?:com|net))?/@${ACCOUNT}/post/[A-Za-z0-9_-]+${suffix}/?$`);
  return pattern.test(value) ? new URL(value, origin).href : null;
}

function sourceLink(label, value, attachment = false) {
  const url = threadsUrl(value, attachment);
  if (url) return `[${label}](${url})`;
  return `${label} URL 미확인 — 원문 식별자를 링크 없이 보존합니다.\n\n${literalBlock(value ?? 'null')}`;
}

function dateOf(timestamp) {
  if (typeof timestamp !== 'string') return null;
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  // Date.parse normalizes impossible dates such as February 30. Reject those
  // rather than silently assigning a different calendar date to the post.
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]
    || hour > 23 || minute > 59 || second > 59) return null;
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) return null;
  return { milliseconds, kst: dateFormatter.format(new Date(milliseconds)) };
}

function issueLines(issues) {
  return (Array.isArray(issues) ? issues : []).map(issue => {
    const id = issue?.id == null ? '' : ` (${inline(issue.id)})`;
    return `- 확인 사항${id}: ${inline(issue?.reason)}`;
  }).join('\n');
}

function bodyText(value, label) {
  if (typeof value === 'string') {
    return `${label}${value === '' ? ' — 빈 문자열' : ''}\n\n${literalBlock(value)}`;
  }
  if (value == null) return `${label} 미확인 — 확보한 텍스트가 없습니다.`;
  return `${label} 형식 미확인 — 확보 값을 보존합니다.\n\n${literalBlock(value)}`;
}

function cardMarkdown(card, date) {
  const pieces = [
    `## ${date ? `${date.kst} (KST)` : '날짜 미확인'}`,
    sourceLink('원문', card.id),
    `원문 시각: ${inline(card.timestamp)}`,
  ];
  if (!date) pieces.push('날짜 미확인: 유효한 날짜와 명시된 시간대를 확인할 수 없어 날짜순 정렬 뒤에 보존합니다.');
  if (card.context) pieces.push(`화면 위치: ${inline(card.context)}. 분류 및 최초 동시 작성 묶음은 미확인입니다.`);
  if (card.label != null) pieces.push(`화면 순번: ${inline(card.label)}. 별개의 글로 보존하며 묶음을 추정하지 않습니다.`);
  if (Array.isArray(card.groupIds) && card.groupIds.length) {
    pieces.push(`화면에서 함께 관측한 식별자(최초 작성 묶음의 증거가 아님):\n${card.groupIds.map(id => `- ${inline(id)}`).join('\n')}`);
  }
  pieces.push(bodyText(card.text, '본문'));
  for (const [index, attachment] of (card.attachments ?? []).entries()) {
    const type = attachment?.type === 'long-text' ? '긴 첨부' : '첨부(유형 미확인)';
    pieces.push(`### ${type} ${index + 1}`);
    pieces.push(sourceLink('첨부 원문', attachment?.url, true));
    pieces.push(`확보 출처: ${inline(attachment?.source)}`);
    pieces.push(bodyText(attachment?.text, '첨부 본문'));
  }
  const issues = issueLines(card.issues);
  if (issues) pieces.push(issues);
  return pieces.join('\n\n');
}

export function exportCaptureMarkdown(capture) {
  if (!capture || !Array.isArray(capture.cards)) throw new Error('보관본의 cards 배열이 필요합니다.');
  const accountValid = typeof capture.account === 'string' && accountPattern.test(capture.account);
  const attachmentCount = capture.cards.reduce((count, card) => count + (card.attachments?.length ?? 0), 0);
  const parts = [
    `# ${accountValid ? `@${inline(capture.account)}` : '계정 미확인'} Threads 보관본`,
    `확보한 카드 ${capture.cards.length}개 · 첨부 ${attachmentCount}개. 전체 공개 글 개수 및 누락 여부는 미검증입니다.`,
    '분류 및 최초 동시 작성 묶음은 미확인입니다. 화면 순번이 있는 후속글도 합치거나 제외하지 않고 별도로 보존합니다.',
    '날짜는 KST 기준이며 날짜가 확인된 글부터 오래된 순으로 표시합니다. 원문은 공백과 줄바꿈을 보존하는 텍스트 블록입니다.',
    `수집기 기록 상태: ${inline(capture.status)} (전체 수집 완료를 뜻하지 않음)`,
  ];
  if (!accountValid) parts.push(`계정 원문\n\n${literalBlock(capture.account ?? 'null')}`);
  if (capture.reason != null) parts.push(`중단·진행 사유: ${inline(capture.reason)}`);
  const issues = issueLines(capture.issues);
  if (issues) parts.push(issues);
  const ordered = capture.cards.map((card, index) => ({ card, index, date: dateOf(card.timestamp) }))
    .sort((a, b) => {
      if (!a.date) return b.date ? 1 : a.index - b.index;
      if (!b.date) return -1;
      return a.date.milliseconds - b.date.milliseconds || a.index - b.index;
    });
  parts.push(...ordered.map(({ card, date }) => cardMarkdown(card, date)));
  return `${parts.join('\n\n')}\n`;
}
