// lib/storage.ts — 로컬 파일시스템 스토리지 (Supabase Storage 대체)
// 버킷: rag-documents, blog-exports → public/uploads/ 하위

import fs from 'fs';
import path from 'path';

const UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function bucketPath(bucket: string): string {
  return path.join(UPLOAD_ROOT, bucket);
}

export async function upload(
  bucket: string,
  filePath: string,
  data: Buffer,
): Promise<{ path: string }> {
  const dir = path.join(bucketPath(bucket), path.dirname(filePath));
  ensureDir(dir);
  const fullPath = path.join(bucketPath(bucket), filePath);
  fs.writeFileSync(fullPath, data);
  return { path: filePath };
}

export function getPublicUrl(bucket: string, filePath: string): string {
  return `/uploads/${bucket}/${filePath}`;
}
