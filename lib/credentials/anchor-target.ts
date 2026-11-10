// lib/credentials/anchor-target.ts — set-anchor 스크립트가 운영 DB에 쓰지 못하게 하는 대상 판정(순수 함수, 비밀값 없음)
// 운영 앵커는 오직 운영 런타임의 POST /api/admin/credential-key로 만든다(런타임 자기 kid를 쓰므로 "운영 kid == 앵커"가 구조적으로 보장된다).
// 스크립트는 테스트·별도 개발 DB 전용이다: --non-production 플래그가 명시되고, Prisma가 읽을 수 있는 어떤 DB url도
// 운영 DB 엔드포인트를 가리키지 않을 때만 허용한다. 운영 DB 엔드포인트 목록은 런북(task-13-runbook.md)에 같은 값으로 적는다.
// 판정은 호스트 첫 라벨에서 Neon '-pooler' 접미를 뗀 엔드포인트 id로 한다(풀러·직접 연결 모두 같은 DB).

/** 운영(=로컬 .env.local이 공유하는) Neon DB 엔드포인트 id. 바뀌면 런북과 함께 고친다. */
export const PRODUCTION_DB_ENDPOINTS: readonly string[] = ["ep-tiny-star-ap6aqxrc"];

/** lib/prisma.ts가 읽는 DB url env 전부(풀러·직접). 하나라도 운영이면 거부한다. */
const DB_URL_ENVS = ["POSTGRES_PRISMA_URL", "DATABASE_URL", "POSTGRES_URL", "DIRECT_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"] as const;

export type SetAnchorTargetRefusal = "flag_missing" | "production_runtime" | "db_url_missing" | "db_url_unparsable" | "production_db";

function endpointOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (!host) return null;
    return host.split(".")[0].replace(/-pooler$/, "");
  } catch {
    return null;
  }
}

/** 거부 사유(고정 코드) 또는 null(허용). argv·env는 값만 읽고 출력하지 않는다. */
export function setAnchorTargetRefusal(argv: readonly string[], env: Record<string, string | undefined>): SetAnchorTargetRefusal | null {
  if (!argv.includes("--non-production")) return "flag_missing";
  if (env.VERCEL_ENV === "production") return "production_runtime";
  const urls = DB_URL_ENVS.map((name) => env[name]?.trim()).filter((v): v is string => !!v);
  if (!urls.length) return "db_url_missing";
  for (const url of urls) {
    const endpoint = endpointOf(url);
    if (!endpoint) return "db_url_unparsable";
    if (PRODUCTION_DB_ENDPOINTS.includes(endpoint)) return "production_db";
  }
  return null;
}
