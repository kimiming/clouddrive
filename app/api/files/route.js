import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { DATA_DIR, categoryOf, safeName } from '../../../lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function ensureDir() { await fs.mkdir(DATA_DIR, { recursive: true }); }

export async function GET() {
  await ensureDir();
  const names = await fs.readdir(DATA_DIR);
  const files = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const st = await fs.stat(path.join(DATA_DIR, name)).catch(() => null);
    if (!st || !st.isFile()) continue;
    files.push({ name, size: st.size, mtime: st.mtimeMs, category: categoryOf(name) });
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return NextResponse.json({ files });
}

export async function POST(req) {
  await ensureDir();
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: '没有收到文件' }, { status: 400 });
  }
  let name = safeName(file.name);
  if (!name) return NextResponse.json({ error: '文件名无效' }, { status: 400 });
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  let i = 1;
  while (true) {
    try { await fs.access(path.join(DATA_DIR, candidate)); candidate = `${stem} (${i++})${ext}`; }
    catch { break; }
  }
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(DATA_DIR, candidate), buf);
  return NextResponse.json({ ok: true, name: candidate, size: buf.length });
}
