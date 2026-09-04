import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const command = read("docs/DICTIONARY-COMMAND.md");
const semantic = read("docs/DICTIONARY-SEMANTIC.md");
const binding = read("docs/DICTIONARY-BINDING.md");
const facts = read("docs/FACTS.md");
const runtime = read("docs/IMPLEMENTATION-RUN-OBSERVATION.md");
const gateway = read("docs/MCP-GATEWAY.md");
const proof = read("docs/RUNTIME-PROOF.md");
const planning = read("todo/2026-07.md");
const retiredNamespace = ["k", "now", "grph"].join("");

const invocation = "/adlc.observe #adlc-observability @implementation-run @canvas @runtime-proof";
const tool = "agentic-graph.adlc.observe";

function count(source, expression) {
  return [...source.matchAll(new RegExp(expression, "gm"))].length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markdownList(values) {
  return `${values.slice(0, -1).map((item) => `\\\`${item}\\\``).join(", ")}, and \\\`${values.at(-1)}\\\``;
}

test("the exact slash, hash, and reused at bindings resolve canonically", () => {
  assert.equal(count(command, '^  - "/adlc\\.observe"$'), 1);
  assert.equal(count(command, "^\\| `/adlc\\.observe` \\| Project one immutable"), 1);
  assert.equal(count(semantic, '^  - "#adlc-observability"$'), 1);
  assert.equal(count(semantic, "^\\| `#adlc-observability` \\| Deterministic read-only projection"), 1);
  assert.equal(count(facts, '^  "/adlc\\.observe":'), 1);
  assert.equal(count(facts, '^  "#adlc-observability":'), 1);

  for (const token of ["@implementation-run", "@canvas", "@runtime-proof"]) {
    assert.equal(count(binding, `^  - "${escapeRegExp(token)}"$`), 1, `${token} must reuse one binding owner`);
    assert.equal(count(binding, "^\\| `" + escapeRegExp(token) + "`"), 1, `${token} must retain one binding row`);
  }

  for (const source of [runtime, gateway, semantic]) {
    assert.match(source, new RegExp(escapeRegExp(invocation)));
  }
});

test("one local wire tool is receipt-gated and has the exact request and result identities", () => {
  assert.equal(count(gateway, "^\\| `agentic-graph\\.adlc\\.observe`"), 1);
  assert.match(runtime, /`state\.result\.adlcLedger`/);
  assert.match(runtime, /schema: "adlc-ledger-receipt\/v1"/);
  for (const field of [
    "canonicalSchema",
    "artifact",
    "digest",
    "bytes",
    "canonicalRunId",
    "ledgerRevision",
    "acosRevision",
  ]) {
    assert.match(runtime, new RegExp(`^${field}:`, "m"), `receipt field ${field}`);
  }
  for (const field of [
    "invocation",
    "runId",
    "view",
    "expectedRevision",
    "expectedLedgerDigest",
    "cursor",
    "limit",
  ]) {
    assert.match(runtime, new RegExp("`" + field + "`"), `request field ${field}`);
  }
  assert.match(runtime, /`sha256:<64-lowercase-hex>`/);
  assert.match(runtime, /action `\/adlc\.observe`, semantic `#adlc-observability`, and bindings ordered as `@implementation-run`, `@canvas`, `@runtime-proof`/);
  assert.match(runtime, /`agentic-graph-adlc-observation\/v1` with `source`, `status`, `conformance`, `projection`, `cache`, and `economics`/);
  for (const source of [command, runtime, gateway]) {
    assert.doesNotMatch(source, new RegExp(`${retiredNamespace}-(?:agentic-sdlc|adlc)-observation\\/v1`));
  }
  assert.match(gateway, new RegExp(escapeRegExp(tool)));
});

