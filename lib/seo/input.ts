import { lookup } from "node:dns/promises";
import { isIP, BlockList } from "node:net";
import { normalizeHost } from "@/lib/visibility/normalize";
import { VisibilityError } from "@/lib/visibility/http";
export async function readJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("body required");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        throw new SyntaxError("body too large");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
const blocked = new BlockList();
for (const [ip, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(ip, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
export function publicAddress(ip: string) {
  if (isIP(ip) === 4) return !blocked.check(ip, "ipv4");
  // Accept global unicast only; reject mapped IPv4 and transition/tunnel ranges.
  return (
    isIP(ip) === 6 &&
    globalV6.check(ip, "ipv6") &&
    !/^(2001:(?:0:|db8:)|2002:)/i.test(ip)
  );
}
export async function publicHost(value: string) {
  const host = normalizeHost(value);
  if (
    !host.includes(".") ||
    /\.(local|internal|localhost|test|invalid)$/i.test(host)
  )
    throw new VisibilityError(
      "bad_request",
      "공개 도메인만 진단할 수 있습니다.",
      400,
    );
  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new VisibilityError(
      "bad_request",
      "도메인 DNS를 확인할 수 없습니다.",
      400,
    );
  }
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new VisibilityError(
      "bad_request",
      "공개 도메인만 진단할 수 있습니다.",
      400,
    );
  return host;
}
