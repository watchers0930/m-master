"use client";

export type ApiOk<T> = { ok: true; data: T };
export type ApiError = { ok: false; error: { message: string } };
export type ApiResponse<T> = ApiOk<T> | ApiError;

async function parseApiResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let payload: ApiResponse<T> | null = null;

  try {
    payload = text ? (JSON.parse(text) as ApiResponse<T>) : null;
  } catch {
    if (text.startsWith("Request Entity Too Large") || text.startsWith("Request Too Large")) {
      throw new Error("요청이 너무 큽니다. 첨부 파일 수나 본문 길이를 줄여 다시 시도하세요.");
    }

    if (!res.ok) {
      throw new Error(text.trim() || `요청에 실패했습니다. (${res.status})`);
    }

    throw new Error("서버 응답을 해석하지 못했습니다.");
  }

  if (!payload) {
    throw new Error("빈 응답을 받았습니다.");
  }

  if (!payload.ok) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  return parseApiResponse<T>(res);
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return parseApiResponse<T>(res);
}

export async function apiPatch<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseApiResponse<T>(res);
}

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE" });
  return parseApiResponse<T>(res);
}
