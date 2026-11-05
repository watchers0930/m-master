import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: currentDirectory,
  },
  // GA4 SDK must not be bundled: bundling breaks google-gax's proto3 JSON serializer (int64 `limit` → "toProto3JSON: don't know how to convert value").
  serverExternalPackages: ['mammoth', '@google-analytics/data', 'google-gax'],
};

export default nextConfig;
