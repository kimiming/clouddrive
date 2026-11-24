import { NextResponse } from 'next/server';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('drive_session', '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
