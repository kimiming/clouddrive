import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { KEYS_FILE } from '../../../lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEY_RE = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+([A-Za-z0-9+/=]+)(?:\s+(.*))?$/;

async function readLines() {
  const raw = await fs.readFile(KEYS_FILE, 'utf8').catch(() => '');
  return raw.split('\n');
}

function parse(raw) {
  const keys = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = KEY_RE.exec(t);
    if (!m) { keys.push({ raw: t, valid: false, type: '未知', body: '', comment: t.slice(0, 40), protected: false }); continue; }
    const [, type, body, comment = ''] = m;
    let fingerprint = '';
    try {
      const hash = crypto.createHash('sha256').update(Buffer.from(body, 'base64')).digest('base64').replace(/=+$/, '');
      fingerprint = `SHA256:${hash}`;
    } catch {}
    keys.push({ valid: true, type, body, comment, fingerprint, protected: comment.trim() === 'hatch' });
  }
  return keys;
}

export async function GET() {
  const raw = await fs.readFile(KEYS_FILE, 'utf8').catch(() => '');
  return NextResponse.json({ keys: parse(raw) });
}

export async function POST(req) {
  const { key, name } = await req.json().catch(() => ({}));
  const rawInput = String(key || '').trim().split('\n')[0].trim();
  const cleanName = String(name || '').replace(/[\r\n]+/g, ' ').trim();
  let type = '';
  let body = '';
  const m = KEY_RE.exec(rawInput);
  if (m) {
    type = m[1];
    body = m[2];
  } else if (/^[A-Za-z0-9+/=]{40,}$/.test(rawInput)) {
    // 只粘贴了公钥主体（AAAA 开头的那一长串），默认按 ssh-ed25519 处理
    type = 'ssh-ed25519';
    body = rawInput;
  } else {
    return NextResponse.json({ error: '公钥格式不正确：请粘贴以 ssh-ed25519 开头的一整行，或只粘贴 AAAA 开头的那一长串' }, { status: 400 });
  }
  const comment = cleanName || (m && m[3] ? m[3].trim() : '');
  const line = comment ? `${type} ${body} ${comment}` : `${type} ${body}`;
  const existing = parse(await fs.readFile(KEYS_FILE, 'utf8').catch(() => ''));
  if (existing.some((k) => k.body && k.body === body)) {
    return NextResponse.json({ error: '这把公钥已经添加过了' }, { status: 400 });
  }
  await fs.mkdir(path.dirname(KEYS_FILE), { recursive: true });
  const raw = await fs.readFile(KEYS_FILE, 'utf8').catch(() => '');
  const prefix = raw && !raw.endsWith('\n') ? '\n' : '';
  await fs.appendFile(KEYS_FILE, `${prefix}${line}\n`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const { body } = await req.json().catch(() => ({}));
  if (!body) return NextResponse.json({ error: '缺少参数' }, { status: 400 });
  const lines = await readLines();
  const kept = [];
  let removed = false;
  for (const line of lines) {
    const m = KEY_RE.exec(line.trim());
    if (m && m[2] === body) {
      if ((m[3] || '').trim() === 'hatch') {
        return NextResponse.json({ error: '这是 Jackson 自己的 Muse 公钥，不能删除' }, { status: 400 });
      }
      removed = true;
      continue;
    }
    kept.push(line);
  }
  if (!removed) return NextResponse.json({ error: '没有找到这把公钥' }, { status: 404 });
  await fs.writeFile(KEYS_FILE, kept.join('\n'));
  return NextResponse.json({ ok: true });
}
