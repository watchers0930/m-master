import { authenticated } from '@/lib/visibility/http';
import { streamGenerate } from '@/lib/content/generate-stream';
export const maxDuration=60;
export async function POST(request: Request) {
  return authenticated(ownerId => streamGenerate(ownerId,request),request,{ requireOrigin:true });
}
