import type { Ga4Result, Ga4Block } from '@/types/ga4';
export function toGa4Block<T>(result: Ga4Result<T>): Ga4Block<T> {
  if (result.status === 'success') return { state: 'ok', data: result.data, collected_at: result.provenance.collectedAt, host: result.provenance.host, property_id: result.provenance.propertyId,
    ...(result.provenance.scopeLevel ? { scope_level: result.provenance.scopeLevel } : {}) };
  if (result.status === 'unavailable') return { state: result.reason };
  return { state: 'error', code: result.code, retryable: result.retryable };
}
