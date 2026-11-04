import { toSnakeCase } from '@/lib/utils/case';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticated, VisibilityError } from '@/lib/visibility/http';
import { refreshTopics } from '@/lib/topics/service';
import { getMondayOfWeekKST } from '@/lib/topics/week-utils';
const schema=z.object({ domain_id:z.string().min(1).max(200).nullable().optional() }).strict();
export async function POST(request: Request) {
  return authenticated(async ownerId => {
    const text=await request.text(), input=schema.parse(text ? JSON.parse(text):{});
    const result=await refreshTopics({ ownerId,domainId:input.domain_id ?? null,weekStart:getMondayOfWeekKST(),mode:'regenerate',channel:'blog' });
    if (result.status==='in_progress') throw new VisibilityError('in_progress','추천 생성 중입니다.',409);
    return NextResponse.json({ items:result.items.map(toSnakeCase),count:result.count,shortfall_reason:result.shortfallReason,
      strategy:{ report_id:result.strategy.reportId,reason:result.strategy.reason },ga4_status:result.ga4Status,status:result.status });
  },request,{ requireOrigin:true });
}
