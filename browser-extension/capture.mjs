// Browser-only v2 capture contract; the desktop v1 importer is a separate format.
export const ADAPTER = 'threads-dom-2026-09-19';
export function newCapture(account, sessionId) {
  return { version: 2, provenance: 'browser-dom', adapter: ADAPTER, account, sessionId, startedAt: new Date().toISOString(), updatedAt: null, status: '진행 중', reason: null, snapshots: 0, duplicateCount: 0, coverageKnown: false, cards: [], issues: [] };
}
export function mergeCard(previous, incoming) {
  if (!previous) return {card: structuredClone(incoming), issue: null};
  const fields = card => JSON.stringify([card.timestamp, card.text, card.label, card.context, card.attachments]);
  const base = card => JSON.stringify([card.timestamp, card.text, card.label, card.context]);
  const enrichesLabel = previous.label == null && typeof incoming.label === 'string'
    && previous.timestamp === incoming.timestamp && previous.text === incoming.text && previous.context === incoming.context;
  const incomingLabel = typeof incoming.label === 'string' && incoming.label.match(/^([1-9]\d{0,3})\/([1-9]\d{0,3})$/);
  // A failed container read is an unknown body, not confirmed empty text. A
  // clean reread may fill that placeholder without freezing its null label.
  const recoversUnread = previous.text === null && previous.label === null && previous.issues.length > 0 &&
    previous.id === incoming.id && previous.timestamp === incoming.timestamp && previous.context === incoming.context &&
    typeof incoming.text === 'string' && incomingLabel && incomingLabel[0] === incoming.label &&
    Number(incomingLabel[1]) <= Number(incomingLabel[2]) && Number(incomingLabel[2]) <= 1000;
  const preservesAttachments = previous.attachments.every(old => incoming.attachments.some(next =>
    next.type === old.type && next.url === old.url && next.source === old.source &&
    typeof next.text === 'string' && typeof old.text === 'string' && next.text.startsWith(old.text)));
  let card = structuredClone(previous);
  let issue = null;
  if (fields(previous) !== fields(incoming)) {
    if (!incoming.issues.length && preservesAttachments
      && ((previous.issues.length && previous.label === incoming.label) || base(previous) === base(incoming) || enrichesLabel || recoversUnread))
      card = structuredClone(incoming);
    else issue = {id: incoming.id, reason: '동일 게시물의 본문/첨부/날짜/분류가 달라짐: 최초 확인 내용 보존'};
  } else if (previous.issues.length && !incoming.issues.length) card = structuredClone(incoming);
  card.groupIds = [...new Set([...previous.groupIds, ...incoming.groupIds])];
  const notes=[...(previous.notes || []),...(incoming.notes || [])];
  if(notes.length) card.notes=[...new Map(notes.map(note=>[JSON.stringify(note),structuredClone(note)])).values()];
  return {card, issue};
}
export function assertPage(page, account) {
  if (page?.version !== 2 || page.adapter !== ADAPTER || page.account !== account ||
      !Array.isArray(page.cards) || !Array.isArray(page.issues)) throw new Error('계정 또는 DOM 어댑터가 바뀌어 수집 중단');
}
