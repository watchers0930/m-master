import { domainToASCII } from "node:url";

/** Host identity preserves www/subdomains; never compares by substring. No network access. */
export function normalizeHost(input: string): string {
  const value = input.trim();
  if (!value || /[\s\\]/u.test(value)) throw new Error("invalid_host");
  const parsed = new URL(value.includes("://") ? value : `https://${value}`);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new Error("invalid_host");
  const host = domainToASCII(parsed.hostname.toLowerCase().replace(/\.+$/, ""));
  if (
    !host ||
    host.length > 253 ||
    !host.includes(".") ||
    /^\d+(\.\d+){3}$/.test(host) ||
    !host
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error("invalid_host");
  return host;
}
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}
export function citationHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) return null;
    return normalizeHost(url);
  } catch {
    return null;
  }
}
