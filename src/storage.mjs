import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export function atomicWrite(file, value) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', 'utf8'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
// A process-wide disk lock also prevents two separate GUI/CLI instances collecting together.
export function acquireLock() {
  const file = path.join(os.tmpdir(), 'threads-text-archive-collector.lock');
  try { const fd = fs.openSync(file, 'wx'); fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number(fs.readFileSync(file, 'utf8'));
    if (!Number.isInteger(pid) || pid < 1) throw new Error('수집 잠금 파일이 손상되었습니다. 실행 중인 프로그램을 확인한 후 임시 폴더의 잠금 파일을 제거하세요.');
    try { process.kill(pid, 0); } catch (probe) {
      if (probe.code === 'ESRCH') { fs.unlinkSync(file); return acquireLock(); }
    }
    throw new Error('이미 다른 계정을 수집 중입니다. 먼저 중지하거나 완료하세요.');
  }
  return () => fs.unlinkSync(file);
}
export function validate(schema, value, where = '$') {
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${where}: 허용되지 않은 값`);
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(t => t === type || (t === 'integer' && Number.isInteger(value)))) throw new Error(`${where}: 형식 오류`);
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) throw new Error(`${where}: 범위 오류`);
  if (type === 'object') {
    for (const key of schema.required || []) if (!(key in value)) throw new Error(`${where}.${key}: 필수 필드 누락`);
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) validate(schema.properties[key], child, `${where}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`${where}.${key}: 알 수 없는 필드`);
    }
  }
  if (type === 'array' && schema.items) value.forEach((v,i) => validate(schema.items,v,`${where}[${i}]`));
}
export function schema(name) { return JSON.parse(fs.readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url))); }
