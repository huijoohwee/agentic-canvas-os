// Tests for the run-scoped knowgrph canvas embed (agentic-canvas-os product
// tier). Mirrors the knowgrph SSOT scheme. ZERO network / ZERO browser.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCanvasEmbed,
  resolveCanvasDocViewUrl,
  storyboardCanvasAvailable,
  CANVAS_EMBED_SANDBOX,
  CANVAS_EMBED_REFERRER_POLICY,
} from "../src/canvas-embed.js";

const BASE = "https://airvio.co/knowgrph";

function ready(overrides = {}) {
  return { runId: "run-1", stages: [{ id: "storyboard", status: "complete" }], ...overrides };
}

test("resolveCanvasDocViewUrl builds a run-scoped doc-view url", () => {
  assert.equal(resolveCanvasDocViewUrl({ baseUrl: BASE, runId: "r" }), `${BASE}/doc-view?run=r`);
});

test("resolveCanvasDocViewUrl appends the optional doc id", () => {
  assert.equal(
    resolveCanvasDocViewUrl({ baseUrl: BASE, runId: "r", docId: "md:sb" }),
    `${BASE}/doc-view?run=r&doc=md%3Asb`,
  );
});

test("resolveCanvasDocViewUrl returns '' without base or runId", () => {
  assert.equal(resolveCanvasDocViewUrl({ runId: "r" }), "");
  assert.equal(resolveCanvasDocViewUrl({ baseUrl: BASE }), "");
});

test("storyboardCanvasAvailable detects ready status and shot nodes", () => {
  assert.equal(storyboardCanvasAvailable(ready()), true);
  assert.equal(storyboardCanvasAvailable({ kgcDocument: { flow: { nodes: [{ id: "s1" }] } } }), true);
  assert.equal(storyboardCanvasAvailable({ stages: [{ id: "research", status: "complete" }] }), false);
});

test("buildCanvasEmbed is available with base + runId + ready storyboard", () => {
  const embed = buildCanvasEmbed(ready(), { canvasBaseUrl: BASE });
  assert.equal(embed.available, true);
  assert.equal(embed.src, `${BASE}/doc-view?run=run-1`);
  assert.equal(embed.sandbox, CANVAS_EMBED_SANDBOX);
  assert.equal(embed.referrerPolicy, CANVAS_EMBED_REFERRER_POLICY);
});

test("buildCanvasEmbed pins the storyboard doc id when present", () => {
  const embed = buildCanvasEmbed(ready({ kgcDocument: { graphId: "md:sb", flow: { nodes: [{ id: "s1" }] } } }), {
    canvasBaseUrl: BASE,
  });
  assert.equal(embed.docId, "md:sb");
  assert.match(embed.src, /doc=md%3Asb/);
});

test("buildCanvasEmbed resolves a nested manifest envelope", () => {
  const embed = buildCanvasEmbed({ runManifest: ready() }, { canvasBaseUrl: BASE });
  assert.equal(embed.available, true);
  assert.match(embed.src, /run=run-1/);
});

test("buildCanvasEmbed is unavailable with a clear reason in each gap", () => {
  assert.match(buildCanvasEmbed(ready(), { canvasBaseUrl: "" }).reason, /not configured/);
  assert.match(buildCanvasEmbed({ stages: [{ id: "storyboard", status: "complete" }] }, { canvasBaseUrl: BASE }).reason, /run id/);
  assert.match(buildCanvasEmbed({ runId: "r", stages: [{ id: "research", status: "complete" }] }, { canvasBaseUrl: BASE }).reason, /storyboard/);
});

test("buildCanvasEmbed never throws on malformed input", () => {
  for (const bad of [null, undefined, 5, "x", [], true, NaN]) {
    const embed = buildCanvasEmbed(bad, { canvasBaseUrl: BASE });
    assert.equal(embed.available, false);
    assert.equal(embed.src, "");
  }
});
