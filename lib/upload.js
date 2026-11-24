import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from './store';

// 分片临时目录：与 files 同级，挂载在同一个数据卷里，容器重启后续传不丢
export const UPLOAD_DIR = path.join(path.dirname(DATA_DIR), '.uploads');

export function validUploadId(id) {
  return /^[a-f0-9]{32}$/.test(String(id || ''));
}

export function makeUploadId(name, size, lastModified) {
  return crypto.createHash('sha256').update(`${name}:${size}:${lastModified || ''}`).digest('hex').slice(0, 32);
}

export function sessionDir(id) {
  return path.join(UPLOAD_DIR, id);
}

export function partName(index) {
  return `${String(index).padStart(6, '0')}.part`;
}
