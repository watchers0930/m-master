import crypto from "crypto";

import {
  countProjectOperators,
  createProjectOperator,
  createProjectOperatorSession,
  deleteExpiredProjectOperatorSessions,
  deleteProjectOperatorSessionByTokenHash,
  getProjectOperatorById,
  getProjectOperatorByName,
  getProjectOperatorSessionByTokenHash,
  listProjectOperators,
  touchProjectOperatorSession,
  updateProjectOperator,
} from "../repositories/project-repository";

const SESSION_COOKIE_NAME = "m_master_operator_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const ROLE_RANK = {
  viewer: 1,
  analyst: 2,
  reviewer: 3,
  operator: 4,
  owner: 5,
} as const;

export type ProjectOperatorRole = keyof typeof ROLE_RANK;
export type ProjectOperatorAccessIdentity = {
  operatorId: string;
  projectId: string;
  name: string;
  role: ProjectOperatorRole;
  accessKeyHash: string;
  active: boolean;
  lastUsedAt?: string | null;
};

export class ProjectOperatorAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "ProjectOperatorAuthError";
    this.status = status;
  }
}

function normalizeRole(value?: string | null): ProjectOperatorRole {
  if (!value) {
    return "viewer";
  }

  if (value in ROLE_RANK) {
    return value as ProjectOperatorRole;
  }

  return "viewer";
}

function hashValue(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseCookies(request: Request) {
  const header = request.headers.get("cookie") || "";
  return header.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) {
      return acc;
    }

    acc[rawKey] = decodeURIComponent(rawValue.join("="));
    return acc;
  }, {});
}

function getBootstrapSecret() {
  return process.env.PROJECT_OPERATOR_BOOTSTRAP_SECRET?.trim() || "";
}

export function getProjectOperatorSessionCookieName() {
  return SESSION_COOKIE_NAME;
}

export function buildProjectOperatorSessionCookie(token: string) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function buildProjectOperatorSessionClearCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function bootstrapProjectOperator(params: {
  projectId: string;
  name: string;
  role?: ProjectOperatorRole;
  accessKey: string;
  bootstrapSecret: string;
}) {
  const expected = getBootstrapSecret();

  if (!expected || params.bootstrapSecret !== expected) {
    throw new ProjectOperatorAuthError("운영자 부트스트랩 키가 올바르지 않습니다.", 403);
  }

  const existingCount = await countProjectOperators(params.projectId);

  if (existingCount > 0) {
    throw new ProjectOperatorAuthError("이미 운영자가 등록된 프로젝트입니다. owner 권한으로 관리하세요.", 409);
  }

  return createProjectOperator({
    projectId: params.projectId,
    name: params.name.trim(),
    role: params.role ?? "owner",
    accessKeyHash: hashValue(params.accessKey.trim()),
  });
}

export async function authenticateProjectOperator(params: {
  projectId: string;
  name: string;
  accessKey: string;
}) {
  await deleteExpiredProjectOperatorSessions();

  const operator = await getProjectOperatorByName({
    projectId: params.projectId,
    name: params.name.trim(),
  });

  if (!operator || !operator.active) {
    throw new ProjectOperatorAuthError("운영자 계정을 찾지 못했습니다.", 401);
  }

  if (operator.accessKeyHash !== hashValue(params.accessKey.trim())) {
    throw new ProjectOperatorAuthError("운영자 접근 키가 올바르지 않습니다.", 401);
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await createProjectOperatorSession({
    operatorId: operator.id,
    tokenHash: hashValue(token),
    expiresAt,
  });

  return {
    token,
    expiresAt,
    operator: {
      id: operator.id,
      projectId: operator.projectId,
      name: operator.name,
      role: normalizeRole(operator.role),
      active: operator.active,
      lastUsedAt: operator.lastUsedAt?.toISOString() ?? null,
    },
  };
}

export async function revokeProjectOperatorSession(request: Request) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE_NAME];

  if (!token) {
    return;
  }

  await deleteProjectOperatorSessionByTokenHash(hashValue(token));
}

export async function getAuthorizedProjectOperator(request: Request, projectId: string) {
  await deleteExpiredProjectOperatorSessions();

  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE_NAME];

  if (!token) {
    return null;
  }

  const session = await getProjectOperatorSessionByTokenHash(hashValue(token));

  if (!session || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  if (!session.operator.active || session.operator.projectId !== projectId) {
    return null;
  }

  await touchProjectOperatorSession({
    sessionId: session.id,
    operatorId: session.operatorId,
  });

  return {
    id: session.operator.id,
    projectId: session.operator.projectId,
    name: session.operator.name,
    role: normalizeRole(session.operator.role),
    active: session.operator.active,
    lastUsedAt: session.operator.lastUsedAt?.toISOString() ?? null,
  };
}

