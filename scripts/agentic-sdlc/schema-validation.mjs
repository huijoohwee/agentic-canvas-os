import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";

const schema = JSON.parse(readFileSync(
  new URL(
    "../../docs/schemas/agentic-sdlc-run.v1.schema.json",
    import.meta.url,
  ),
  "utf8",
));
const validate = new Ajv2020({
  allErrors: true,
  strict: true,
}).compile(schema);

export function assertCanonicalRunSchema(artifact) {
  if (validate(artifact)) return artifact;
  const details = [...(validate.errors ?? [])]
    .map((error) =>
      `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .sort((left, right) => left.localeCompare(right, "en"))
    .join("; ");
  throw new TypeError(
    `agentic-sdlc-run/v1 schema validation failed: ${details || "unknown error"}`,
  );
}

export { schema as AGENTIC_SDLC_RUN_JSON_SCHEMA };
