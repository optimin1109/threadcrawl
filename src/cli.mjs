import fs from 'node:fs';
import path from 'node:path';
import { collect } from './engine.mjs';
import { FixtureSource, ThreadsSource } from './sources.mjs';
import { atomicWrite } from './storage.mjs';
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, x, i, xs) => i % 2 ? pairs : [...pairs, [x.replace(/^--/, ''), xs[i+1]]], []));
const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
const timer = setInterval(() => { if (args.stop && fs.existsSync(args.stop)) controller.abort(); }, 100);
try {
  if (!args.account || !args.output || !['demo','partial','live'].includes(args.source)) throw new Error('--account, --output, --source demo|partial|live 필수');
  const source = args.source === 'live' ? new ThreadsSource() : new FixtureSource(new URL(`../fixtures/${args.source}.json`, import.meta.url), args.account.replace(/^@/,'').toLowerCase(), args.progress ? 500 : 0);
  await collect({ account: args.account, output: args.output, source, signal: controller.signal, onProgress: report => {
    if (args.progress) atomicWrite(path.resolve(args.progress), report);
    else console.log(JSON.stringify(report));
  } });
} catch (e) {
  const error = { finalStatus: '불완전', message: `저장 또는 실행 실패: ${e.message}` };
  if (args.progress) atomicWrite(path.resolve(args.progress), error);
  console.error(error.message); process.exitCode = 1;
} finally { clearInterval(timer); }