test("the illustrative receipt has the exact native shape and typed YAML scalars", () => {
  const blocks = [...runtime.matchAll(/^```yaml\n([\s\S]*?)\n```$/gm)];
  assert.equal(blocks.length, 1);
  const entries = blocks[0][1].split("\n").map(line => {
    const match = /^([A-Za-z]+): (.+)$/.exec(line);
    assert.ok(match, `flat receipt scalar: ${line}`);
    return [match[1], JSON.parse(match[2])];
  });
  const receipt = Object.fromEntries(entries);
  assert.equal(entries.length, Object.keys(receipt).length, "no duplicate fields");
  assert.deepEqual(Object.keys(receipt).sort(), ["schema", "canonicalSchema", "artifact",
    "digest", "bytes", "canonicalRunId", "ledgerRevision", "acosRevision"].sort());
  assert.equal(receipt.schema, "adlc-ledger-receipt/v1");
  assert.equal(receipt.canonicalSchema, "adlc-run/v1");
  assert.match(receipt.artifact, /^[a-z0-9][a-z0-9._-]{0,119}$/);
  assert.match(receipt.digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(receipt.acosRevision, /^[0-9a-f]{40}$/);
  assert.ok(Number.isSafeInteger(receipt.bytes) && receipt.bytes >= 2);
  assert.ok(Number.isSafeInteger(receipt.ledgerRevision) && receipt.ledgerRevision >= 1);
  assert.equal(typeof receipt.canonicalRunId, "string");
  assert.ok(receipt.canonicalRunId.trim());
  assert.match(runtime, /syntax-only example uses zero hashes with no source or authority/);
});

test("native discovery and historical read compatibility keep separate identities", () => {
  for (const source of [command, semantic, binding, facts, gateway]) {
    assert.doesNotMatch(source, /\/sdlc\.observe|#agentic-sdlc-observability|agentic-graph\.agentic_sdlc\.observe/);
  }
  for (const identity of ["state.result.agenticSdlcLedger", "agentic-sdlc-ledger-receipt/v1",
    "agentic_sdlc.ledger_bound", "agentic-sdlc-run/v1", "source.receiptSchema", "source.canonicalSchema"]) {
    assert.ok(runtime.includes(identity), `explicit provenance: ${identity}`);
  }
  assert.match(runtime, /Dual fields, mixed\s+receipt\/event identities, duplicate binding revisions/);
  assert.match(runtime, /Historical bytes and receipts are never rewritten/);
  assert.match(runtime, /Former tool and invocation aliases are not advertised or dispatched/);
  assert.match(runtime, /no native canonical-run evaluator for `adlc-run\/v1`/);
  assert.match(runtime, /nonretryable\s+`adlc_evaluator_unavailable` before artifact binding or projection/);
  assert.match(runtime, /no conformance claim/);
});

test("the Canvas projection vocabulary, views, ordering, and existing owners are closed", () => {
  const nodes = [
    "run",
    "criterion",
    "vcc",
    "task",
    "transition",
    "dispatch",
    "return",
    "check",
    "evidence",
    "finding",
    "budget",
    "receipt",
    "gate",
    "checkpoint",
  ];
  const edges = [
    "defines",
    "covers",
    "dependsOn",
    "transitionsTo",
    "dispatchedAs",
    "returnedAs",
    "verifiedBy",
    "evidencedBy",
    "consumes",
    "gatedBy",
    "persistedAs",
  ];
  const views = ["overview", "plan", "execution", "evidence", "economics", "recovery", "receipts", "full"];

  assert.match(runtime, new RegExp(`complete node vocabulary is ${markdownList(nodes)}`));
  assert.match(runtime, new RegExp(`complete edge vocabulary is ${markdownList(edges)}`));
  assert.match(runtime, new RegExp(`bounded views are ${markdownList(views)}`));
  assert.match(runtime, /Nodes order by type rank then id; edges order by relation rank, source, target, then id/);
  assert.match(runtime, /`properties\.stub=true`/);
  assert.match(runtime, /`adlc-canvas-projection\/v1`/);
  assert.match(runtime, /`kgSchema: "kgc-computing-flow\/v1"`/);
  for (const source of [runtime, gateway]) {
    assert.match(source, /existing (?:KGC, GraphData, and )?Canvas owners|existing Canvas owner/);
  }
  assert.match(runtime, /not an Evaluator, runner, release controller, graph store, dashboard, or renderer/);
  assert.match(gateway, /creates no verdict, delivery state, authorization, deployment, store, dashboard, renderer/);
});

test("verified, delivery_ready, and deployed remain distinct non-promoting claims", () => {
  for (const state of ["verified", "delivery_ready", "deployed"]) {
    assert.match(runtime, new RegExp("`" + state + "`"));
    assert.match(gateway, new RegExp("`" + state + "`"));
  }
  assert.match(runtime, /Only the named Evaluator may set `verified`/);
  assert.match(runtime, /never translate it into `verified`, merged, accepted, or deployed/);
  assert.match(runtime, /observation creates no authorization, deployment attempt, or publication evidence/);
  assert.match(facts, /retains only the read-only, non-promoting .* projection[\s\S]*grants no lifecycle authority/);
});

test("economics and deployment boundaries stay exact and the planning row is complete", () => {
  assert.match(runtime, /^status: "spec-complete"$/m);
  assert.doesNotMatch(runtime, /^status: "runtime-ready"$/m);
  assert.match(runtime, /exact zeros for network calls, model calls,\s+prompt tokens, completion tokens, and estimated cost/);
  assert.match(runtime, /It is spec-complete, not\s+runtime-ready/u);
  assert.match(runtime, /does not claim current-guideline, protected agentic-graph,\s+cross-device, Prod, or Cloudflare runtime parity/u);
  assert.match(proof, /Spec-complete for ACOS contract/);
  assert.match(proof, /Current-guideline evaluator parity, protected agentic-graph integration, live rendering, Prod, and Cloudflare remain unclaimed/);

  const context = "Agentic SDLC end-to-end observability catalog 2026-07-29";
  assert.equal(count(planning, `^\\| ${escapeRegExp(context)} \\|`), 1);
  const row = planning.split("\n").find((line) => line.startsWith(`| ${context} |`));
  assert.ok(row);
  assert.equal(row.split("|").length, 13, "planning row must contain exactly 11 cells");
  assert.match(row, /\| 2026-07-29 \|$/);
});

test("all touched authored documents remain below the repository line cap", () => {
  for (const [name, source] of Object.entries({
    "DICTIONARY-COMMAND.md": command,
    "DICTIONARY-SEMANTIC.md": semantic,
    "FACTS.md": facts,
    "IMPLEMENTATION-RUN-OBSERVATION.md": runtime,
    "MCP-GATEWAY.md": gateway,
    "RUNTIME-PROOF.md": proof,
    "todo/2026-07.md": planning,
  })) {
    assert.ok(source.split("\n").length - 1 < 600, `${name} must stay below 600 lines`);
  }
});
