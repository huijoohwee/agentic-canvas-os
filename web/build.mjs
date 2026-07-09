// Offline, zero-dependency static build for the agentic-canvas-os Cloudflare
// frontend. Assembles `web/dist` from Node built-ins only — nothing to
// transpile or bundle, so `npm install` and `npm run web:build` both work
// OFFLINE with zero network or Cloudflare calls.
//
// It (1) copies the static shell, (2) copies the browser-safe `src/canvas-embed.js`
// into the bundle, and (3) GENERATES `dist/config.js` from PUBLIC build-time env
// vars (Cloudflare Agent-API base + knowgrph canvas base) so no route is
// hardcoded into the shipped bundle. SECRET SAFETY: only public URLs are emitted
// — never a model key or auth signing secret.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const WEB = path.join(REPO, "web");
const SRC = path.join(REPO, "src");
const DIST = path.join(WEB, "dist");

const SHELL_FILES = ["index.html", "main.js", "styles.css"];

const AGENT_API_ENV = ["AGENT_API_URL", "PUBLIC_AGENT_API_URL", "CLOUDFLARE_AGENT_API_URL"];
const CANVAS_BASE_ENV = ["CANVAS_BASE_URL", "NEXT_PUBLIC_CANVAS_BASE_URL", "PUBLIC_CANVAS_BASE_URL"];

function readEnv(names) {
  for (const name of names) {
    const v = process.env[name];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function assertPublicUrl(value, label) {
  if (value === "") return "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute http(s) URL, got: ${value}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must use http/https, got: ${value}`);
  }
  return value;
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function main() {
  const agentApiUrl = assertPublicUrl(readEnv(AGENT_API_ENV), "Agent-API base URL");
  const canvasBaseUrl = assertPublicUrl(readEnv(CANVAS_BASE_ENV), "Canvas base URL") || "https://airvio.co/knowgrph";

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  for (const file of SHELL_FILES) copyFile(path.join(WEB, file), path.join(DIST, file));
  copyFile(path.join(SRC, "canvas-embed.js"), path.join(DIST, "canvas-embed.js"));
  copyFile(path.join(SRC, "agent-api-endpoints.js"), path.join(DIST, "agent-api-endpoints.js"));

  const config =
    `// GENERATED at build time by web/build.mjs — do not edit.\n` +
    `// PUBLIC deployment values only: never a model key or auth secret.\n` +
    `export const AGENT_API_BASE_URL = ${JSON.stringify(agentApiUrl)};\n` +
    `export const CANVAS_BASE_URL = ${JSON.stringify(canvasBaseUrl)};\n`;
  fs.writeFileSync(path.join(DIST, "config.js"), config, "utf8");

  process.stdout.write(
    `agentic-canvas-os web build → ${path.relative(REPO, DIST)}\n` +
      `  Agent-API base URL (Cloudflare):      ${agentApiUrl || "(same Worker origin — none set)"}\n` +
      `  Canvas base URL:                      ${canvasBaseUrl}\n` +
      `  artifacts: ${[...SHELL_FILES, "canvas-embed.js", "agent-api-endpoints.js", "config.js"].join(", ")}\n`,
  );
}

main();
