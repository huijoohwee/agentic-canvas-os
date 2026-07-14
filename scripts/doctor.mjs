#!/usr/bin/env node

import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const checks = [
  {
    label: "Node.js >= 20",
    run: () => {
      const major = Number.parseInt(process.versions.node.split(".")[0], 10);
      if (Number.isNaN(major) || major < 20) {
        return fail(`found ${process.versions.node}`);
      }
      return ok(process.versions.node);
    }
  },
  {
    label: "npm available",
    run: () => commandVersion("npm", ["--version"])
  },
  {
    label: "Wrangler available",
    run: () => commandVersion("npx", ["wrangler", "--version"])
  },
  {
    label: "Workflow docs present",
    run: async () => {
      const required = [
        "docs/START-WORKFLOW.md",
        "docs/VALIDATION-RUNBOOK.md",
        "docs/RUNTIME-READINESS.md"
      ];
      for (const path of required) {
        await access(path, constants.R_OK);
      }
      return ok("docs ready");
    }
  },
  {
    label: "Local secrets configured for wrangler dev",
    run: async () => {
      const requiredSecrets = await readRequiredSecrets();
      if (requiredSecrets.length === 0) {
        return warn("no required secrets declared");
      }

      const localSecrets = await readLocalSecrets();
      const missing = requiredSecrets.filter((secretName) => !localSecrets.has(secretName));
      if (missing.length > 0) {
        return warn(`missing ${missing.join(", ")}; add them to .dev.vars, .env, or local shell env`);
      }
      return ok(requiredSecrets.join(", "));
    }
  }
];

async function main() {
  console.log("agentic-canvas-os doctor");
  console.log("");

  let hasFailure = false;

  for (const check of checks) {
    const result = await check.run();
    const prefix = result.level || (result.ok ? "PASS" : "FAIL");
    console.log(`${prefix}  ${check.label}${result.detail ? ` (${result.detail})` : ""}`);
    if (!result.ok) {
      hasFailure = true;
    }
  }

  console.log("");
  console.log("Next steps:");
  console.log("1. Read docs/START-WORKFLOW.md before changing workflow or control-surface files.");
  console.log("2. Run npm run check for focused validation.");
  console.log("3. Run npm run dev to start the local Cloudflare Worker.");
  console.log("4. Verify runtime readiness with curl http://127.0.0.1:8787/api/ready.");

  if (hasFailure) {
    process.exitCode = 1;
  }
}

async function readRequiredSecrets() {
  const text = await readFile("wrangler.jsonc", "utf8");
  const config = JSON.parse(stripJsonComments(text));
  const secrets = config?.secrets?.required;
  return Array.isArray(secrets) ? secrets.filter((value) => typeof value === "string" && value.length > 0) : [];
}

function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    output += char;
  }
  return output;
}

async function readLocalSecrets() {
  const names = new Set();
  const localFiles = [".dev.vars", ".env", ".env.local", ".dev.vars.local"];

  for (const path of localFiles) {
    try {
      const text = await readFile(path, "utf8");
      for (const name of extractEnvNames(text)) {
        names.add(name);
      }
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value === "string" && value.length > 0) {
      names.add(name);
    }
  }

  return names;
}

function extractEnvNames(text) {
  const names = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const name = normalized.slice(0, separatorIndex).trim();
    if (/^[A-Z0-9_]+$/.test(name)) {
      names.push(name);
    }
  }
  return names;
}

function commandVersion(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join(" ").trim() || "not available";
    return fail(detail);
  }
  return ok(result.stdout.trim());
}

function ok(detail = "") {
  return { ok: true, level: "PASS", detail };
}

function warn(detail = "") {
  return { ok: true, level: "WARN", detail };
}

function fail(detail = "") {
  return { ok: false, level: "FAIL", detail };
}

await main();
