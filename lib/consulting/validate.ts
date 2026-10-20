import { consultingStrategySchema } from "@/schemas/consulting";
import type { ConsultingSnapshot, ConsultingStrategy, Currency } from "@/types/consulting";
import type { Market } from "@/types/visibility";
export const MARKET_CURRENCY: Record<Market, Currency> = {
    "ko-KR": "KRW", "en-US": "USD", "en-GB": "GBP", "en-CA": "CAD", "en-AU": "AUD",
};
export const ACTION_DESTINATIONS = {
    content_create: "/content/create", seo_audit: "/seo-audit", visibility: "/visibility",
} as const;
export function actionUrl(destination: keyof typeof ACTION_DESTINATIONS, domainId: string) {
    return `${ACTION_DESTINATIONS[destination]}?domainId=${encodeURIComponent(domainId)}`;
}
/** Retain verified tokens for the shared DTO renderer; reject unknown/malformed tokens and literal quantities. */
function narrative(value: string, evidence: Set<string>) {
    const rest = value.replace(/\{\{ev:([a-zA-Z0-9_-]+)\}\}/g, (_, id) => {
        if (!evidence.has(id))
            throw new Error("unknown evidence");
        return "";
    }).replace(/\bGA4\b/g, "");
    if (/[\p{N}]|\{\{|https?:\/\//u.test(rest) || /(?:매출|수익|전환|노출).{0,12}보장|guarantee.{0,20}(?:revenue|profit|conversion|ranking)/i.test(rest))
        throw new Error("unverified narrative");
}
export function validateStrategy(raw: unknown, snapshot: ConsultingSnapshot): ConsultingStrategy {
    const result = consultingStrategySchema.parse(raw);
    const known = new Set(snapshot.evidence.map(e => e.id));
    const refs = (ids: string[]) => { if (ids.some(id => !known.has(id)))
        throw new Error("unknown evidence"); };
    const findings = [...result.diagnosis.strengths, ...result.diagnosis.issues];
    narrative(result.diagnosis.summary, known);
    for (const x of findings) {
        narrative(x.text, known);
        refs(x.evidenceIds);
    }
    for (const x of [...result.diagnosis.uncertainties, ...result.budgetProposal.assumptions])
        narrative(x, known);
    if (new Set(result.channelMix.map(x => x.channel)).size !== 3)
        throw new Error("duplicate channels");
    if (result.channelMix.reduce((s, x) => s + x.recommendedRatio, 0) !== 100)
        throw new Error("ratio sum");
    for (const x of result.channelMix) {
        refs(x.evidenceIds);
        narrative(x.reason, known);
        if (x.applicability === "not_applicable" && x.recommendedRatio !== 0)
            throw new Error("inapplicable ratio");
        if (x.channel === "naver_paid" && snapshot.market !== "ko-KR" && x.applicability !== "not_applicable")
            throw new Error("market");
    }
    if (new Set(result.priorityActions.map(x => x.id)).size !== result.priorityActions.length)
        throw new Error("duplicate actions");
    for (const x of result.priorityActions) {
        refs(x.evidenceIds);
        for (const t of [x.title, x.description, x.metric])
            narrative(t, known);
        if (snapshot.market !== "ko-KR" && x.channel === "naver_paid")
            throw new Error("market action");
    }
    const budget = snapshot.monthlyMarketingBudget;
    if (result.budgetProposal.currency !== MARKET_CURRENCY[snapshot.market] || result.budgetProposal.totalAmount !== (budget?.amount ?? null))
        throw new Error("budget mismatch");
    if (new Set(result.budgetProposal.allocations.map(x => x.channel)).size !== 3)
        throw new Error("duplicate allocation");
    for (const a of result.budgetProposal.allocations) {
        if (a.ratio !== result.channelMix.find(x => x.channel === a.channel)!.recommendedRatio)
            throw new Error("allocation mismatch");
    }
    // Server owns amounts; round to the currency minor unit and give the residue to the largest channel.
    const scale = result.budgetProposal.currency === "KRW" ? 1 : 100;
    const total = budget ? Math.round(budget.amount * scale) : null;
    const order = ["organic", "geo", "naver_paid"];
    const allocations = result.budgetProposal.allocations.sort((a, b) => order.indexOf(a.channel) - order.indexOf(b.channel));
    const amounts = allocations.map(x => total === null ? null : Math.round(total * x.ratio / 100));
    if (total !== null) {
        const index = allocations.reduce((best, x, i) => x.ratio > allocations[best].ratio ? i : best, 0);
        amounts[index] = amounts[index]! + total - amounts.reduce<number>((s, x) => s + (x ?? 0), 0);
    }
    allocations.forEach((x, i) => { x.amount = amounts[i] === null ? null : amounts[i]! / scale; });
    return result;
}
