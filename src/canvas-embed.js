// Run-scoped knowgrph canvas embed for the agentic-canvas-os product tier.
//
// The knowgrph Storyboard_Harness emits a Kgc_Document (`kgc-computing-flow/v1`,
// one node per planned shot). This product tier EMBEDS the live knowgrph canvas
// doc-view scoped to the run rather than reimplementing the renderer — knowgrph
// owns the canvas engine, agentic-canvas-os is the shell around it.
//
// SCHEME MIRROR: the doc-view URL scheme + embed security attributes mirror the
// knowgrph SSOT (`knowgrph/mcp/video-remix/canvas-embed.js`):
//   `${base}/doc-view?run=<runId>[&doc=<docId>]`
// Keep this in step with that source. PURE: no I/O, no model/provider calls.

export const CANVAS_DOC_VIEW_PATH = "/doc-view";
export const CANVAS_RUN_PARAM = "run";
export const CANVAS_DOC_PARAM = "doc";

// Cross-origin embed attributes (Vercel frames airvio.co/knowgrph). The doc-view
// route must allow `frame-ancestors` of the Vercel origin AND scope the run to
// the entitled caller (same check as knowgrph GET /runs/{id}); the embed never
// authorizes spend.
export const CANVAS_EMBED_SANDBOX = "allow-scripts allow-same-origin";
export const CANVAS_EMBED_REFERRER_POLICY = "no-referrer";

const STORYBOARD_READY_STATUSES = Object.freeze(["complete", "completed", "fallback"]);

function toText(value, fallback = "") {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return fallback;
}

function normalizeBaseUrl(baseUrl) {
  const base = toText(baseUrl);
  return base ? base.replace(/\/+$/, "") : "";
}

function resolveManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  for (const key of ["runManifest", "manifest"]) {
    const nested = input[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;
  }
  return input;
}

function resolveStoryboardStage(manifest) {
  const stages = Array.isArray(manifest.stages) ? manifest.stages : [];
  for (const stage of stages) {
    if (stage && typeof stage === "object" && stage.id === "storyboard") return stage;
  }
  return null;
}

function storyboardNodeCount(manifest) {
  const stage = resolveStoryboardStage(manifest);
  const carriers = [manifest.kgcDocument, manifest.storyboard, stage && stage.artifact];
  for (const carrier of carriers) {
    const flow = carrier && typeof carrier === "object" ? carrier.flow : null;
    if (flow && Array.isArray(flow.nodes) && flow.nodes.length > 0) return flow.nodes.length;
  }
  return 0;
}

/** True iff the storyboard produced a canvas ready to embed for this run. */
export function storyboardCanvasAvailable(manifest) {
  const resolved = resolveManifest(manifest);
  const stage = resolveStoryboardStage(resolved);
  const statusReady =
    stage && typeof stage.status === "string" && STORYBOARD_READY_STATUSES.includes(stage.status);
  return Boolean(statusReady) || storyboardNodeCount(resolved) > 0;
}

function resolveDocId(manifest) {
  const stage = resolveStoryboardStage(manifest);
  const carriers = [manifest.kgcDocument, manifest.storyboard, stage && stage.artifact];
  for (const carrier of carriers) {
    if (carrier && typeof carrier === "object") {
      const id = toText(carrier.graphId || carrier.docId || carrier.id);
      if (id) return id;
    }
  }
  return "";
}

/**
 * Build the run-scoped canvas doc-view URL. Returns "" without a base or runId.
 * @param {{ baseUrl?: string, runId: string, docId?: string }} args
 */
export function resolveCanvasDocViewUrl({ baseUrl, runId, docId } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const run = toText(runId);
  if (!base || !run) return "";
  const params = new URLSearchParams();
  params.set(CANVAS_RUN_PARAM, run);
  const doc = toText(docId);
  if (doc) params.set(CANVAS_DOC_PARAM, doc);
  return `${base}${CANVAS_DOC_VIEW_PATH}?${params.toString()}`;
}

/**
 * Build the embedded-canvas descriptor from a knowgrph Run_Manifest + the
 * configured canvas base. `available` is true only when a base + runId are
 * present and the storyboard produced a Kgc_Document. Pure; never throws.
 *
 * @param {unknown} manifest Run_Manifest (or manifest-bearing envelope)
 * @param {{ canvasBaseUrl?: string, runId?: string }} [opts]
 */
export function buildCanvasEmbed(manifest, opts = {}) {
  const resolved = resolveManifest(manifest);
  const runId = toText(opts.runId) || toText(resolved.runId);
  const baseUrl = normalizeBaseUrl(opts.canvasBaseUrl);

  const base = {
    available: false,
    src: "",
    runId,
    docId: "",
    sandbox: CANVAS_EMBED_SANDBOX,
    referrerPolicy: CANVAS_EMBED_REFERRER_POLICY,
    title: "knowgrph canvas",
    reason: "",
  };

  if (!baseUrl) return { ...base, reason: "canvas base URL not configured" };
  if (!runId) return { ...base, reason: "run id not available" };
  if (!storyboardCanvasAvailable(resolved)) return { ...base, reason: "storyboard canvas not ready" };

  const docId = resolveDocId(resolved);
  const src = resolveCanvasDocViewUrl({ baseUrl, runId, docId });
  if (!src) return { ...base, reason: "canvas URL could not be resolved" };

  return { ...base, available: true, src, docId, title: `knowgrph canvas — run ${runId}` };
}
