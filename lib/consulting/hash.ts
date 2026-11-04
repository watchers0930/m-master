import { createHash } from "node:crypto";
/** Input sets are sorted as well as keys; no request timestamp or temporary ID enters the hash. */
export function canonical(value: unknown): string {
    if (value instanceof Date)
        return JSON.stringify(value.toISOString());
    if (Array.isArray(value))
        return `[${value.map(canonical).sort().join(",")}]`;
    if (value !== null && typeof value === "object")
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
    if (typeof value === "number" && !Number.isFinite(value))
        throw new Error("nonfinite input");
    if (value === undefined)
        throw new Error("undefined input");
    return JSON.stringify(value);
}
function stableGa4(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableGa4);
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    const object = value as Record<string,unknown>;
    return Object.fromEntries(Object.entries(object).filter(([key]) =>
      // GA4 provenance (full or the identifier-free LLM projection, which still carries queryVersion).
      !(key === 'collectedAt' && ('credentialSource' in object || 'queryVersion' in object)) &&
      !(key === 'observedAt' && (object.source === 'ga4' || object.id === 'status_ga4'))
    ).map(([key, v]) => [key, stableGa4(v)]));
}
export function snapshotHash(value: unknown) {
    return createHash("sha256").update(canonical(stableGa4(value))).digest("hex");
}
