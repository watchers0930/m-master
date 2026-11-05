import { NextResponse } from "next/server";
import { authenticated, jsonOk, queryParams } from "@/lib/visibility/http";
import { readJson } from "@/lib/seo/input";
import { consultingCreateSchema, consultingQuerySchema } from "@/schemas/consulting";
import { generateReport } from "@/lib/consulting/generate";
import { getReports } from "@/lib/consulting/data";
// Same budget as the cron path (strategy-refresh): one strategy call plus at most one validator repair
// (lib/consulting/prompt.ts MAX_REPAIR_CALLS). The deadline makes generateReport stop before the platform kills it.
export const maxDuration = 300;
const DEADLINE_MS = 280000;
export async function POST(request: Request) {
    const deadline = Date.now() + DEADLINE_MS;
    return authenticated(async (ownerId) => {
        const result = await generateReport(ownerId, consultingCreateSchema.parse(await readJson(request)), deadline);
        return NextResponse.json({ data: result.data, reused: result.reused }, { status: result.reused ? 200 : 201 });
    }, request);
}
export async function GET(request: Request) {
    return authenticated(async (ownerId) => jsonOk(await getReports(ownerId, consultingQuerySchema.parse(queryParams(request)))), request);
}
