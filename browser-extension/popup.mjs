import {exportCaptureMarkdown} from './export.mjs';
const message = document.getElementById('message');
const diagnostics = document.getElementById('diagnostics');
let errorText = '', refreshing = false, busy = false;
const button = id => document.getElementById(id);
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('sv-SE', {timeZone: 'Asia/Seoul'}) : '미확인';
async function send(type) {
  const response = await chrome.runtime.sendMessage({type});
  if (response?.error) throw new Error(response.error);
  return response;
}
async function refresh() {
  if (refreshing || busy) return;
  refreshing = true;
  try {
    const {capture, running, navigation, connectionStatus} = await send('status');
    const active = navigation?.activeChain;
    const currentChain = running && active
      ? `\n현재 연속글: ${new Set((active.members || []).map(member => member.part)).size}/${active.total}개 확보${active.missing?.length ? ` · 남은 번호 ${active.missing.join(', ')}` : ''}`
      : '';
    message.textContent = (errorText ? `${errorText}\n` : '') + (capture
      ? `@${capture.account}\n${capture.status} · 저장된 글 ${capture.cardCount}개\n연속글 ${capture.chainCount || 0}묶음 · 완료 ${capture.completedChainCount || 0} · 진행 중·미완료 ${Math.max(0, (capture.chainCount || 0) - (capture.completedChainCount || 0))}${currentChain}\n\n저장된 글 작성일 범위 (고정 글 포함, 사이 글 확보 의미 아님)\n${date(capture.oldestTimestamp)} ~ ${date(capture.newestTimestamp)} (KST)\n\n${capture.reason || connectionStatus || (running ? '화면을 이동하며 저장 중입니다.' : '수집이 멈췄습니다.')}`
      : '대상 계정의 스레드 탭에서 시작하세요.');
    diagnostics.textContent = capture
      ? `화면 저장 횟수: ${capture.snapshots || 0}회\n중복 저장 방지 횟수: ${capture.duplicateCount || 0}회\n같은 글을 여러 화면에서 다시 확인한 횟수이며, 새로 저장된 글 수가 아닙니다.`
      : '아직 저장 기록이 없습니다.';
    button('start').disabled = Boolean(running);
    button('stop').disabled = !running;
    button('save').disabled = button('markdown').disabled = !capture;
  } finally { refreshing = false; }
}
async function action(work) {
  if (busy) return;
  busy = true; errorText = '';
  for (const id of ['start', 'stop', 'save', 'markdown']) button(id).disabled = true;
  try { await work(); }
  catch (error) { errorText = error.message; message.textContent = errorText; }
  finally { busy = false; await refresh().catch(error => { message.textContent = error.message; }); }
}
for (const type of ['start', 'stop']) button(type).onclick = () => action(() => send(type));
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
