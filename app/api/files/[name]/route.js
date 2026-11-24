import { NextResponse } from 'next/server';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { DATA_DIR, mimeOf, safeName } from '../../../../lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveFile(params) {
  const name = safeName(decodeURIComponent(params.name));
  if (!name) return null;
  return { name, filePath: path.join(DATA_DIR, name) };
}

export async function GET(req, { params }) {
  const r = resolveFile(params);
  if (!r) return NextResponse.json({ error: '文件名无效' }, { status: 400 });
  const st = await fsp.stat(r.filePath).catch(() => null);
  if (!st || !st.isFile()) return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  const download = new URL(req.url).searchParams.get('download') === '1';
  const headers = {
    'Content-Type': mimeOf(r.name),
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(r.name)}`,
  };
  const range = req.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
      headers['Content-Length'] = String(end - start + 1);
      const stream = Readable.toWeb(fs.createReadStream(r.filePath, { start, end }));
      return new Response(stream, { status: 206, headers });
    }
  }
  headers['Content-Length'] = String(st.size);
  const stream = Readable.toWeb(fs.createReadStream(r.filePath));
  return new Response(stream, { headers });
}

export async function DELETE(req, { params }) {
  const r = resolveFile(params);
  if (!r) return NextResponse.json({ error: '文件名无效' }, { status: 400 });
  await fsp.unlink(r.filePath).catch(() => null);
  return NextResponse.json({ ok: true });
}
