import {
  createCredentialCheckRun,
  getProjectDetail,
  listProjectCredentialCheckRuns,
} from "../repositories/project-repository";
import { getAnalyticsHealth } from "./analytics-service";
import { decryptSecret } from "./credential-vault-service";
import { sendProjectOperationsAlertTest } from "./project-alert-service";

type CredentialServiceKey = "wordpress" | "meta" | "ga4" | "alerts";
type CredentialCheckStatus = "ready" | "warning" | "failed";

type CredentialCheckResult = {
  status: CredentialCheckStatus;
  summary: string;
  detail: string;
  expiresAt?: Date | null;
};

function normalizeWordPressBaseUrl(siteUrl: string) {
  const trimmed = siteUrl.trim();
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

async function checkWordPress(record: NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>) {
  if (!record.project.wordpressSiteUrl || !record.project.wordpressUsername || !record.project.wordpressAppPasswordEncrypted) {
    return {
      status: "warning" as const,
      summary: "워드프레스는 아직 미설정 상태입니다.",
      detail: "사이트 URL, 사용자명, 앱 비밀번호가 모두 있어야 연결 테스트를 실행합니다.",
    };
  }

  const appPassword = decryptSecret(record.project.wordpressAppPasswordEncrypted);
  if (!appPassword) {
    return {
      status: "failed" as const,
      summary: "저장된 워드프레스 앱 비밀번호를 복호화하지 못했습니다.",
      detail: "CREDENTIAL_ENCRYPTION_SECRET 또는 저장된 자격증명 형식을 확인하세요.",
    };
  }

  const authToken = Buffer.from(`${record.project.wordpressUsername}:${appPassword}`).toString("base64");
  const response = await fetch(`${normalizeWordPressBaseUrl(record.project.wordpressSiteUrl)}/wp-json/wp/v2/users/me`, {
    headers: {
      Authorization: `Basic ${authToken}`,
    },
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as { id?: number; name?: string; message?: string } | null;

  if (!response.ok || !payload?.id) {
    return {
      status: "failed" as const,
      summary: "워드프레스 인증 테스트에 실패했습니다.",
      detail: payload?.message || `HTTP ${response.status}`,
    };
  }

  return {
    status: "ready" as const,
    summary: "워드프레스 인증 테스트에 성공했습니다.",
    detail: `사용자 ${payload.name || record.project.wordpressUsername} 로 연결되었습니다.`,
  };
}

async function checkMeta(record: NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>) {
  if (!record.project.metaAccessTokenEncrypted || !record.project.facebookPageId || !record.project.instagramBusinessAccountId) {
    return {
      status: "warning" as const,
      summary: "Meta 채널은 아직 미설정 상태입니다.",
      detail: "Access Token, Facebook Page ID, Instagram Business Account ID가 모두 있어야 연결 테스트를 실행합니다.",
      expiresAt: record.project.metaTokenExpiresAt ?? null,
    };
  }

  const accessToken = decryptSecret(record.project.metaAccessTokenEncrypted);
  if (!accessToken) {
    return {
      status: "failed" as const,
      summary: "저장된 Meta 토큰을 복호화하지 못했습니다.",
      detail: "CREDENTIAL_ENCRYPTION_SECRET 또는 저장된 토큰 형식을 확인하세요.",
      expiresAt: record.project.metaTokenExpiresAt ?? null,
    };
  }

  const [identityResponse, pageResponse, igResponse] = await Promise.all([
    fetch(`https://graph.facebook.com/v23.0/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`, {
      cache: "no-store",
    }),
    fetch(
      `https://graph.facebook.com/v23.0/${encodeURIComponent(record.project.facebookPageId)}?fields=id,name&access_token=${encodeURIComponent(accessToken)}`,
      { cache: "no-store" },
    ),
    fetch(
      `https://graph.facebook.com/v23.0/${encodeURIComponent(record.project.instagramBusinessAccountId)}?fields=id,username&access_token=${encodeURIComponent(accessToken)}`,
      { cache: "no-store" },
    ),
  ]);

  const identity = (await identityResponse.json().catch(() => null)) as { id?: string; name?: string; error?: { message?: string } } | null;
  const page = (await pageResponse.json().catch(() => null)) as { id?: string; name?: string; error?: { message?: string } } | null;
  const instagram = (await igResponse.json().catch(() => null)) as { id?: string; username?: string; error?: { message?: string } } | null;

  if (!identityResponse.ok || !identity?.id) {
    return {
      status: "failed" as const,
      summary: "Meta 사용자 토큰 인증에 실패했습니다.",
      detail: identity?.error?.message || `HTTP ${identityResponse.status}`,
      expiresAt: record.project.metaTokenExpiresAt ?? null,
    };
  }

  if (!pageResponse.ok || !page?.id) {
    return {
      status: "failed" as const,
      summary: "Facebook 페이지 접근 테스트에 실패했습니다.",
      detail: page?.error?.message || `HTTP ${pageResponse.status}`,
      expiresAt: record.project.metaTokenExpiresAt ?? null,
    };
  }

  if (!igResponse.ok || !instagram?.id) {
    return {
      status: "failed" as const,
      summary: "Instagram 비즈니스 계정 접근 테스트에 실패했습니다.",
      detail: instagram?.error?.message || `HTTP ${igResponse.status}`,
      expiresAt: record.project.metaTokenExpiresAt ?? null,
    };
  }

  if (record.project.metaTokenExpiresAt) {
    const remainingMs = record.project.metaTokenExpiresAt.getTime() - Date.now();
    if (remainingMs <= 0) {
      return {
        status: "failed" as const,
        summary: "Meta 토큰 만료 예정일이 이미 지났습니다.",
        detail: "토큰을 갱신하고 새 만료일을 저장하세요.",
        expiresAt: record.project.metaTokenExpiresAt,
      };
    }

    if (remainingMs <= 7 * 24 * 60 * 60 * 1000) {
      return {
        status: "warning" as const,
        summary: "Meta 토큰 만료 예정일이 7일 이내입니다.",
        detail: `Facebook ${page.name || page.id}, Instagram ${instagram.username || instagram.id} 연결은 정상입니다.`,
        expiresAt: record.project.metaTokenExpiresAt,
      };
    }
  }

  return {
    status: "ready" as const,
    summary: "Meta 연결 테스트에 성공했습니다.",
    detail: `Facebook ${page.name || page.id}, Instagram ${instagram.username || instagram.id} 계정 접근이 확인됐습니다.`,
    expiresAt: record.project.metaTokenExpiresAt ?? null,
  };
}

async function checkGa4(record: NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>) {
  if (!record.project.ga4PropertyId) {
    return {
      status: "warning" as const,
      summary: "GA4 속성 ID가 아직 미설정 상태입니다.",
      detail: "프로젝트별 GA4 속성 ID를 저장하면 실제 연결 테스트를 실행합니다.",
    };
  }

  const health = await getAnalyticsHealth(record.project.ga4PropertyId || undefined);
  return {
    status: health.status === "ready" ? ("ready" as const) : ("failed" as const),
    summary:
      health.status === "ready"
        ? "GA4 연결 테스트에 성공했습니다."
        : "GA4 연결 테스트에 실패했습니다.",
    detail: health.detail,
  };
}

async function checkAlerts(record: NonNullable<Awaited<ReturnType<typeof getProjectDetail>>>, actorLabel?: string | null) {
  if (!record.project.operationsAlertWebhookEncrypted && !process.env.OPERATIONS_ALERT_WEBHOOK_URL?.trim()) {
    return {
      status: "warning" as const,
      summary: "운영 알림 채널이 아직 미설정 상태입니다.",
      detail: "프로젝트 웹훅 또는 OPERATIONS_ALERT_WEBHOOK_URL이 있어야 테스트 전송을 실행합니다.",
    };
  }

  const delivered = await sendProjectOperationsAlertTest({
    projectId: record.project.id,
    actorLabel,
  });

  if (!delivered) {
    return {
      status: "failed" as const,
      summary: "운영 알림 웹훅 전송에 실패했습니다.",
      detail: "프로젝트 웹훅 또는 OPERATIONS_ALERT_WEBHOOK_URL, 알림 정책, quiet hours 설정을 확인하세요.",
    };
  }

  return {
    status: "ready" as const,
    summary: "운영 알림 테스트 전송에 성공했습니다.",
    detail: "등록된 운영 채널로 테스트 알림을 전송했습니다.",
  };
}

function serializeCheckRun(run: Awaited<ReturnType<typeof listProjectCredentialCheckRuns>>[number]) {
  return {
    id: run.id,
    service: run.service,
    kind: run.kind,
    status: run.status,
    actorLabel: run.actorLabel,
    summary: run.summary,
    detail: run.detail,
    expiresAt: run.expiresAt?.toISOString() ?? null,
    checkedAt: run.checkedAt.toISOString(),
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

export async function recordCredentialRotation(params: {
  projectId: string;
  service: CredentialServiceKey;
  actorLabel?: string | null;
  summary: string;
  detail?: string | null;
  expiresAt?: Date | null;
}) {
  const run = await createCredentialCheckRun({
    projectId: params.projectId,
    service: params.service,
    kind: "rotate",
    status: "ready",
    actorLabel: params.actorLabel ?? null,
    summary: params.summary,
    detail: params.detail ?? null,
    expiresAt: params.expiresAt ?? null,
  });

  return serializeCheckRun(run);
}

export async function runProjectCredentialCheck(params: {
  projectId: string;
  service: CredentialServiceKey;
  actorLabel?: string | null;
}) {
  const record = await getProjectDetail(params.projectId);

  if (!record) {
    throw new Error("프로젝트를 찾지 못했습니다.");
  }

  const result: CredentialCheckResult =
    params.service === "wordpress"
      ? await checkWordPress(record)
      : params.service === "meta"
        ? await checkMeta(record)
        : params.service === "ga4"
          ? await checkGa4(record)
          : await checkAlerts(record, params.actorLabel);

  const run = await createCredentialCheckRun({
    projectId: params.projectId,
    service: params.service,
    kind: "validate",
    status: result.status,
    actorLabel: params.actorLabel ?? null,
    summary: result.summary,
    detail: result.detail,
    expiresAt: result.expiresAt ?? null,
  });

  return serializeCheckRun(run);
}

export async function getProjectCredentialHealth(projectId: string) {
  const runs = await listProjectCredentialCheckRuns(projectId, 40);
  const latestByService = new Map<string, Awaited<ReturnType<typeof listProjectCredentialCheckRuns>>[number]>();

  for (const run of runs) {
    if (!latestByService.has(run.service)) {
      latestByService.set(run.service, run);
    }
  }

  return {
    services: (["wordpress", "meta", "ga4", "alerts"] as CredentialServiceKey[]).map((service) => {
      const latest = latestByService.get(service);
      return {
        service,
        latest: latest ? serializeCheckRun(latest) : null,
      };
    }),
    history: runs.map(serializeCheckRun),
  };
}
