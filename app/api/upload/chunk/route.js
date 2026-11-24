import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { validUploadId, sessionDir, partName } from '../../../../lib/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const form = await req.formData();
  const uploadId = String(form.get('uploadId') || '');
  const index = Number(form.get('index'));
  const chunk = form.get('chunk');
  if (!validUploadId(uploadId) || !Number.isInteger(index) || index < 0 || !chunk || typeof chunk === 'string') {
    return NextResponse.json({ error: '参数不正确' }, { status: 400 });
  }
  const dir = sessionDir(uploadId);
  const meta = await fs.readFile(path.join(dir, 'meta.json'), 'utf8').catch(() => null);
  if (!meta) return NextResponse.json({ error: '上传会话不存在，请重新上传' }, { status: 404 });
  const buf = Buffer.from(await chunk.arrayBuffer());
  await fs.writeFile(path.join(dir, partName(index)), buf);
  return NextResponse.json({ ok: true, index, size: buf.length });
}
