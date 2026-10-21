import { NextResponse } from "next/server";
import { authenticated, jsonOk, queryParams } from "@/lib/visibility/http";
import { readJson } from "@/lib/seo/input";
import { consultingCreateSchema, consultingQuerySchema } from "@/schemas/consulting";
import { generateReport } from "@/lib/consulting/generate";
import { getReports } from "@/lib/consulting/data";
export const maxDuration = 90;
export async function POST(request: Request) {
    return authenticated(async (ownerId) => {
        const result = await generateReport(ownerId, consultingCreateSchema.parse(await readJson(request)));
        return NextResponse.json({ data: result.data, reused: result.reused }, { status: result.reused ? 200 : 201 });
    }, request);
}
export async function GET(request: Request) {
    return authenticated(async (ownerId) => jsonOk(await getReports(ownerId, consultingQuerySchema.parse(queryParams(request)))), request);
}
