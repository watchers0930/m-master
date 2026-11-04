import { authenticated } from '@/lib/visibility/http';
import { contentIdSchema } from '@/schemas/content';
import { regenerateBodyImage } from '@/lib/content/regenerate-image';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(async ownerId => regenerateBodyImage(ownerId,
    contentIdSchema.parse((await context.params).id),request),request,{ requireOrigin:true });
}
