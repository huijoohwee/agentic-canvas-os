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
const retiredNamespace = ["k", "now", "grph"].join("");

test("current positive invocation grammar uses the agentic-graph namespace", () => {
  for (const token of [
    "agentic-graph.agentic_canvas_os.docs.invoke",
    "agentic-graph.video_remix.run",
    "agentic-graph.application.*",
    "agentic-graph.agentic_sdlc.observe",
  ]) {
    assert.match(currentCatalog, new RegExp(token.replaceAll(".", "\\.").replaceAll("*", "\\*")));
  }

  assert.doesNotMatch(
    currentCatalog,
    new RegExp(`\\b${retiredNamespace}\\.(?:agentic_canvas_os|video_remix|application|agentic_sdlc)(?:\\.|\\b)`),
  );
});

test("public product labels retain agentic-graph while the runtime route uses Agentic OS", () => {
  const readme = read("README.md");
  assert.match(readme, /agentic-graph control plane/);
  assert.match(readme, /airvio\.co\/agentic-os\/control-plane\/mcp/);
  assert.doesNotMatch(readme, new RegExp(`\\b${retiredNamespace} control plane\\b|\\b${retiredNamespace} canvas\\b`));
});
