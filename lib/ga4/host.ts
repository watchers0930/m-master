/**
 * GA4 hostName aliasing. Production GA4 reports the same site under both the apex and `www.` host
 * (e.g. vestra.ai.kr and www.vestra.ai.kr), so one binding must cover exactly those two forms —
 * and nothing else (preview/test hosts such as t-vestra.vercel.app or localhost stay excluded).
 */
export function normalizeGa4Host(host: string): string {
  const value = host.trim().toLowerCase().replace(/\.$/, '');
  // Strip only a leading `www.` that leaves a registrable-looking host (never "www.com" → "com").
  return value.startsWith('www.') && value.slice(4).includes('.') ? value.slice(4) : value;
}
/** The exact hostName values GA4 may report for one binding: [apex, www.apex]. */
export function ga4HostVariants(host: string): string[] {
  const apex = normalizeGa4Host(host);
  return apex.includes('.') ? [apex, 'www.' + apex] : [apex];
}
