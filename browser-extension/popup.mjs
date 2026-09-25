import {exportCaptureMarkdown} from './export.mjs';
const message = document.getElementById('message');
const diagnostics = document.getElementById('diagnostics');
let errorText = '', refreshing = false, busy = false, resetTarget = null, repairTarget = null;
const button = id => document.getElementById(id);
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('sv-SE', {timeZone: 'Asia/Seoul'}) : '미확인';
async function send(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({type, ...fields});
  if (response?.error) throw new Error(response.error);
  return response;
}
async function refresh() {
  if (refreshing || busy) return;
  refreshing = true;
  try {
    const {capture, running, navigation, connectionStatus, resetRunId} = await send('status');
    if (busy) return;
    resetTarget = capture && !running ? {account: capture.account, runId: resetRunId} : null;
    const incompleteCount = Math.max(0, (capture?.chainCount || 0) - (capture?.completedChainCount || 0));
    repairTarget = resetTarget && incompleteCount > 0 ? {...resetTarget} : null;
    const repairTotal = navigation?.repairQueue?.length || 0;
    const repairProgress = running && navigation?.workflow === 'repair'
      ? `\n미완료 글 재수집: ${Math.min(repairTotal, Math.max(0, navigation.repairIndex || 0) + 1)}/${repairTotal}묶음`
      : '';
    const active = navigation?.activeChain;
    const missingParts = new Set(active?.missing || []);
    const capturedParts = new Set((active?.members || []).map(member => member.part).filter(part => !missingParts.has(part)));
    const currentChain = running && active
      ? `\n현재 연속글: ${capturedParts.size}/${active.total}개 확보${active.missing?.length ? ` · 남은 번호 ${active.missing.join(', ')}` : ''}`
      : '';
    message.textContent = (errorText ? `${errorText}\n` : '') + (capture
      ? `@${capture.account}\n${capture.status} · 저장된 글 ${capture.cardCount}개\n연속글 ${capture.chainCount || 0}묶음 · 완료 ${capture.completedChainCount || 0} · 진행 중·미완료 ${incompleteCount}${repairProgress}${currentChain}\n\n저장된 글 작성일 범위 (고정 글 포함, 사이 글 확보 의미 아님)\n${date(capture.oldestTimestamp)} ~ ${date(capture.newestTimestamp)} (KST)\n\n${capture.reason || connectionStatus || (running ? '화면을 이동하며 저장 중입니다.' : '수집이 멈췄습니다.')}`
      : '대상 계정의 스레드 탭에서 시작하세요.');
    diagnostics.textContent = capture
      ? `화면 저장 횟수: ${capture.snapshots || 0}회\n중복 저장 방지 횟수: ${capture.duplicateCount || 0}회\n같은 글을 여러 화면에서 다시 확인한 횟수이며, 새로 저장된 글 수가 아닙니다.`
      : '아직 저장 기록이 없습니다.';
    button('start').disabled = Boolean(running);
    button('start').textContent = capture ? '이 계정 수집 계속하기' : '이 계정 수집 시작';
    button('repair').disabled = !repairTarget;
    document.getElementById('repairHelp').textContent = capture
      ? `@${capture.account}의 미완료 연속글만 다시 수집합니다. @${capture.account} 프로필이나 해당 계정의 글을 연 탭에서 실행하세요. 저장된 글은 그대로 보존합니다.`
      : '미완료로 남은 연속글만 다시 찾아 수집합니다. 저장된 글은 그대로 보존합니다.';
    button('stop').disabled = !running;
    button('save').disabled = button('markdown').disabled = !capture;
    button('reset').disabled = !resetTarget;
    button('reset').textContent = capture ? `@${capture.account} 수집 기록 초기화` : '이 계정 수집 기록 초기화';
  } finally { refreshing = false; }
}
async function action(work) {
  if (busy) return;
  busy = true; errorText = '';
  for (const id of ['start', 'repair', 'stop', 'save', 'markdown', 'reset']) button(id).disabled = true;
  try { await work(); }
  catch (error) { errorText = error.message; message.textContent = errorText; }
  finally { busy = false; await refresh().catch(error => { message.textContent = error.message; }); }
}
for (const type of ['start', 'stop']) button(type).onclick = () => action(() => send(type));
button('repair').onclick = () => action(async () => {
  const target = repairTarget;
  if (target) await send('repair', target);
});
button('reset').onclick = () => action(async () => {
  const target = resetTarget;
  if (!target) return;
  const confirmed = window.confirm(`@${target.account}의 저장된 글·연속글·수집 오류와 진행 기록을 모두 삭제합니다.\n\n이 작업은 되돌릴 수 없습니다. 필요한 자료는 취소 후 ‘원본 자료 저장 (JSON v2)’으로 먼저 보관하세요.\n다른 계정의 기록과 이미 내려받은 파일은 삭제하지 않습니다.\n\n@${target.account}의 수집 기록을 초기화할까요?`);
  if (confirmed) await send('reset', target);
});
for (const format of ['save', 'markdown']) button(format).onclick = () => action(async () => {
  const {capture} = await send('export');
  if (!capture) return;
  const markdown = format === 'markdown';
  const blob = new Blob([markdown ? exportCaptureMarkdown(capture) : JSON.stringify(capture, null, 2)],
    {type: markdown ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `${capture.account}-capture-v2.${markdown ? 'md' : 'json'}`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
refresh().catch(error => { message.textContent = error.message; });
setInterval(() => refresh().catch(error => { message.textContent = error.message; }), 1000);
