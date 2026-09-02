import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const currentCatalog = [
  read("README.md"),
  read("docs/IMPLEMENTATION-RUN-OBSERVATION.md"),
  read("docs/DICTIONARY-COMMAND.md"),
  read("docs/MCP-GATEWAY.md"),
].join("\n");

test("current positive invocation grammar uses the AgenticGraph namespace", () => {
  for (const token of [
    "agenticgraph.agentic_canvas_os.docs.invoke",
    "agenticgraph.video_remix.run",
    "agenticgraph.application.*",
    "agenticgraph.agentic_sdlc.observe",
  ]) {
    assert.match(currentCatalog, new RegExp(token.replaceAll(".", "\\.").replaceAll("*", "\\*")));
  }

  assert.doesNotMatch(
    currentCatalog,
    /\bknowgrph\.(?:agentic_canvas_os|video_remix|application|agentic_sdlc)(?:\.|\b)/,
  );
});

test("public product labels use AgenticGraph while the explicit production route stays stable", () => {
  const readme = read("README.md");
  assert.match(readme, /AgenticGraph control plane/);
  assert.match(readme, /airvio\.co\/knowgrph\/control-plane\/mcp/);
  assert.doesNotMatch(readme, /\bknowgrph control plane\b|\bknowgrph canvas\b/);
});
