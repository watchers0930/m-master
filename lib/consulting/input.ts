import { readStructuredInput } from "./structured-input";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { visibilityData } from "@/lib/visibility/data";
import { dataSchema } from "@/schemas/visibility";
import { consultingSnapshotSchema } from "@/schemas/consulting";
import type { ConsultingSnapshot, EvidenceRef, EvidenceSource } from "@/types/consulting";
import type { Market } from "@/types/visibility";
import { snapshotHash } from "./hash";
import { citationHost } from "@/lib/visibility/normalize";
import { readStoredGa4 } from "./stored-ga4";
class SourceReadFailure extends Error {
    constructor(readonly source: EvidenceSource) { super("stored source read failed"); }
}
/** Last thirty completed UTC days. Never include a moving request timestamp in the hash. */
export function completedRange(now = new Date()) {
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return { from: new Date(end - 30 * 86400000).toISOString(), to: new Date(end - 1).toISOString() };
}
export async function collectInput(ownerId: string, domain: {
    id: string;
    market: Market;
    url: string;
}, budget: ConsultingSnapshot["monthlyMarketingBudget"], now = new Date()): Promise<ConsultingSnapshot> {
    const unavailable = new Set<EvidenceSource>();
    // A SQL failure may invalidate the Prisma transaction/connection. Restart the whole read,
    // excluding that source, so all surviving observations still share one repeatable snapshot.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
        const range = completedRange(now);
        const snapshot: ConsultingSnapshot = { market: domain.market, range, evidence: [], sourceStatus: [],
            limitations: [], selection: [], monthlyMarketingBudget: budget };
        const from = new Date(range.from), to = new Date(range.to);
        const add = (id: string, source: EvidenceSource, label: string, value: EvidenceRef["value"], at: Date | null, unit?: string) => {
            snapshot.evidence.push({ id, source, label, value, observedAt: at?.toISOString() ?? null,
                rangeFrom: source === "geo" ? range.from : null, rangeTo: source === "geo" ? range.to : null, ...(unit ? { unit } : {}) });
        };
        // 근거 라벨은 운영 대시보드(한글)에 그대로 노출된다 → 한글 고정. 지표/소스 키 한글 매핑.
        const GEO_METRIC_KO: Record<string, string> = { sov: "점유율", citationRate: "인용률", validSamples: "유효 표본", citationValidSamples: "인용 유효 표본", unresolvableCount: "미해결 수", failedCount: "실패 수" };
        const SOURCE_KO: Record<string, string> = { seo: "SEO", geo: "GEO", ga4: "GA4" };
        // A source failure aborts this read; recovery re-reads all remaining sources together.
        for (const source of ["seo", "geo", "ga4"] as const) {
            if (unavailable.has(source)) {
                snapshot.sourceStatus.push({ source, status: "error", observedAt: null, reason: "저장된 소스 조회에 실패했습니다." });
                snapshot.limitations.push(`${source}: 저장 데이터 조회 실패`);
                continue;
            }
            try {
                let observedAt: Date | null = null;
                let status = "missing";
                let reason: string | null = null;
                if (source === "seo") {
                    snapshot.structuredMetrics = await readStructuredInput(tx, ownerId, domain.id, snapshot);
                    const where = { domainId: domain.id, market: domain.market, domain: { ownerId } };
                    const audit = await tx.seoAudit.findFirst({ where: { ...where, scope: "full", status: "completed", completedAt: { lte: to } },
                        orderBy: [{ completedAt: "desc" }, { id: "asc" }],
                        select: { id: true, technicalScore: true, coverage: true, completedAt: true, checks: true } });
                    const latest = await tx.seoAudit.findFirst({ where: { ...where, scope: "full", createdAt: { lte: to } },
                        orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { status: true, createdAt: true } });
                    const keywords = await tx.seoKeyword.findMany({ where: { ...where, reservationOnly: false, metricsUpdatedAt: { lte: to } },
                        select: { id: true, keyword: true, searchVolume: true, volumeScale: true, volumePeriod: true, metricsUpdatedAt: true },
                        orderBy: [{ metricsUpdatedAt: "desc" }, { id: "asc" }], take: 50 });
                    const total = await tx.seoKeyword.count({ where: { ...where, reservationOnly: false, metricsUpdatedAt: { lte: to } } });
                    snapshot.selection.push({ source: "seo_keywords", total, selected: keywords.length, limit: 50, rule: "latest metricsUpdatedAt then id" });
                    const rankingWhere = Prisma.sql `r.domain_id=${domain.id} AND r.market=${domain.market}
            AND r.captured_at >= ${from} AND r.captured_at <= ${to}
            AND EXISTS (SELECT 1 FROM domains d WHERE d.id=r.domain_id AND d.owner_id=${ownerId})
            AND EXISTS (SELECT 1 FROM seo_keywords k JOIN domains d ON d.id=k.domain_id WHERE k.id=r.keyword_id AND d.owner_id=${ownerId})
            AND EXISTS (SELECT 1 FROM seo_audits a JOIN domains d ON d.id=a.domain_id WHERE a.id=r.audit_id AND d.owner_id=${ownerId})`;
                    const rankings = await tx.$queryRaw<{
                        id: string;
                        engine: string;
                        device: string;
                        rank: number | null;
                        status: string;
                        returnedRange: number | null;
                        capturedAt: Date;
                    }[]>(Prisma.sql `
            SELECT id, engine, device, rank, status, returned_range AS "returnedRange", captured_at AS "capturedAt"
            FROM (SELECT DISTINCT ON (keyword_id, engine, device) r.* FROM seo_rankings r
              WHERE ${rankingWhere} ORDER BY keyword_id, engine, device, captured_at DESC, id ASC) latest
            ORDER BY captured_at DESC, id ASC LIMIT 100`);
                    const groups = await tx.$queryRaw<{
                        total: number;
                    }[]>(Prisma.sql `
            SELECT count(*)::int AS total FROM (SELECT keyword_id, engine, device FROM seo_rankings r WHERE ${rankingWhere} GROUP BY keyword_id, engine, device) g`);
                    snapshot.selection.push({ source: "seo_rankings", total: groups[0].total, selected: rankings.length, limit: 100, rule: "latest per keyword/engine/device" });
                    if (audit) {
                        observedAt = audit.completedAt;
                        add("seo_tech_score", source, "기술 점수", audit.technicalScore, observedAt, "점");
                        add("seo_coverage", source, "점검 커버리지", audit.coverage, observedAt);
                        const checks = Array.isArray(audit.checks) ? audit.checks : [];
                        for (const check of checks.slice(0, 15)) {
                            if (check && typeof check === "object" && !Array.isArray(check) && typeof check.key === "string" && /^[a-z_]+$/.test(check.key) &&
                                ["pass", "warning", "fail", "not_applicable"].includes(String(check.status)))
                                add(`seo_check_${check.key}`, source, `기술 점검: ${check.key}`, String(check.status), observedAt);
                        }
                        if (observedAt && observedAt < from) {
                            status = "stale";
                            reason = "기술 감사가 관측 기간보다 오래되었습니다.";
                        }
                        else
                            status = audit.coverage === 1 ? "available" : "partial";
                    }
                    for (const k of keywords) {
                        add(`seo_kw_${k.id}`, source, `키워드: ${k.keyword.slice(0, 150)} (규모 ${k.volumeScale ?? "미상"}, 기간 ${k.volumePeriod ?? "미상"})`, k.searchVolume, k.metricsUpdatedAt);
                        if (k.metricsUpdatedAt && (!observedAt || k.metricsUpdatedAt > observedAt))
                            observedAt = k.metricsUpdatedAt;
                    }
                    for (const r of rankings) {
                        add(`seo_rank_${r.id}`, source, `${r.engine}/${r.device} 순위 (${r.status})`, r.rank, r.capturedAt, "position");
                        add(`seo_range_${r.id}`, source, "반환 순위 범위", r.returnedRange, r.capturedAt);
                        if (!observedAt || r.capturedAt > observedAt)
                            observedAt = r.capturedAt;
                    }
                    const structured = snapshot.structuredMetrics;
                    const structuredObserved = !!structured?.demand.length || structured?.keywords.some(k =>
                        [k.difficulty, k.volume, k.cpc, k.rank].some(value => value !== null));
                    if (structuredObserved) {
                        for (const e of snapshot.evidence.filter(e => /^(metric_|demand_)/.test(e.id))) {
                            if (e.observedAt && (!observedAt || e.observedAt > observedAt.toISOString())) observedAt = new Date(e.observedAt);
                        }
                        if (status === "missing") status = "partial";
                    }
                    if (audit && audit.technicalScore === null && !structuredObserved && !snapshot.evidence.some(e => e.id.startsWith("seo_check_")))
                        status = "missing";
                    if (status === "missing" && (keywords.some(k => k.searchVolume !== null) || rankings.some(r => r.rank !== null || (r.status === "not_found_in_range" && r.returnedRange !== null))))
                        status = "partial";
                    if (status !== "missing" && observedAt && observedAt < from) {
                        status = "stale";
                        reason = "저장된 SEO 관측이 기본 기간보다 오래되었습니다.";
                    }
                    if (latest && latest.status === "failed" && (!audit?.completedAt || latest.createdAt > audit.completedAt)) {
                        status = status === "missing" ? "missing" : "partial";
                        reason = "더 최근 기술 감사가 실패했습니다.";
                    }
                }
                else if (source === "geo") {
                    const geo = await visibilityData(ownerId, dataSchema.parse({ domainId: domain.id, market: domain.market, from: range.from, to: range.to, citationLimit: 20 }), tx);
                    for (const engine of geo.engines) {
                        const at = engine.lastCapturedAt ? new Date(engine.lastCapturedAt) : null;
                        if (at && (!observedAt || at > observedAt))
                            observedAt = at;
                        for (const key of ["sov", "citationRate", "validSamples", "citationValidSamples", "unresolvableCount", "failedCount"] as const)
                            add(`geo_${engine.engine}_${key}`, source, `${engine.engine} ${GEO_METRIC_KO[key] ?? key}`, engine[key], at);
                    }
                    for (const c of geo.citations) {
                        const host = citationHost(c.url);
                        if (host)
                            add(`geo_citation_${snapshotHash({ host, at: c.capturedAt }).slice(0, 24)}`, source, "인용 출처 호스트", host, new Date(c.capturedAt));
                    }
                    for (const c of geo.competitors.slice(0, 20)) {
                        add(`geo_competitor_${snapshotHash(c.label).slice(0, 24)}`, source, `경쟁사 라벨: ${c.label.slice(0, 150)}`, c.mentionRate, observedAt);
                    }
                    // Zero valid denominators remain missing even though failure counters exist.
                    status = geo.engines.some(e => e.validSamples > 0 || e.citationValidSamples > 0) ?
                        (geo.engines.some(e => e.failedCount || e.unresolvableCount) ? "partial" : "available") : "missing";
                    snapshot.selection.push({ source: "geo_citations", total: geo.citations.length + (geo.nextCitationCursor ? 1 : 0), selected: geo.citations.length, limit: 20, rule: "earliest citations; total is a lower bound when truncated" });
                }
                else {
                    const stored = await readStoredGa4(tx, ownerId, domain.url, range);
                    status = stored.status;
                    reason = stored.reason;
                }
                snapshot.sourceStatus.push({ source, status, observedAt: observedAt?.toISOString() ?? null, reason });
                if (status !== "available")
                    snapshot.limitations.push(reason ?? `${source}: ${status}`);
            }
            catch {
                throw new SourceReadFailure(source);
            }
        }
        snapshot.evidence = [...new Map(snapshot.evidence.map(e => [e.id, e])).values()];
        for (const s of snapshot.sourceStatus)
            add(`status_${s.source}`, "status", `${SOURCE_KO[s.source] ?? s.source} 데이터 준비 상태`, s.status, null);
        const {structuredMetrics, ...legacy} = snapshot;
        return {...consultingSnapshotSchema.parse({...legacy, evidence: legacy.evidence.slice(0,700)}), evidence: legacy.evidence, ...(structuredMetrics ? {structuredMetrics} : {})};
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
      } catch (error) {
        if (!(error instanceof SourceReadFailure)) throw error;
        unavailable.add(error.source);
      }
    }
    throw new Error("source read recovery exhausted");
}
