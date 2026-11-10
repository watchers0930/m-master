// lib/credentials/anchor-target.ts — set-anchor 스크립트가 운영 DB에 쓰지 못하게 하는 대상 판정(순수 함수, 비밀값 없음)
// 운영 앵커는 오직 운영 런타임의 POST /api/admin/credential-key로 만든다(런타임 자기 kid를 쓰므로 "운영 kid == 앵커"가 구조적으로 보장된다).
// 스크립트는 테스트·별도 개발 DB 전용이다: --non-production 플래그가 명시되고, Prisma가 읽을 수 있는 **모든** DB url이 허용목록에 있을 때만 허용한다.
// 허용목록(재검토 N3 — 거부목록은 운영 DB 이전·별칭에 조용히 낡는다):
//   ① 로컬: 실제 접속 호스트가 localhost·127.0.0.1·::1, 또는 유닉스 소켓 경로(?host=/…, PGlite 소켓 서버·로컬 Postgres)
//   ② 명시: env SET_ANCHOR_ALLOWED_HOSTS(쉼표 구분)에 그 호스트 전체 이름 또는 Neon 엔드포인트 id(첫 라벨에서 '-pooler'를 뗀 것)가 있을 때
//   그 밖은 전부 거부(풀러·직접 별칭, 처음 보는 호스트 포함). 운영 엔드포인트(PRODUCTION_DB_ENDPOINTS)는 허용목록에 적어도 거부한다.
// 판정 후보 = url 호스트 + ?host= + ?hostaddr= 전부(재검토 I-2: Prisma 6.19는 hostaddr를 무시하고 url 호스트로 붙고, host는 덮어쓴다 —
//   어느 쪽으로 붙을지 추측하지 않고 후보 하나라도 운영이면 production_db, 하나라도 허용 밖이면 거부한다).
// Neon ?options=endpoint%3D<id>는 다른 호스트(IP·프록시)로 같은 엔드포인트에 붙는다 → 그 id도 허용목록에 있어야 한다.

/** 운영(=로컬 .env.local이 공유하는) Neon DB 엔드포인트 id. 허용목록에 적혀도 거부한다(이중 안전). */
export const PRODUCTION_DB_ENDPOINTS: readonly string[] = ["ep-tiny-star-ap6aqxrc"];

/** lib/prisma.ts가 읽는 DB url env 전부(풀러·직접). 하나라도 허용되지 않으면 거부한다. */
const DB_URL_ENVS = ["POSTGRES_PRISMA_URL", "DATABASE_URL", "POSTGRES_URL", "DIRECT_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"] as const;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type SetAnchorTargetRefusal =
  | "flag_missing" | "production_runtime" | "db_url_missing" | "db_url_unparsable" | "production_db" | "db_host_not_allowed";

/** 판정 후보: url 호스트·?host=·?hostaddr=의 **모든** 값(같은 키 반복·쉼표 여러 호스트 포함). 유닉스 소켓 경로('/…')는 socket.
 *  재검토 I-4: Prisma 6.19는 같은 키가 여럿이면 마지막 값으로 붙는다 — get(첫 값)이 아니라 getAll로 전부 본다. options도 전부·endpoint 전부. */
type Target = { hosts: { host: string; endpoint: string; socket: boolean }[]; optionEndpoints: string[] };

function targetOf(url: string): Target | null {
  try {
    const u = new URL(url);
    const raw = [u.hostname, ...u.searchParams.getAll("host"), ...u.searchParams.getAll("hostaddr")]
      .flatMap((v) => v.split(",")).map((h) => h.trim()).filter(Boolean);
    if (!raw.length) return null;
    const hosts = raw.map((h) => {
      const host = h.toLowerCase();
      return { host, endpoint: host.split(".")[0].replace(/-pooler$/, ""), socket: host.startsWith("/") };
    });
    const optionEndpoints = u.searchParams.getAll("options")
      .flatMap((o) => [...o.matchAll(/(?:^|\s)(?:-c\s*)?endpoint=([^\s&]+)/gi)].map((m) => m[1].toLowerCase()));
    return { hosts, optionEndpoints };
  } catch {
    return null;
  }
}

function allowedList(env: Record<string, string | undefined>): Set<string> {
  return new Set((env.SET_ANCHOR_ALLOWED_HOSTS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** 거부 사유(고정 코드) 또는 null(허용). argv·env는 값만 읽고 출력하지 않는다. */
export function setAnchorTargetRefusal(argv: readonly string[], env: Record<string, string | undefined>): SetAnchorTargetRefusal | null {
  if (!argv.includes("--non-production")) return "flag_missing";
  if (env.VERCEL_ENV === "production") return "production_runtime";
  const urls = DB_URL_ENVS.map((name) => env[name]?.trim()).filter((v): v is string => !!v);
  if (!urls.length) return "db_url_missing";
  const allowed = allowedList(env);
  for (const url of urls) {
    const t = targetOf(url);
    if (!t) return "db_url_unparsable";
    // 후보 하나라도 운영이면 거부, 하나라도 허용 밖이면 거부(Prisma 6.19는 hostaddr를 무시하고 url 호스트로 붙는다 — 재검토 I-2)
    if ([...t.hosts.map((h) => h.endpoint), ...t.optionEndpoints].some((e) => PRODUCTION_DB_ENDPOINTS.includes(e))) return "production_db";
    if (t.optionEndpoints.some((e) => !allowed.has(e))) return "db_host_not_allowed";
    for (const h of t.hosts) {
      if (h.socket || LOCAL_HOSTS.has(h.host)) continue;
      if (!allowed.has(h.host) && !allowed.has(h.endpoint)) return "db_host_not_allowed";
    }
  }
  return null;
}
