import { NextResponse } from 'next/server';
import { checkCredentials, createSession } from '../../../lib/auth';

export async function POST(req) {
  const { username, password } = await req.json().catch(() => ({}));
  if (!checkCredentials(username, password)) {
    return NextResponse.json({ error: '账号或密码不正确' }, { status: 401 });
  }
  const token = await createSession(username);
  const res = NextResponse.json({ ok: true });
  res.cookies.set('drive_session', token, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600,
  });
  return res;
}
