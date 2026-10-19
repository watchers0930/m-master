import { z } from "zod";
export interface RunContext {
  ownerId: string;
  queryId?: string;
  requestId: string;
  taskId?: string;
  onTask?: (
    taskId: string | undefined,
    costKrw: number,
    response?: VendorEnvelope,
  ) => Promise<void>;
}
const taskSchema = z
  .object({
    id: z.string().nullable().optional(),
    status_code: z.number(),
    cost: z.number().nonnegative().optional(),
    result: z.array(z.unknown()).nullable().optional(),
  })
  .passthrough();
const envelopeSchema = z.object({
  status_code: z.number(),
  cost: z.number().nonnegative().optional(),
  tasks: z.array(taskSchema).nullable(),
});
export type VendorEnvelope = z.infer<typeof envelopeSchema>;
export class DataForSeoError extends Error {
  constructor(
    public reason: string,
    public costKrw = 0,
    public taskId?: string,
  ) {
    super(reason);
  }
}
function responseCost(result: VendorEnvelope): number {
  return usdToKrw(
    Math.max(
      result.cost ?? 0,
      result.tasks?.reduce((total, task) => total + (task.cost ?? 0), 0) ?? 0,
    ),
  );
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export function usdToKrw(usd: number): number {
  const rate = Number(process.env.DATAFORSEO_USD_KRW ?? "1400");
  if (!Number.isFinite(rate) || rate <= 0)
    throw new DataForSeoError("invalid_exchange_rate");
  return usd * rate;
}
export class DataForSeoClient {
  constructor(private transport: typeof fetch = fetch) {}
  private async request(
    path: string,
    body?: unknown,
    deadline = Date.now() + 45000,
  ): Promise<VendorEnvelope> {
    if (!/^[a-z0-9_/-]+$/i.test(path) || path.includes(".."))
      throw new DataForSeoError("invalid_vendor_path");
    const login = process.env.DATAFORSEO_LOGIN,
      password = process.env.DATAFORSEO_PASSWORD;
    if (!login || !password) throw new DataForSeoError("vendor_not_configured");
    // Only GET requests retry. A paid POST with an uncertain response must never be replayed.
    for (let attempt = 0; attempt < (body === undefined ? 3 : 1); attempt++) {
      if (Date.now() >= deadline)
        throw new DataForSeoError("vendor_unavailable");
      let response: Response;
      try {
        response = await this.transport(
          `https://api.dataforseo.com/v3/${path}`,
          {
            method: body === undefined ? "GET" : "POST",
            redirect: "error",
            headers: {
              Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
              "Content-Type": "application/json",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(
              Math.max(1, Math.min(25000, deadline - Date.now())),
            ),
          },
        );
      } catch {
        throw new DataForSeoError(
          body === undefined ? "vendor_unavailable" : "submission_uncertain",
        );
      }
      if (response.status === 429 && body === undefined && attempt < 2) {
        const retry = response.headers.get("retry-after");
        const seconds = retry ? Number(retry) : NaN;
        const wait = Number.isFinite(seconds)
          ? seconds * 1000
          : retry
            ? Date.parse(retry) - Date.now()
            : 1000 * 2 ** attempt;
        if (wait > 5000 || Date.now() + wait + 200 >= deadline)
          throw new DataForSeoError("vendor_rate_limited");
        await sleep(Math.max(0, wait) + Math.random() * 200);
        continue;
      }
      if (!response.ok)
        throw new DataForSeoError(
          response.status === 401 ? "vendor_auth_failed" : "vendor_http_failed",
        );
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new DataForSeoError("submission_uncertain");
      }
      const parsed = envelopeSchema.safeParse(raw);
      if (!parsed.success) throw new DataForSeoError("vendor_invalid_response");
      return parsed.data;
    }
    throw new DataForSeoError("vendor_rate_limited");
  }
  async post<T = VendorEnvelope>(path: string, body: unknown): Promise<T> {
    const result = await this.request(path, body);
    this.assertSuccess(result);
    return result as T;
  }
  private assertSuccess(result: VendorEnvelope) {
    const task = result.tasks?.[0];
    if (result.status_code !== 20000 || !task || task.status_code !== 20000) {
      throw new DataForSeoError(
        `vendor_status_${task?.status_code ?? result.status_code}`,
        responseCost(result),
        task?.id ?? undefined,
      );
    }
  }
  async task<T = VendorEnvelope>(
    path: string,
    body: unknown,
    ctx: RunContext,
  ): Promise<T> {
    const deadline = Date.now() + 45000;
    let taskId = ctx.taskId;
    if (!taskId) {
      const created = await this.request(path, body, deadline);
      const task = created.tasks?.[0];
      const cost = responseCost(created);
      taskId = task?.id ?? undefined;
      // Durable task identity and billing checkpoint before polling, including failed tasks.
      await ctx.onTask?.(taskId, cost, created);
      if (
        created.status_code !== 20000 ||
        !task ||
        ![20000, 20100].includes(task.status_code)
      ) {
        throw new DataForSeoError(
          `vendor_status_${task?.status_code ?? created.status_code}`,
          cost,
          taskId,
        );
      }
      if (
        !path.endsWith("/task_post") ||
        (task.status_code === 20000 && task.result?.length)
      )
        return created as T;
      if (!taskId) throw new DataForSeoError("submission_uncertain", cost);
    }
    if (!path.endsWith("/task_post"))
      throw new DataForSeoError("task_pending", 0, taskId);
    const base = path.replace(/\/task_post$/, "");
    const suffix = base.includes("llm_responses") ? "" : "/advanced";
    for (let i = 0; i < 4; i++) {
      const result = await this.request(
        `${base}/task_get${suffix}/${encodeURIComponent(taskId)}`,
        undefined,
        deadline,
      );
      const code = result.tasks?.[0]?.status_code;
      if (code === 20000) {
        this.assertSuccess(result);
        return result as T;
      }
      if (![20100, 40601, 40602, 40104].includes(code ?? 0))
        this.assertSuccess(result);
      if (i < 3 && Date.now() + 500 * 2 ** i + 150 < deadline)
        await sleep(500 * 2 ** i + Math.random() * 150);
      else if (Date.now() >= deadline) break;
    }
    throw new DataForSeoError("task_pending", 0, taskId);
  }
}
