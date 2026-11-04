import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { UserRefreshClient } from 'google-auth-library';
import { prisma } from '@/lib/prisma';
import type { Ga4Scope, Ga4CredentialSource } from '@/types/ga4';
import { Ga4Failure } from './errors';
const clients = new Map<string, BetaAnalyticsDataClient>();
const epochs = new Map<string, number>();
export function invalidateGa4Credentials(ownerId?: string) {
  if (ownerId) { epochs.set(ownerId, (epochs.get(ownerId) ?? 0) + 1); }
  clients.clear();
}
export const invalidateDbCredentials = invalidateGa4Credentials;
export type CredentialCandidate = { source: Ga4CredentialSource; version: string; client: () => BetaAnalyticsDataClient };
function serviceAccount(raw: string): Record<string, string> {
  let data: Record<string, string>;
  try { data = JSON.parse(raw); } catch { throw new Ga4Failure('invalid_credentials'); }
  if (data.type !== 'service_account' || typeof data.client_email !== 'string' || !data.client_email || typeof data.private_key !== 'string' || !data.private_key) throw new Ga4Failure('invalid_credentials');
  return data;
}
async function loadCredentialCandidates(scope: Ga4Scope): Promise<CredentialCandidate[]> {
  const db = scope.allowedSources.includes('owner_oauth') ? await prisma.channelCredential.findUnique({
    where: { ownerId_channel: { ownerId: scope.ownerId, channel: 'ga4' } },
    select: { meta: true, refreshToken: true, updatedAt: true },
  }) : null;
  const candidates: CredentialCandidate[] = [];
  for (const source of ['service_account', 'owner_oauth', 'env_oauth', 'legacy_file'] as const) {
    if (!scope.allowedSources.includes(source)) continue;
    let raw: string | undefined;
    let data: Record<string, string> | undefined;
    let invalid = false;
    try {
      if (source === 'service_account') {
        raw = process.env.GA4_SERVICE_ACCOUNT_JSON?.trim();
        if (raw) data = serviceAccount(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
      } else if (source === 'legacy_file') {
        const file = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GA4_KEY_FILE;
        if (file) { raw = await readFile(file, 'utf8'); data = serviceAccount(raw); }
      } else {
        const meta = db?.meta as Record<string, string> | null;
        const refreshToken = source === 'owner_oauth' ? db?.refreshToken : process.env.GA4_OAUTH_REFRESH_TOKEN;
        if (refreshToken) {
          data = { type: 'authorized_user', refresh_token: refreshToken,
            client_id: (source === 'owner_oauth' ? meta?.client_id : undefined) || process.env.GA4_OAUTH_CLIENT_ID || '',
            client_secret: (source === 'owner_oauth' ? meta?.client_secret : undefined) || process.env.GA4_OAUTH_CLIENT_SECRET || '' };
          raw = JSON.stringify(data);
          if (!data.client_id || !data.client_secret) invalid = true;
        }
      }
    } catch { invalid = true; raw ??= 'invalid'; }
    if (!raw && !invalid) continue;
    const version = source + ':' + createHash('sha256').update(JSON.stringify({ raw, at: source === 'owner_oauth' ? db?.updatedAt : null,
      epoch: epochs.get(scope.ownerId) ?? 0 })).digest('hex').slice(0, 16);
    const key = `${scope.ownerId}:${scope.bindingId}:${version}`;
    candidates.push({ source, version, client: () => {
      if (invalid || !data) throw new Ga4Failure('invalid_credentials');
      const cached = clients.get(key);
      if (cached) return cached;
      const client = data.type === 'authorized_user' ? new BetaAnalyticsDataClient({
        authClient: new UserRefreshClient(data.client_id, data.client_secret, data.refresh_token), fallback: 'rest',
      }) : new BetaAnalyticsDataClient({ credentials: data, scopes: ['https://www.googleapis.com/auth/analytics.readonly'], fallback: 'rest' });
      if (clients.size >= 100) clients.delete(clients.keys().next().value!);
      clients.set(key, client);
      return client;
    } });
  }
  return candidates;
}

const requestCredentials = new AsyncLocalStorage<Map<string, Promise<CredentialCandidate[]>>>();
export function withGa4Request<T>(work: () => Promise<T>): Promise<T> {
  return requestCredentials.run(new Map(), work);
}
export function credentialCandidates(scope: Ga4Scope): Promise<CredentialCandidate[]> {
  const store = requestCredentials.getStore();
  if (!store) return loadCredentialCandidates(scope);
  const key = JSON.stringify([scope.ownerId, scope.bindingId, scope.allowedSources, epochs.get(scope.ownerId)]);
  let pending = store.get(key);
  if (!pending) { pending = loadCredentialCandidates(scope); store.set(key, pending); }
  return pending;
}
