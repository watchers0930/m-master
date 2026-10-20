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
export function snapshotHash(value: unknown) {
    return createHash("sha256").update(canonical(value)).digest("hex");
}
