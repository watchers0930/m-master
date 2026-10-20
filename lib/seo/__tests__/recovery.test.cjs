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
