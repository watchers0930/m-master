import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

function readServiceAccountJson(): string {
  const inline = process.env.GA4_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) return inline;

  const filePath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (filePath && !filePath.startsWith('{')) {
    try {
      const resolved = path.resolve(filePath);
      if (fs.existsSync(resolved)) {
        return fs.readFileSync(resolved, 'utf-8');
      }
    } catch {
      return '';
    }
  }
  return '';
}

export async function GET() {
  return NextResponse.json({
    ga4_property_id: process.env.GA4_PROPERTY_ID ?? '',
    ga4_service_account: readServiceAccountJson(),
  });
}
