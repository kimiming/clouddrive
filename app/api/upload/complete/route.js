import { NextResponse } from 'next/server';
import fsp from 'fs/promises';
import path from 'path';
import { DATA_DIR } from '../../../../lib/store';
import { validUploadId, sessionDir, partName } from '../../../../lib/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function dedupeName(name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  let i = 1;
  while (true) {
    try { await fsp.access(path.join(DATA_DIR, candidate)); candidate = `${stem} (${i++})${ext}`; }
    catch { return candidate; }
  }
}

export async function POST(req) {
  const { uploadId } = await req.json().catch(() => ({}));
  if (!validUploadId(uploadId)) return NextResponse.json({ error: '参数不正确' }, { status: 400 });
  const dir = sessionDir(uploadId);
  const metaRaw = await fsp.readFile(path.join(dir, 'meta.json'), 'utf8').catch(() => null);
  if (!metaRaw) return NextResponse.json({ error: '上传会话不存在' }, { status: 404 });
  const meta = JSON.parse(metaRaw);
  // 检查所有分片齐全
  for (let i = 0; i < meta.totalChunks; i++) {
    const st = await fsp.stat(path.join(dir, partName(i))).catch(() => null);
    if (!st) return NextResponse.json({ error: `缺少分片 ${i}，请继续续传`, missing: i }, { status: 400 });
  }
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const finalName = await dedupeName(meta.name);
  const tmpPath = path.join(DATA_DIR, `.tmp-${uploadId}`);
  try {
    const out = await fsp.open(tmpPath, 'w');
    try {
      for (let i = 0; i < meta.totalChunks; i++) {
        const data = await fsp.readFile(path.join(dir, partName(i)));
        await out.write(data);
      }
    } finally {
      await out.close();
    }
  } catch (e) {
    await fsp.unlink(tmpPath).catch(() => null);
    return NextResponse.json({ error: '组装文件失败，请重试' }, { status: 500 });
  }
  const st = await fsp.stat(tmpPath);
  if (st.size !== meta.size) {
    await fsp.unlink(tmpPath).catch(() => null);
    return NextResponse.json({ error: `文件大小校验失败（期望 ${meta.size}，实际 ${st.size}），分片已保留，可续传重试` }, { status: 400 });
  }
  await fsp.rename(tmpPath, path.join(DATA_DIR, finalName));
  await fsp.rm(dir, { recursive: true, force: true });
  return NextResponse.json({ ok: true, name: finalName, size: st.size });
}