export async function getCurrentProjectOperatorAccessIdentity(request: Request): Promise<ProjectOperatorAccessIdentity | null> {
  await deleteExpiredProjectOperatorSessions();

  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE_NAME];

  if (!token) {
    return null;
  }

  const session = await getProjectOperatorSessionByTokenHash(hashValue(token));

  if (!session || session.expiresAt.getTime() <= Date.now() || !session.operator.active) {
    return null;
  }

  await touchProjectOperatorSession({
    sessionId: session.id,
    operatorId: session.operatorId,
  });

  return {
    operatorId: session.operator.id,
    projectId: session.operator.projectId,
    name: session.operator.name,
    role: normalizeRole(session.operator.role),
    accessKeyHash: session.operator.accessKeyHash,
    active: session.operator.active,
    lastUsedAt: session.operator.lastUsedAt?.toISOString() ?? null,
  };
}

export async function requireProjectOperatorRole(
  request: Request,
  projectId: string,
  minimumRole: ProjectOperatorRole,
) {
  const operator = await getAuthorizedProjectOperator(request, projectId);

  if (!operator) {
    throw new ProjectOperatorAuthError("운영자 로그인 세션이 필요합니다.", 401);
  }

  if (ROLE_RANK[operator.role] < ROLE_RANK[minimumRole]) {
    throw new ProjectOperatorAuthError(`이 작업에는 ${minimumRole} 이상 권한이 필요합니다.`, 403);
  }

  return operator;
}

export async function listProjectOperatorsForProject(projectId: string) {
  const operators = await listProjectOperators(projectId);
  return operators.map((operator) => ({
    id: operator.id,
    name: operator.name,
    role: normalizeRole(operator.role),
    active: operator.active,
    lastUsedAt: operator.lastUsedAt?.toISOString() ?? null,
    createdAt: operator.createdAt.toISOString(),
    updatedAt: operator.updatedAt.toISOString(),
  }));
}

export async function createManagedProjectOperator(params: {
  projectId: string;
  name: string;
  role: ProjectOperatorRole;
  accessKey: string;
}) {
  return createProjectOperator({
    projectId: params.projectId,
    name: params.name.trim(),
    role: params.role,
    accessKeyHash: hashValue(params.accessKey.trim()),
  });
}

export async function updateManagedProjectOperator(params: {
  projectId: string;
  operatorId: string;
  role?: ProjectOperatorRole;
  active?: boolean;
  accessKey?: string;
}) {
  const operator = await getProjectOperatorById({
    projectId: params.projectId,
    operatorId: params.operatorId,
  });

  if (!operator) {
    throw new ProjectOperatorAuthError("운영자 계정을 찾지 못했습니다.", 404);
  }

  return updateProjectOperator({
    operatorId: params.operatorId,
    role: params.role,
    active: params.active,
    accessKeyHash: params.accessKey ? hashValue(params.accessKey.trim()) : undefined,
  });
}

export async function recoverProjectOperatorAccess(params: {
  projectId: string;
  name: string;
  accessKey: string;
  bootstrapSecret: string;
}) {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1") {
    throw new ProjectOperatorAuthError("운영자 복구는 로컬 개발 환경에서만 허용됩니다.", 403);
  }

  const expected = getBootstrapSecret();

  if (!expected || params.bootstrapSecret.trim() !== expected) {
    throw new ProjectOperatorAuthError("운영자 부트스트랩 키가 올바르지 않습니다.", 403);
  }

  const operators = await listProjectOperators(params.projectId);
  const normalizedName = params.name.trim();
  const nextAccessKeyHash = hashValue(params.accessKey.trim());
  const targetOperator =
    operators.find((operator) => operator.name === normalizedName) ??
    operators.find((operator) => normalizeRole(operator.role) === "owner") ??
    null;

  if (!targetOperator) {
    return createProjectOperator({
      projectId: params.projectId,
      name: normalizedName,
      role: "owner",
      accessKeyHash: nextAccessKeyHash,
    });
  }

  return updateProjectOperator({
    operatorId: targetOperator.id,
    role: "owner",
    active: true,
    accessKeyHash: nextAccessKeyHash,
  });
}
