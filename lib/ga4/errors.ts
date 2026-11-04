import type { Ga4ErrorCode } from '@/types/ga4';
export class Ga4Failure extends Error {
  constructor(public code: Ga4ErrorCode) { super(code); }
}
export function classifyGa4Error(error: unknown): { code: Ga4ErrorCode; retryable: boolean } {
  let code: Ga4ErrorCode = 'upstream_error';
  if (error instanceof Ga4Failure) code = error.code;
  else if (error && typeof error === 'object') {
    const record = error as { code?:unknown; status?:unknown; response?:{ status?:unknown; data?:{ error?:unknown } } };
    const rawStatus = record.code ?? record.status ?? record.response?.status;
    const status = typeof rawStatus === 'string' && /^\d+$/.test(rawStatus) ? Number(rawStatus) : rawStatus;
    if (record.response?.data?.error === 'invalid_grant') return { code:'invalid_credentials',retryable:false };
    if ([16, 401, 'UNAUTHENTICATED', 'invalid_grant'].includes(status as string)) code = 'invalid_credentials';
    else if ([7, 403, 'PERMISSION_DENIED'].includes(status as string)) code = 'permission_denied';
    else if ([8, 429, 'RESOURCE_EXHAUSTED'].includes(status as string)) code = 'quota_exceeded';
    else if ([4, 'DEADLINE_EXCEEDED', 'ETIMEDOUT', 'ABORT_ERR'].includes(status as string)) code = 'timeout';
    else if ([3, 400, 'INVALID_ARGUMENT'].includes(status as string)) code = 'invalid_query';
  }
  return { code, retryable: ['quota_exceeded', 'timeout', 'upstream_error'].includes(code) };
}
