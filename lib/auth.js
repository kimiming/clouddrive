import { SignJWT, jwtVerify } from 'jose';

function secret() {
  return new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-please-change');
}

export async function createSession(username) {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret());
}

export async function verifySession(token) {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload;
  } catch {
    return null;
  }
}

export function checkCredentials(username, password) {
  const u = process.env.ADMIN_USER || 'admin';
  const p = process.env.ADMIN_PASSWORD || 'admin123456';
  return username === u && password === p;
}
