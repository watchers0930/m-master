/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, process, Response */
require("../../visibility/__tests__/register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
require.cache[require.resolve("../../auth.ts")] = {
  exports: { requireSession: async () => ({ user: { id: "owner" } }) },
};
require.cache[require.resolve("../input.ts")] = {
  exports: { publicHost: async (value) => value },
};
let state,
  applicationFails = false,
  checkpointFails = false,
  events = [];
require.cache[require.resolve("../tasks.ts")] = {
  exports: {
    beginExecution: async () => {},
    releaseClaim: async () => {},
    savedCheckpoint: async () => state.resultCheckpoint,
    checkpointTask: async (_task, id, cost, result) => {
      if (checkpointFails) throw new Error("DB unavailable");
      events.push("checkpoint");
      state.vendorTaskId = id ?? state.vendorTaskId;
      state.costKrw = Math.max(state.costKrw, cost);
      state.resultCheckpoint = result ?? state.resultCheckpoint;
    },
    taskResult: async (_task, result) => {
      events.push("apply");
      if (applicationFails) {
        applicationFails = false;
        throw new Error("save failed");
      }
      state.resultCheckpoint = result;
      state.status = result.pageFailures.length ? (result.pages.length ? "partial" : "failed") : "completed";
    },
    markTask: async (_task, status, reason) => {
      state.status = status;
      state.failReason = reason;
    },
  },
};
const { executeTask } = require("../execute.ts");
const { DataForSeoClient } = require("../../external/dataforseo.ts");
process.env.DATAFORSEO_LOGIN = "test";
process.env.DATAFORSEO_PASSWORD = "test";
function task(operation = "onpage_instant") {
  events = [];
  applicationFails = false;
  checkpointFails = false;
  state = {
    id: "task",
    auditId: "audit",
    ownerId: "owner",
    runKey: "run",
    operation,
    itemKey: "-",
    status: "submitted",
    frozenInput: {
      host: "example.com",
      market: "ko-KR",
      engine: "google",
      keyword: "seo",
    },
    vendorTaskId: null,
    resultCheckpoint: null,
    costKrw: 0,
    claimVersion: 1,
  };
  return { ...state };
}
function envelope(result, code = 20000, cost = 0.001) {
  return {
    status_code: 20000,
    cost,
    tasks: [{ id: "vendor-id", status_code: code, cost, result }],
  };
}
test("POST response loss is uncertain after exactly one paid attempt", async () => {
  let calls = 0;
  const initial = task();
  const client = new DataForSeoClient(async () => {
    calls++;
    throw new Error("connection lost");
  });
  await executeTask(initial, client);
  assert.equal(calls, 1);
  assert.equal(state.status, "uncertain");
  assert.equal(state.failReason, "submission_uncertain");
});
test("Live checkpoint commits before business writes; resume applies saved result without another purchase", async () => {
  let calls = 0;
  const initial = task();
  applicationFails = true;
  const client = new DataForSeoClient(async () => {
    calls++;
    return Response.json(
      envelope([
        {
          items: [
            {
              url: "https://example.com",
              status_code: 200,
              meta: { title: "Title" },
              checks: {},
            },
          ],
        },
      ]),
    );
  });
  await executeTask(initial, client);
  assert.deepEqual(events, ["checkpoint", "apply"]);
  assert.equal(state.status, "submitted");
  assert.ok(state.resultCheckpoint);
  assert.ok(state.costKrw > 0);
  await executeTask({ ...state }, client);
  assert.equal(calls, 1);
  assert.equal(state.status, "completed");
});
test("checkpoint persistence failure holds uncertain status and never applies the result", async () => {
  const initial = task();
  checkpointFails = true;
  const client = new DataForSeoClient(async () =>
    Response.json(envelope([{ items: [] }])),
  );
  await executeTask(initial, client);
  assert.equal(state.status, "uncertain");
  assert.deepEqual(events, []);
});
test("known asynchronous SERP task resumes with GET only and retains prepaid cost", async () => {
  const initial = task("serp_google");
  initial.vendorTaskId = state.vendorTaskId = "paid-task";
  state.costKrw = 12;
  const methods = [];
  const client = new DataForSeoClient(async (address, options) => {
    methods.push(options.method);
    assert.ok(address.endsWith("/task_get/advanced/paid-task"));
    return Response.json(envelope([{ items: [] }], 20000, 0));
  });
  await executeTask(initial, client);
  assert.deepEqual(methods, ["GET"]);
  assert.equal(state.status, "completed");
  assert.equal(state.costKrw, 12);
  assert.equal(state.resultCheckpoint.observations[0].status, "no_result");
});
test("crawl result strategy reads summary/pages and preserves actual count and robots restriction", async () => {
  const initial = task("onpage_crawl");
  initial.vendorTaskId = state.vendorTaskId = "crawl-id";
  const paths = [];
  const client = new DataForSeoClient(async (address, options) => {
    paths.push(address);
    if (address.endsWith("/summary/crawl-id"))
      return Response.json(
        envelope(
          [
            {
              crawl_progress: "finished",
              crawl_status: { pages_crawled: 17 },
              crawl_stop_reason: "limit_exceeded",
              domain_info: { extended_crawl_status: "forbidden_robots" },
            },
          ],
          20000,
          0,
        ),
      );
    assert.ok(address.endsWith("/on_page/pages"));
    assert.deepEqual(JSON.parse(options.body), [{ id: "crawl-id", limit: 20 }]);
    return Response.json(envelope([{ items: [] }], 20000, 0));
  });
  await executeTask(initial, client);
  assert.equal(paths.length, 2);
  assert.equal(
    paths.some((p) => p.endsWith("/task_post")),
    false,
  );
  assert.equal(state.resultCheckpoint.crawledPages, 17);
  assert.equal(
    state.resultCheckpoint.collection.extendedStatus,
    "forbidden_robots",
  );
  const { technicalChecks } = require("../checks.ts");
  assert.equal(
    technicalChecks([], state.resultCheckpoint.collection).checks.find(
      (c) => c.key === "robots_allowed",
    ).status,
    "fail",
  );
});
test("known charged vendor failure checkpoints cost and returns a sanitized final reason", async () => {
  const initial = task();
  const client = new DataForSeoClient(async () =>
    Response.json(envelope(null, 40501, 0.002)),
  );
  await executeTask(initial, client);
  assert.equal(state.status, "failed");
  assert.ok(state.costKrw > 0);
  assert.equal(state.failReason.includes("40501"), false);
  assert.deepEqual(events, ["checkpoint"]);
});
test("a Live task ID without its result is quarantined instead of repurchased", async () => {
  const initial = task();
  initial.vendorTaskId = state.vendorTaskId = "live-id";
  let calls = 0;
  const client = new DataForSeoClient(async () => {
    calls++;
    throw new Error("must not call");
  });
  await executeTask(initial, client);
  assert.equal(calls, 0);
  assert.equal(state.status, "uncertain");
});

function batchTask(address, code = 20000, cost = 0.001) {
  return { id: `id-${address}`, status_code: code, cost, data: {url: address},
    result: code === 20000 ? [{items: [{url: address, status_code:200,meta:{title:"Title"},checks:{}}]}] : null };
}
test("instant batch second-task failure preserves charged successful page and failed URL as partial; replay never repurchases", async () => {
  const initial = task(); initial.frozenInput.paths = ["/a", "/b"];
  let calls = 0;
  const client = new DataForSeoClient(async () => {
    calls++;
    return Response.json({status_code:20000,tasks:[
      batchTask("https://example.com/a"),batchTask("https://example.com/b",40501,0.002)]});
  });
  applicationFails = true;
  await executeTask(initial,client);
  assert.equal(state.status,"submitted");
  assert.equal(state.costKrw,0.003 * Number(process.env.DATAFORSEO_USD_KRW ?? "1400"));
  assert.equal(state.resultCheckpoint.pages[0].url,"https://example.com/a");
  assert.deepEqual(state.resultCheckpoint.pageFailures,[{url:"https://example.com/b",reason:"vendor_failed",vendorStatus:40501}]);
  await executeTask({...state},client);
  assert.equal(state.status,"partial"); assert.equal(calls,1);
});
test("instant batch validates reordered, missing, duplicate and mismatched request URLs", () => {
  const { parseOnpage } = require("../adapters/onpage.ts");
  const input = {host:"example.com",market:"ko-KR",paths:["/a","/b"]};
  const a = batchTask("https://example.com/a"), b = batchTask("https://example.com/b");
  const parse = (tasks) => parseOnpage({status_code:20000,tasks},input);
  assert.equal(parse([b,a]).pages.length,2); assert.deepEqual(parse([b,a]).pageFailures,[]);
  assert.deepEqual(parse([a]).pageFailures.map((v) => v.url),["https://example.com/b"]);
  assert.equal(parse([a,a]).pageFailures[0].reason,"duplicate_task");
  const wrong = batchTask("https://example.com/b"); wrong.result[0].items[0].url = "https://elsewhere.com/";
  assert.equal(parse([a,wrong]).pageFailures[0].reason,"url_mismatch");
  const empty = batchTask("https://example.com/b"); empty.result = [];
  assert.equal(parse([a,empty]).pageFailures[0].reason,"missing_page");
});
test("vendor client rejects any failed task, even when the first task succeeds, after checkpointing total charge", async () => {
  let charge;
  const client = new DataForSeoClient(async () => Response.json({status_code:20000,tasks:[
    batchTask("https://example.com/a"),batchTask("https://example.com/b",40501,0.002)]}));
  await assert.rejects(client.post("on_page/instant_pages",[],{ownerId:"owner",requestId:"run",onTask:async (_id,cost) => {charge=cost;}}), /vendor_status_40501/);
  assert.equal(charge,0.003 * Number(process.env.DATAFORSEO_USD_KRW ?? "1400"));
});
test("pre-execution HTTP rejection is final while timeout and server failures remain uncertain", async () => {
  for (const status of [400,401,403,404,413,422,429,408,500]) {
    const current=task();let calls=0;
    const client=new DataForSeoClient(async()=>{calls++;return new Response('{}',{status});});
    await executeTask(current,client);
    assert.equal(calls,1);
    assert.equal(state.status,[408,500].includes(status)?"uncertain":"failed",String(status));
    assert.equal(state.vendorTaskId,null);
  }
});
test("insufficient vendor balance (HTTP 402 + task 40200, cost 0) is a final uncharged rejection, not uncertain", async () => {
  const { PAYMENT_REQUIRED_MESSAGE, publicFailReason } = require("../messages.ts");
  // Real DataForSEO body observed 2026-11-09: HTTP 402, envelope 20000, task 40200 "Payment Required.", cost 0.
  const body = { status_code: 20000, cost: 0, tasks: [{ id: "t", status_code: 40200, cost: 0, result: null }] };
  for (const operation of ["onpage_instant", "labs_ranked", "serp_google"]) {
    const current = task(operation); let calls = 0;
    const client = new DataForSeoClient(async () => { calls++; return Response.json(body, { status: 402 }); });
    await executeTask(current, client);
    assert.equal(calls, 1, operation);
    assert.equal(state.status, "failed", operation);
    assert.equal(state.failReason, PAYMENT_REQUIRED_MESSAGE, operation);
    assert.equal(state.costKrw, 0, operation);
    assert.equal(publicFailReason(state.failReason, state.status), PAYMENT_REQUIRED_MESSAGE);
  }
});
test("task-level 40200 inside an HTTP 200 envelope maps to the same payment reason on post and task paths", async () => {
  const { DataForSeoError } = require("../../external/dataforseo.ts");
  const client = new DataForSeoClient(async () => Response.json(envelope(null, 40200, 0)));
  const ctx = { ownerId: "owner", requestId: "r" };
  for (const call of [() => client.post("on_page/instant_pages", [{}], ctx), () => client.task("serp/google/organic/task_post", [{}], ctx)]) {
    await assert.rejects(call(), (error) => error instanceof DataForSeoError && error.reason === "vendor_payment_required" && error.costKrw === 0);
  }
});
test("402 after a paid submission keeps the task collectable (submitted) instead of discarding the purchase", async () => {
  const body = { status_code: 20000, cost: 0, tasks: [{ id: "paid-task", status_code: 40200, cost: 0, result: null }] };
  const current = task("serp_google");
  current.vendorTaskId = state.vendorTaskId = "paid-task";
  state.costKrw = 12;
  const client = new DataForSeoClient(async () => Response.json(body, { status: 402 }));
  await executeTask(current, client);
  assert.equal(state.status, "submitted");
  assert.equal(state.costKrw, 12);
  const { PAYMENT_DELAYED_MESSAGE, publicFailReason } = require("../messages.ts");
  assert.equal(state.failReason, PAYMENT_DELAYED_MESSAGE);
  assert.equal(publicFailReason(state.failReason, state.status), PAYMENT_DELAYED_MESSAGE);
});
test("HTTP 200 envelope rejecting with 40200 but carrying a task id is final, not a collectable submission", async () => {
  const { PAYMENT_REQUIRED_MESSAGE } = require("../messages.ts");
  for (const operation of ["onpage_instant", "labs_ranked", "serp_google"]) {
    const current = task(operation);
    const client = new DataForSeoClient(async () => Response.json(envelope(null, 40200, 0)));
    await executeTask(current, client);
    assert.equal(state.status, "failed", operation);
    assert.equal(state.failReason, PAYMENT_REQUIRED_MESSAGE, operation);
    assert.equal(state.costKrw, 0, operation);
  }
});
test("balance exhausted while polling an accepted task_post keeps it collectable", async () => {
  const { PAYMENT_DELAYED_MESSAGE } = require("../messages.ts");
  const current = task("serp_google"); let n = 0;
  const client = new DataForSeoClient(async () => {
    n++;
    if (n === 1) return Response.json({ status_code: 20000, cost: 0.002, tasks: [{ id: "accepted", status_code: 20100, cost: 0.002, result: null }] });
    return Response.json({ status_code: 20000, cost: 0, tasks: [{ id: "accepted", status_code: 40200, cost: 0, result: null }] }, { status: 402 });
  });
  await executeTask(current, client);
  assert.equal(state.status, "submitted");
  assert.equal(state.failReason, PAYMENT_DELAYED_MESSAGE);
  assert.ok(state.costKrw > 0);
  assert.equal(state.vendorTaskId, "accepted");
});
test("audit response keeps the balance notice visible instead of a DTO-dropping 502", () => {
  const { auditResponse } = require("../http.ts");
  const { PAYMENT_REQUIRED_MESSAGE } = require("../messages.ts");
  const dto = (reasons) => ({ status: "failed", tasks: reasons.map((failReason) => ({ status: "failed", failReason })) });
  assert.equal(auditResponse(dto([PAYMENT_REQUIRED_MESSAGE, PAYMENT_REQUIRED_MESSAGE])).status, 200);
  assert.equal(auditResponse(dto([PAYMENT_REQUIRED_MESSAGE, "외부 수집에 실패했습니다."])).status, 200);
  assert.throws(() => auditResponse(dto(["외부 수집에 실패했습니다."])), (e) => e.status === 502);
});
