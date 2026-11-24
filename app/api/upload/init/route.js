import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { safeName } from '../../../../lib/store';
import { UPLOAD_DIR, makeUploadId, sessionDir, partName } from '../../../../lib/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const { name, size, chunkSize, lastModified } = await req.json().catch(() => ({}));
  const clean = safeName(name);
  const totalSize = Number(size);
  const cs = Number(chunkSize);
  if (!clean || !totalSize || totalSize <= 0 || !cs || cs <= 0) {
    return NextResponse.json({ error: '参数不正确' }, { status: 400 });
  }
  const uploadId = makeUploadId(clean, totalSize, lastModified);
  const dir = sessionDir(uploadId);
  await fs.mkdir(dir, { recursive: true });
  const totalChunks = Math.ceil(totalSize / cs);
  const meta = { name: clean, size: totalSize, chunkSize: cs, totalChunks, createdAt: Date.now() };
  const metaPath = path.join(dir, 'meta.json');
  const existing = await fs.readFile(metaPath, 'utf8').catch(() => null);
  if (!existing) await fs.writeFile(metaPath, JSON.stringify(meta));
  // 已上传的分片（断点续传时据此跳过）
  const uploaded = [];
  for (let i = 0; i < totalChunks; i++) {
    const st = await fs.stat(path.join(dir, partName(i))).catch(() => null);
    if (st && st.isFile()) {
      const expect = i === totalChunks - 1 ? totalSize - cs * (totalChunks - 1) : cs;
      if (st.size === expect) uploaded.push(i);
    }
  }
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  return NextResponse.json({ uploadId, totalChunks, uploaded, chunkSize: cs });
}
