import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const REQUIRED_DYNAMIC_VARS = Object.freeze([
  "OPENAI_FUNCTION_CALLING_MODEL",
  "OPENAI_FUNCTION_CALLING_INPUT_USD_PER_MILLION",
  "OPENAI_FUNCTION_CALLING_CACHED_INPUT_USD_PER_MILLION",
  "OPENAI_FUNCTION_CALLING_CACHE_WRITE_USD_PER_MILLION",
  "OPENAI_FUNCTION_CALLING_OUTPUT_USD_PER_MILLION",
]);

const STABLE_DEV_VARS = Object.freeze({
  KNOWGRPH_MCP_ENDPOINT: "https://knowgrph-mcp-dev.huijoohwee.workers.dev/knowgrph/control-plane/mcp",
  KNOWGRPH_FUNCTION_TOOL_ALLOWLIST: "update_agent_run_note",
  KNOWGRPH_FUNCTION_REVIEW_REQUIRED: "update_agent_run_note",
  OPENAI_FUNCTION_CALLING_ENDPOINT: "https://api.openai.com/v1/responses",
  OPENAI_FUNCTION_CALLING_API_KEY_ENV: "OPENAI_API_KEY",
  OPENAI_FUNCTION_CALLING_REASONING_EFFORT: "low",
  OPENAI_FUNCTION_CALLING_MAX_OUTPUT_TOKENS: "256",
  CANVAS_BASE_URL: "https://airvio.co/knowgrph",
});

function requiredValue(env, name) {
  const value = typeof env[name] === "string" ? env[name].trim() : "";
  if (!value) throw new Error(`${name} is required for the Dev function-gateway deployment.`);
  return value;
}

export function buildDevFunctionGatewayDeployArgs(env = {}) {
  const vars = { ...STABLE_DEV_VARS };
  for (const name of REQUIRED_DYNAMIC_VARS) vars[name] = requiredValue(env, name);
  const args = ["deploy", "--env", "dev"];
  for (const [name, value] of Object.entries(vars)) args.push("--var", `${name}:${value}`);
  return Object.freeze(args);
}

export function deployDevFunctionGateway(env = process.env) {
  const args = buildDevFunctionGatewayDeployArgs(env);
  const result = spawnSync("wrangler", args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`wrangler deploy --env dev exited with ${result.status ?? 1}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  deployDevFunctionGateway();
}

export const DEV_FUNCTION_GATEWAY_DEPLOYMENT = Object.freeze({
  environment: "dev",
  workerName: "agentic-canvas-os-dev",
  requiredDynamicVars: REQUIRED_DYNAMIC_VARS,
  requiredSecrets: Object.freeze([
    "AGENT_API_JWT_SECRET",
    "AGENT_REVIEW_JWT_SECRET",
    "OPENAI_API_KEY",
    "KNOWGRPH_MCP_FUNCTION_BEARER_TOKEN",
  ]),
});
