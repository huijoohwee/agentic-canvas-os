import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PRESERVED_ROUTE_SET } from "../scripts/runtime-route-contract.mjs";

export function matchesWorkerFirst(pattern, route) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, ".*");
  return new RegExp(`^${escaped}$`, "u").test(route);
}

test("run_worker_first patterns cover API routes and not root", async () => {
  const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const patterns = [...wrangler.matchAll(/"(\/[^"\n]*\*)"/gu)].map(match => match[1]);
  assert.ok(patterns.includes("/api/*"));
  for (const { path } of PRESERVED_ROUTE_SET.filter(item => item.path.startsWith("/api/"))) assert.ok(patterns.some(pattern => matchesWorkerFirst(pattern, path)));
  assert.ok(patterns.every(pattern => !matchesWorkerFirst(pattern, "/")));
});
