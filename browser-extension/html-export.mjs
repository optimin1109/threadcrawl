// A static reading view of the capture. Grouping never changes the JSON source,
// invents neighbouring relationships, or drops cards that could not be grouped.
const ACCOUNT = '[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?';
const accountPattern = new RegExp(`^${ACCOUNT}$`);
const postPattern = new RegExp(`^(?:https://(?:www\\.)?threads\\.(?:com|net))?/@(${ACCOUNT})/post/[A-Za-z0-9_-]+/?$`);
const mediaPattern = new RegExp(`^(?:https://(?:www\\.)?threads\\.(?:com|net))?/@${ACCOUNT}/post/[A-Za-z0-9_-]+(?:/media)?/?$`);
const dateFormatter = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'});
const array = value => Array.isArray(value) ? value : [];
const escape = value => String(value ?? '미확인').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\r/g, '&#13;');

function postUrl(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(postPattern);
  return match ? {href: new URL(value, 'https://www.threads.com').href, owner: match[1].toLowerCase()} : null;
}

function mediaUrl(value) {
  return typeof value === 'string' && mediaPattern.test(value) ? new URL(value, 'https://www.threads.com').href : null;
}

function externalUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f-\u009f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function link(label, url) {
  return url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`
    : `<span class="muted">${escape(label)} · 링크 미확인</span>`;
}

function dateOf(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1] || hour > 23 || minute > 59 || second > 59) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? {milliseconds, label: dateFormatter.format(new Date(milliseconds))} : null;
}

function readingEntries(capture) {
  const records = capture.cards.map((card, index) => ({card: card ?? {}, index, date: dateOf(card?.timestamp)}));
  const byId = new Map(), rootCounts = new Map(), candidates = [], referenced = new Set();
  for (const record of records) {
    if (!byId.has(record.card.id)) byId.set(record.card.id, []);
    byId.get(record.card.id).push(record);
  }
  for (const chain of array(capture.chains)) {
    rootCounts.set(chain?.rootId, (rootCounts.get(chain?.rootId) || 0) + 1);
    for (const member of array(chain?.members)) referenced.add(member?.id);
  }
  for (const chain of array(capture.chains)) {
    const root = postUrl(chain?.rootId), total = chain?.total;
    if (!root || root.owner !== String(capture.account).toLowerCase() || rootCounts.get(chain.rootId) !== 1
      || !Number.isInteger(total) || total < 2 || total > 1000 || chain.conflictDetected || array(chain.conflicts).length) continue;
    const idsByPart = new Map(), partsById = new Map();
    let conflict = false;
    for (const member of array(chain.members)) {
      if (!Number.isInteger(member?.part) || member.part < 1 || member.part > total || !postUrl(member.id)) continue;
      if (idsByPart.has(member.part) && idsByPart.get(member.part) !== member.id) conflict = true;
      if (partsById.has(member.id) && partsById.get(member.id) !== member.part) conflict = true;
      idsByPart.set(member.part, member.id); partsById.set(member.id, member.part);
    }
    if (conflict) continue;
    const parts = new Map(), declaredMissing = new Set(array(chain.missing));
    for (const [part, id] of idsByPart) {
      const matching = byId.get(id), record = matching?.length === 1 ? matching[0] : null;
      if (!record || declaredMissing.has(part) || postUrl(id).owner !== root.owner || (part === 1 && id !== chain.rootId)
        || record.card.label !== `${part}/${total}` || typeof record.card.text !== 'string'
        || !Array.isArray(record.card.issues) || record.card.issues.length) continue;
      parts.set(part, record);
    }
    if (parts.size) candidates.push({kind: 'chain', chain, parts, date: byId.get(chain.rootId)?.[0]?.date ?? null});
  }
  // A body associated with more than one root remains independent. Choosing
  // the first encountered relationship would silently invent a reading order.
  const claims = new Map();
  for (const entry of candidates) for (const record of entry.parts.values()) claims.set(record.index, (claims.get(record.index) || 0) + 1);
  const assigned = new Set(), entries = [];
  for (const entry of candidates) {
    for (const [part, record] of entry.parts) if (claims.get(record.index) !== 1) entry.parts.delete(part);
    if (!entry.parts.size) continue;
    entry.index = Math.min(...[...entry.parts.values()].map(record => record.index));
    for (const record of entry.parts.values()) assigned.add(record.index);
    entries.push(entry);
  }
  for (const record of records) if (!assigned.has(record.index)) entries.push({...record, kind: 'single',
    relationUnclear: /^\d+\/\d+$/.test(record.card.label || '') || referenced.has(record.card.id)});
  return entries.sort((a, b) => (a.date?.milliseconds ?? Infinity) - (b.date?.milliseconds ?? Infinity) || a.index - b.index);
}

function body(value, className, label) {
  if (typeof value === 'string') return `${value === '' ? `<p class="muted empty-body">${label}: 저장된 텍스트가 비어 있습니다.</p>` : ''}<div class="${className}">${escape(value)}</div>`;
  if (value == null) return `<p class="missing-body">${label} 미확보</p>`;
  return `<p class="warning">${label} 형식 미확인</p><div class="${className}">${escape(value)}</div>`;
}

function issueList(issues) {
  return `<ul>${array(issues).map(issue => `<li>${issue?.id ? `<span class="identifier">${escape(issue.id)}</span> · ` : ''}${escape(issue?.reason)}</li>`).join('')}</ul>`;
}

function notesHtml(notes) {
  return array(notes).map(note => {
    if (note?.type === 'image') return `<aside class="note">이미지 원본과 이미지 속 글자는 저장하지 않았습니다. ${link('이미지 보기', mediaUrl(note.url))}</aside>`;
    if (note?.type === 'video') return `<aside class="note">동영상 원본·음성·자막은 저장하지 않았습니다. ${link('동영상 글 보기', postUrl(note.url)?.href)}</aside>`;
    if (note?.type === 'location') return `<aside class="note">장소: ${escape(note.text)}</aside>`;
    if (note?.type === 'unavailable-content') return `<aside class="note">인용·연결된 원문은 저장하지 못했습니다.<br>${escape(note.text)}</aside>`;
    if (note?.type === 'link-preview') return `<aside class="link-preview"><strong>${link(note.title ?? '외부 링크', externalUrl(note.url))}</strong><span class="preview-domain">${escape(note.domain)}</span><small>외부 원문 전문과 미리보기 이미지는 저장하지 않았습니다.</small></aside>`;
    return '';
  }).join('');
}

function postHtml(record, {part = null, total = null, relationUnclear = false} = {}) {
  const {card, index} = record, issues = array(card.issues);
  const partLabel = part != null ? `<div class="part-heading"><span>${part}/${total}</span>${link('원문', postUrl(card.id)?.href)}</div>`
    : card.label != null || relationUnclear ? `<div class="part-heading"><span>${card.label == null ? '연속글' : escape(card.label)}${relationUnclear ? ' · 연결 미확인' : ''}</span></div>` : '';
  const attachments = array(card.attachments).map((attachment, i) => `<section class="attachment"><div class="attachment-heading">${attachment?.type === 'long-text' ? '긴 첨부' : '첨부 · 유형 미확인'} ${i + 1} · ${link('첨부 원문', mediaUrl(attachment?.url))}</div>${body(attachment?.text, 'attachment-body', '첨부 본문')}</section>`).join('');
  return `<section class="post" id="post-${index}" data-card-index="${index}"${part != null ? ` data-part="${part}"` : ''}>${partLabel}${issues.length ? '<p class="warning">본문 확인 필요</p>' : ''}${body(card.text, 'post-body', '본문')}${attachments}${notesHtml(card.notes)}${issues.length ? `<details class="post-issues"><summary>이 글의 확인 사항 ${issues.length}건</summary>${issueList(issues)}</details>` : ''}</section>`;
}

function entryHeader(account, date, url) {
  return `<header class="entry-header"><span class="avatar" aria-hidden="true">@</span><div class="entry-identity"><strong>${account ? `@${escape(account)}` : '계정 미확인'}</strong><span class="date">${date ? `${escape(date.label)} (KST)` : '날짜 미확인'}</span></div><span class="source-link">${link('원문 ↗', url)}</span></header>`;
}

function entryHtml(entry, account) {
  if (entry.kind === 'single') return `<article class="thread single" data-kind="single">${entryHeader(postUrl(entry.card.id)?.owner ?? account, entry.date, postUrl(entry.card.id)?.href)}${postHtml(entry, {relationUnclear: entry.relationUnclear})}</article>`;
  const {chain, parts} = entry, complete = chain.status === 'complete' && parts.size === chain.total && !array(chain.missing).length;
  const reading = Array.from({length: chain.total}, (_, index) => {
    const part = index + 1;
    return parts.has(part) ? postHtml(parts.get(part), {part, total: chain.total})
      : `<section class="missing-part" data-part="${part}">${part}/${chain.total} · 본문 미확보</section>`;
  }).join('');
  return `<article class="thread" data-kind="chain">${entryHeader(account, entry.date, postUrl(chain.rootId)?.href)}<p class="chain-status${complete ? '' : ' warning'}">연속글 ${parts.size}/${chain.total} 확보 · ${complete ? '완료' : '미완료'}</p><div class="parts">${reading}</div>${chain.reason ? `<details class="chain-issues"><summary>연속글 확인 사항</summary><p>${escape(chain.reason)}</p></details>` : ''}</article>`;
}

const css = `
:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;color:#171717;background:#f7f7f7}
*{box-sizing:border-box}body{margin:0;font-size:16px;line-height:1.7}a{color:inherit;text-underline-offset:3px;overflow-wrap:anywhere}a:hover{color:#1769aa}
.page-header,main,.capture-details{width:min(680px,100% - 28px);margin-inline:auto}.page-header{padding:36px 4px 10px}h1{font-size:24px;line-height:1.4;margin:0 0 8px}.page-header p{margin:5px 0;color:#686868;font-size:13px}
.thread{background:#fff;border:1px solid #e4e4e4;border-radius:18px;padding:22px 24px;margin:16px 0}.entry-header{display:flex;align-items:center;gap:10px;font-size:14px;line-height:1.45}.avatar{display:grid;place-items:center;width:34px;height:34px;flex:0 0 34px;border:1px solid #ddd;border-radius:50%;font-size:18px;color:#777}.entry-identity{display:flex;flex-direction:column;min-width:0;overflow-wrap:anywhere}.date,.source-link{font-size:12px;color:#777}.source-link{margin-left:auto}
.post{padding:16px 0 4px}.post-body,.attachment-body{white-space:pre-wrap;overflow-wrap:anywhere;tab-size:4;line-height:1.75}.parts{margin:12px 0 0 16px;padding-left:20px;border-left:2px solid #ececec}.parts .post{padding-top:12px;padding-bottom:18px}.parts .post+.post{border-top:1px solid #f0f0f0}.part-heading{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:#777;margin-bottom:8px}.chain-status{margin:13px 0 0;font-size:12px;color:#727272}.missing-part{padding:18px 0;font-size:13px;color:#91611a}.warning,.missing-body{color:#91611a;font-size:13px}.warning{margin:6px 0}.muted,.empty-body{color:#777;font-size:13px}
.attachment{margin-top:18px;padding-top:12px;border-top:1px solid #ececec}.attachment-heading{font-size:12px;color:#777;margin-bottom:8px}.note,.link-preview{margin:12px 0 0;padding:11px 13px;background:#f7f7f7;border-radius:10px;font-size:13px;color:#666;overflow-wrap:anywhere}.link-preview strong{display:block;color:#303030;font-weight:500}.preview-domain,.link-preview small{display:block;font-size:11px;margin-top:5px}
details{font-size:12px;color:#777;overflow-wrap:anywhere}details p,details li{white-space:pre-wrap}summary{cursor:pointer}.post-issues,.chain-issues{margin-top:12px}.capture-details{padding:16px 4px 40px}.identifier{font-size:11px}.empty{padding:40px 4px;color:#777}
@media(max-width:480px){.thread{padding:18px 16px;border-radius:14px}.parts{margin-left:12px;padding-left:14px}.page-header{padding-top:24px}}
@media print{:root{background:#fff}.thread{border-radius:0;break-inside:auto}.page-header,main,.capture-details{width:100%}.post-body,.attachment-body{font-size:11pt}.source-link{display:none}}
`;

export function exportCaptureHtml(capture) {
  if (!capture || !Array.isArray(capture.cards)) throw new Error('보관본의 cards 배열이 필요합니다.');
  const account = typeof capture.account === 'string' && accountPattern.test(capture.account) ? capture.account : null;
  const entries = readingEntries(capture), groupCount = entries.filter(entry => entry.kind === 'chain').length;
  const title = `${account ? `@${account}` : '계정 미확인'} · Threads 보관본`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(title)}</title><style>${css}</style></head><body><header class="page-header"><h1>${account ? `@${escape(account)}` : '계정 미확인'}</h1><p>저장한 글 ${capture.cards.length}개 · 연결을 확인한 연속글 ${groupCount}묶음</p><p>오래된 글부터 표시합니다. <a href="#capture-details">수집 기록</a></p></header><main>${entries.length ? entries.map(entry => entryHtml(entry, account)).join('') : '<p class="empty">저장된 글이 없습니다.</p>'}</main><details class="capture-details" id="capture-details"><summary>수집 과정 기록(해결 전 기록 포함)</summary><p>전체 공개 글 수와 누락 여부는 미검증입니다. 연속글 완료는 번호별 텍스트 본문 확보를 뜻하며 외부 원문·이미지·음성까지 보관했다는 뜻은 아닙니다.</p><p>수집 상태: ${escape(capture.status)}${capture.reason != null ? `<br>수집 사유: ${escape(capture.reason)}` : ''}</p><p>기록된 연속글 ${array(capture.chains).length}묶음 중 검증 가능한 관계 ${groupCount}묶음을 연결해 표시했습니다. 관계·순번·본문을 확인하지 못한 글은 독립적으로 보존합니다.</p>${!account ? `<p>계정 기록: ${escape(capture.account)}</p>` : ''}${array(capture.issues).length ? issueList(capture.issues) : ''}</details></body></html>`;
}
