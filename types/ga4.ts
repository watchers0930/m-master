export type Ga4UnavailableReason = 'not_configured' | 'unmapped' | 'domain_required' | 'binding_disabled';
export type Ga4ErrorCode = 'invalid_credentials' | 'permission_denied' | 'quota_exceeded' | 'timeout' | 'upstream_error' | 'invalid_query';
export type Ga4CredentialSource = 'service_account' | 'owner_oauth' | 'env_oauth' | 'legacy_file';
export interface Ga4Provenance {
  ownerId: string; domainId: string; bindingId: string; propertyId: string; host: string;
  credentialSource: Ga4CredentialSource; collectedAt: string;
  range: { startDate: string; endDate: string }; timeZone: string | null; queryVersion: string;
  completeness: 'complete' | 'partial';
  quality: { thresholded?: boolean; sampled?: boolean; truncatedRows?: boolean; dataLossFromOtherRow?: boolean };
  scopeLevel?: 'host' | 'stream';
}
export type Ga4Result<T> =
  | { status: 'success'; data: T; provenance: Ga4Provenance }
  | { status: 'unavailable'; reason: Ga4UnavailableReason }
  | { status: 'error'; code: Ga4ErrorCode; retryable: boolean; attempts?: { source: Ga4CredentialSource; code: Ga4ErrorCode }[] };
export type Ga4Block<T> =
  | { state: 'ok'; data: T; collected_at: string; host: string; property_id: string; scope_level?: 'host' | 'stream' }
  | { state: Ga4UnavailableReason }
  | { state: 'error'; code: Ga4ErrorCode; retryable: boolean };
export interface Ga4Scope {
  ownerId: string; domainId: string; bindingId: string; propertyId: string; host: string;
  streamId?: string | null;
  allowedSources: Ga4CredentialSource[]; conversionEvents: string[];
}
// Preserve the shared frontend import while keeping implementation in lib.
export { toGa4Block } from '@/lib/ga4/block';
