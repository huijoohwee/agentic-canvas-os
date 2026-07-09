// agentic-canvas-os Cloudflare frontend glue (browser ESM, zero-dependency).
//
// The ONLY network seam is the browser→Agent-API REST call (runtime only, never
// at build). The Agent-API forwards to knowgrph MCP; this page never holds a
// model key. After a run returns a Run_Manifest, the live knowgrph canvas is
// embedded via the run-scoped doc-view URL (canvas consumed over MCP, not
// rebuilt).

import { AGENT_API_BASE_URL, CANVAS_BASE_URL } from "./config.js";
import { buildCanvasEmbed } from "./canvas-embed.js";
import { resolveAgentApiBase, postJson } from "./agent-api-endpoints.js";

const AGENT_API_BASE = resolveAgentApiBase({ base: AGENT_API_BASE_URL });

function setStatus(text, tone) {
  const node = document.getElementById("status");
  node.textContent = text;
  if (tone) node.setAttribute("data-tone", tone);
  else node.removeAttribute("data-tone");
}

async function ensureSession() {
  const { status, body } = await postJson({
    doFetch: (url, init) => fetch(url, init),
    base: AGENT_API_BASE,
    path: "/api/auth/session",
    init: {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: "{}",
    },
  });
  if (status < 200 || status >= 300 || !body || typeof body.token !== "string") {
    throw new Error(`auth/session ${status}`);
  }
  return body.token;
}

async function postRun(token, submission, approvals) {
  const { status, body } = await postJson({
    doFetch: (url, init) => fetch(url, init),
    base: AGENT_API_BASE,
    path: "/api/run",
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...submission, approvals }),
    },
  });
  if (status < 200 || status >= 300) {
    const err = new Error(`run ${status}`);
    err.status = status;
    err.payload = body;
    throw err;
  }
  return body;
}

function renderSummary(manifest) {
  const host = document.getElementById("run-summary");
  const state = (manifest && manifest.state) || "unknown";
  const gates = Array.isArray(manifest && manifest.approvalGates) ? manifest.approvalGates.length : 0;
  host.replaceChildren();
  const h = document.createElement("h2");
  h.className = "card__title";
  h.textContent = "Run status";
  const p = document.createElement("p");
  p.innerHTML = `State: <strong>${state}</strong> · approval gates: ${gates}`;
  host.append(h, p);
  host.hidden = false;
}

function renderCanvas(manifest) {
  const host = document.getElementById("canvas-embed");
  host.replaceChildren();
  const h = document.createElement("h2");
  h.className = "card__title";
  h.textContent = "Canvas (live knowgrph)";
  host.append(h);

  const embed = buildCanvasEmbed(manifest, { canvasBaseUrl: CANVAS_BASE_URL });
  if (!embed.available) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = `Canvas unavailable — ${embed.reason}.`;
    host.append(p);
    host.hidden = false;
    return;
  }
  const iframe = document.createElement("iframe");
  iframe.className = "canvas-embed";
  iframe.src = embed.src;
  iframe.title = embed.title;
  iframe.setAttribute("sandbox", embed.sandbox);
  iframe.setAttribute("referrerpolicy", embed.referrerPolicy);
  iframe.setAttribute("loading", "lazy");
  const link = document.createElement("p");
  const a = document.createElement("a");
  a.href = embed.src;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = embed.src;
  link.append(document.createTextNode("Open in knowgrph: "), a);
  host.append(iframe, link);
  host.hidden = false;
}

function renderRun(manifest) {
  document.getElementById("run-output").hidden = false;
  renderSummary(manifest);
  renderCanvas(manifest);
}

async function onSubmit(event) {
  event.preventDefault();
  const btn = document.getElementById("submit-btn");
  const submission = {
    referenceUrl: String(document.getElementById("referenceUrl").value || "").trim(),
    brief: String(document.getElementById("brief").value || ""),
    budgetUsd: Number(document.getElementById("budgetUsd").value),
  };
  btn.disabled = true;
  setStatus("Submitting run…");
  try {
    const token = await ensureSession();
    // First submit with no approvals proves the gated, zero-spend halt (AC-1).
    const manifest = await postRun(token, submission, []);
    setStatus("Run initiated.", "ok");
    renderRun(manifest);
  } catch (err) {
    setStatus(`Run could not be initiated (${err.status || "error"}).`, "error");
  } finally {
    btn.disabled = false;
  }
}

function init() {
  const form = document.getElementById("run-form");
  if (form) form.addEventListener("submit", onSubmit);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
}

export { renderRun };
