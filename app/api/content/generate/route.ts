import { authenticated, readJsonBody } from '@/lib/visibility/http';
import { streamGenerate } from '@/lib/content/generate-stream';
export const maxDuration=60;
const SSE_HEADERS = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' };
export async function POST(request: Request) {
  return authenticated(async ownerId => new Response(await streamGenerate(ownerId, await readJsonBody(request)), { headers: SSE_HEADERS }),
    request, { requireOrigin: true });
}
