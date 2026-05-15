"use client";

export type ApiOk<T> = { ok: true; data: T };
export type ApiError = { ok: false; error: { message: string } };
export type ApiResponse<T> = ApiOk<T> | ApiError;

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const payload: ApiResponse<T> = await res.json();
  if (!payload.ok) throw new Error(payload.error.message);
  return payload.data;
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload: ApiResponse<T> = await res.json();
  if (!payload.ok) throw new Error(payload.error.message);
  return payload.data;
}

export async function apiPatch<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload: ApiResponse<T> = await res.json();
  if (!payload.ok) throw new Error(payload.error.message);
  return payload.data;
}

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE" });
  const payload: ApiResponse<T> = await res.json();
  if (!payload.ok) throw new Error(payload.error.message);
  return payload.data;
}
