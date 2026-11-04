import { NextResponse } from 'next/server';
import { authenticated } from '@/lib/visibility/http';
import { ga4Settings, disconnectGa4 } from '@/lib/settings/service';
export async function GET(request: Request) {
  return authenticated(async ownerId => NextResponse.json(await ga4Settings(ownerId)), request);
}
export async function DELETE(request: Request) {
  return authenticated(async ownerId => {
    await disconnectGa4(ownerId);
    return NextResponse.json({ ok: true });
  }, request, { requireOrigin: true });
}
