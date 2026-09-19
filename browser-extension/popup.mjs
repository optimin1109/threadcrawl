import {exportCaptureMarkdown} from './export.mjs';
const message = document.getElementById('message');
let errorText = '', refreshing = false, busy = false;
const button = id => document.getElementById(id);
const date = value => value ? new Date(value).toLocaleDateString('sv-SE', {timeZone: 'Asia/Seoul'}) : '미확인';
async function send(type) {
  const response = await chrome.runtime.sendMessage({type});
  if (response?.error) throw new Error(response.error);
  return response;
}
async function refresh() {
  if (refreshing || busy) return;
  refreshing = true;
  try {
    const {capture, running} = await send('status');
    message.textContent = (errorText ? `${errorText}\n` : '') + (capture
      ? `@${capture.account}\n${capture.status} · 발견 ${capture.cardCount}개\n확정 화면 ${capture.snapshots}회 · 재등장 ${capture.duplicateCount}회\n관측 날짜(KST): ${date(capture.oldestTimestamp)} ~ ${date(capture.newestTimestamp)}\n${capture.reason || (running ? '화면을 이동하며 저장 중입니다.' : '수집이 멈췄습니다.')}`
      : '대상 계정의 스레드 탭에서 시작하세요.');
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
