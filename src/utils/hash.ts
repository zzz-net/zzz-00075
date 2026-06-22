import * as crypto from 'crypto';
import * as fs from 'fs';

export function computeFileSha256(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const fileBuffer = fs.readFileSync(filePath);
  hash.update(fileBuffer);
  return hash.digest('hex');
}

export function computeStringSha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function computeObjectSha256(obj: unknown): string {
  const content = JSON.stringify(obj, Object.keys(obj as Record<string, unknown>).sort());
  return computeStringSha256(content);
}

export function generateVersionId(): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `v${timestamp}-${random}`;
}

export function generateId(): string {
  return crypto.randomBytes(8).toString('hex');
}
