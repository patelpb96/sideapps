import { randomBytes } from 'node:crypto';

export function newId(prefix) {
  const safePrefix = typeof prefix === 'string' && prefix.length > 0 ? prefix : 'id';
  return `${safePrefix}_${randomBytes(6).toString('hex')}`;
}
