/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness. */
/* global require, exports, Response, crypto, global */
exports.installVendorTransport = function () {
  function vendor(items) {
    return {
      status_code: 20000,
      cost: 0.001,
      tasks: [
        {
          id: crypto.randomUUID(),
          status_code: 20000,
          cost: 0.001,
          result: [{ items }],
        },
      ],
    };
  }
  const fetchCalls = [];
  let paidCalls = 0;
  // The transport is stubbed for every external operation. DNS is also stubbed to a known public host.
  const dns = require("node:dns/promises");
  dns.lookup = async () => [{ address: "8.8.8.8", family: 4 }];
  global.fetch = async (address, options) => {
    fetchCalls.push({ address, options });
    if (address.endsWith("/instant_pages")) {
      paidCalls++;
      return Response.json(
        vendor([
          {
            url: "https://example.com/",
            status_code: 200,
            meta: {
              title: "Example title",
              description: "A".repeat(60),
              htags: { h1: ["Example"] },
            },
            checks: { no_image_alt: false },
          },
        ]),
      );
    }
    if (address.endsWith("/ranked_keywords/live")) {
      paidCalls++;
      return Response.json(
        vendor([
          {
            keyword_data: {
              keyword: "seo",
              keyword_info: { search_volume: 100 },
              serp_info: { last_updated_time: "2026-10-01 00:00:00 +00:00" },
            },
            ranked_serp_element: {
              serp_item: {
                type: "organic",
                url: "https://example.com/",
                rank_group: 8,
                rank_absolute: 10,
              },
            },
          },
        ]),
      );
    }
    if (address.endsWith("/keywords_for_site/live")) {
      paidCalls++;
      return Response.json({
        status_code: 20000,
        cost: 0.001,
        tasks: [
          {
            id: crypto.randomUUID(),
            status_code: 20000,
            cost: 0.001,
            result: [
              {
                keyword: "seo",
                search_volume: 100,
                competition: "MEDIUM",
                competition_index: 50,
                monthly_searches: [
                  { year: 2026, month: 9, search_volume: 100 },
                ],
              },
            ],
          },
        ],
      });
    }
    if (address.endsWith("/task_post")) {
      paidCalls++;
      return Response.json({
        status_code: 20000,
        cost: 0.001,
        tasks: [
          {
            id: crypto.randomUUID(),
            status_code: 20100,
            cost: 0.001,
            result: null,
          },
        ],
      });
    }
    if (address.includes("/task_get/advanced/"))
      return Response.json(
        vendor([
          {
            type: "organic",
            url: "https://example.com/",
            rank_group: 15,
            rank_absolute: 20,
          },
        ]),
      );
    throw new Error("Unexpected external call: " + address);
  };

  return {
    get paidCalls() {
      return paidCalls;
    },
    fetchCalls,
  };
};
