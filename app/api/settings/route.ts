import { NextResponse } from 'next/server';
import { authenticated } from '@/lib/visibility/http';
import { settingsSchema } from '@/schemas/settings';
import { getSettings, saveSettings } from '@/lib/settings/service';
export async function GET(request: Request) {
  return authenticated(async ownerId => NextResponse.json({ data: await getSettings(ownerId), error: null }), request);
}
export async function PUT(request: Request) {
  return authenticated(async ownerId => {
    await saveSettings(ownerId, settingsSchema.parse(await request.json()));
    return NextResponse.json({ data: null, error: null });
  }, request, { requireOrigin: true });
}
