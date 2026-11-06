import { consultingStrategySchema } from "@/schemas/consulting";
import type { ConsultingLlmSnapshot, ConsultingStrategy, Currency } from "@/types/consulting";
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
/** Retain verified tokens for the shared DTO renderer; reject unknown/malformed tokens and literal quantities.
 * Validator failures name the field and the offending fragment (≤24 chars) so a rejected report is diagnosable. */
function narrative(value: string, evidence: Set<string>, where = "text") {
    const rest = value.replace(/\{\{ev:([a-zA-Z0-9_-]+)\}\}/g, (_, id) => {
        if (!evidence.has(id))
            throw new Error(`unknown evidence@${where}:${String(id).slice(0, 40)}`);
        return "";
    }).replace(/\bGA4\b/g, "");
    const hit = /.{0,8}(?:[\p{N}]|\{\{|https?:\/\/).{0,8}/u.exec(rest)
        ?? /(?:매출|수익|전환|노출).{0,12}보장|guarantee.{0,20}(?:revenue|profit|conversion|ranking)/i.exec(rest);
    if (hit)
        throw new Error(`unverified narrative@${where}:${hit[0].slice(0, 24)}`);
}
/**
 * Pure syntax repair: `{{id}}` → `{{ev:id}}` only when `id` is a supplied evidence ID (meaning unchanged; an unknown
 * ID stays malformed and is still rejected). Applied to every model-written string before validation.
 */
function normalizeTokens<T>(value: T, evidence: Set<string>): T {
    if (typeof value === "string")
        return value.replace(/\{\{(?!ev:)([a-zA-Z0-9_-]+)\}\}/g, (token, id) => evidence.has(id) ? `{{ev:${id}}}` : token) as T;
    if (Array.isArray(value)) return value.map(v => normalizeTokens(v, evidence)) as T;
    if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeTokens(v, evidence)])) as T;
    return value;
}
// A content_create title that names the work instead of the subject: "<콘텐츠|블로그|…> 작성/생성/제작/발행/기획" (but not
// "작성법/작성 방법" — a how-to subject), or a bare "생성/최적화 …" label. "임대차 계약서 작성" (a subject) passes.
const TASK_TITLE = /(?:콘텐츠|블로그|포스트|포스팅|게시물|게시글|원고)(?:\s*(?:을|를))?\s*(?:작성|생성|제작|발행|기획)(?!\s*(?:법|방법|요령|팁|노하우))|^\s*(?:콘텐츠\s*|SEO\s*)?(?:생성|최적화)(?:\s*(?:및|와|과)\s*\S+)?\s*$/;
export function validateStrategy(raw: unknown, snapshot: ConsultingLlmSnapshot): ConsultingStrategy {
    const known = new Set(snapshot.evidence.map(e => e.id));
    const result = consultingStrategySchema.parse(normalizeTokens(raw, known));
    // Content rules are all evaluated so one repair call can fix every violation at once (generate.ts).
    const issues: string[] = [];
    const check = (rule: () => void) => { try { rule(); } catch (error) { issues.push(String((error as Error).message)); } };
    const refs = (ids: string[], where: string) => { const bad = ids.find(id => !known.has(id));
        if (bad) throw new Error(`unknown evidence@${where}:${bad.slice(0, 40)}`); };
    const findings = [...result.diagnosis.strengths, ...result.diagnosis.issues];
    check(() => narrative(result.diagnosis.summary, known, "diagnosis.summary"));
    findings.forEach((x, i) => {
        check(() => narrative(x.text, known, `diagnosis.finding${i}`));
        check(() => refs(x.evidenceIds, `diagnosis.finding${i}.evidenceIds`));
    });
    result.diagnosis.uncertainties.forEach((x, i) => check(() => narrative(x, known, `diagnosis.uncertainties.${i}`)));
    result.budgetProposal.assumptions.forEach((x, i) => check(() => narrative(x, known, `budgetProposal.assumptions.${i}`)));
    if (new Set(result.channelMix.map(x => x.channel)).size !== 3)
        issues.push("duplicate channels");
    if (result.channelMix.reduce((s, x) => s + x.recommendedRatio, 0) !== 100)
        issues.push("ratio sum");
    for (const x of result.channelMix) {
        check(() => refs(x.evidenceIds, `channelMix.${x.channel}.evidenceIds`));
        check(() => narrative(x.reason, known, `channelMix.${x.channel}.reason`));
        if (x.applicability === "not_applicable" && x.recommendedRatio !== 0)
            issues.push(`inapplicable ratio@channelMix.${x.channel}`);
        if (x.channel === "naver_paid" && snapshot.market !== "ko-KR" && x.applicability !== "not_applicable")
            issues.push("market");
    }
    if (new Set(result.priorityActions.map(x => x.id)).size !== result.priorityActions.length)
        issues.push("duplicate actions");
    for (const x of result.priorityActions) {
        check(() => refs(x.evidenceIds, `priorityActions.${x.id}.evidenceIds`));
        for (const [field, t] of [["title", x.title], ["description", x.description], ["metric", x.metric]] as const)
            check(() => narrative(t, known, `priorityActions.${x.id}.${field}`));
        // content_create titles become weekly blog topics verbatim (lib/topics/strategy-candidates.ts): a task label
        // ("…콘텐츠 작성", "콘텐츠 생성 및 최적화") is not a topic. 2026-11-06 운영 v3.2·v3.3 리포트 재현.
        if (x.destination === "content_create" && TASK_TITLE.test(x.title))
            issues.push(`task-like content title@priorityActions.${x.id}.title:${x.title.slice(0, 24)}`);
        if (snapshot.market !== "ko-KR" && x.channel === "naver_paid")
            issues.push(`market action@priorityActions.${x.id}`);
    }
    // Budget/allocation rules are collected too, so the single repair sees every violation (codex review 2026-11-06).
    const budget = snapshot.monthlyMarketingBudget;
    if (result.budgetProposal.currency !== MARKET_CURRENCY[snapshot.market] || result.budgetProposal.totalAmount !== (budget?.amount ?? null))
        issues.push(`budget mismatch@budgetProposal:expected currency ${MARKET_CURRENCY[snapshot.market]} and totalAmount ${budget?.amount ?? "null"}`);
    if (new Set(result.budgetProposal.allocations.map(x => x.channel)).size !== 3)
        issues.push("duplicate allocation");
    for (const a of result.budgetProposal.allocations) {
        const mix = result.channelMix.find(x => x.channel === a.channel);
        if (!mix || a.ratio !== mix.recommendedRatio)
            issues.push(`allocation mismatch@budgetProposal.allocations.${a.channel}`);
    }
    // Every violation is reported (rule@path[:fragment]); the bound only protects the repair message size.
    if (issues.length)
        throw new Error(issues.length > 20 ? [...issues.slice(0, 20), `+${issues.length - 20} more`].join(" | ") : issues.join(" | "));
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
