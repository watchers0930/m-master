import type { Prisma } from "@prisma/client";
import type { ConsultingSnapshot } from "@/types/consulting";
const str = (v: unknown, max: number) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map(x => x.trim().slice(0, 80)).slice(0, 12) : [];
/**
 * The owner's brand settings (settings.brand_guide) as consulting input, so content_create actions are grounded in
 * what the business actually sells. Read inside collectInput's snapshot transaction; frozen and hashed with the rest
 * (a brand change yields a new report). Returns undefined when nothing is set.
 */
export async function businessContext(tx: Prisma.TransactionClient, ownerId: string): Promise<ConsultingSnapshot["business"]> {
    const setting = await tx.setting.findUnique({ where: { ownerId }, select: { brandGuide: true } });
    const bg = (setting?.brandGuide ?? {}) as Record<string, unknown>;
    const business = { companyName: str(bg.company_name, 80), industry: str(bg.industry, 80), services: list(bg.services),
        coreKeywords: list(bg.core_keywords), targetAudience: str(bg.target_audience, 300) };
    return business.companyName || business.industry || business.services.length || business.coreKeywords.length || business.targetAudience
        ? business : undefined;
}
