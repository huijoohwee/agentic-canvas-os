import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";

import { compareText } from "./normalize.mjs";

const evidenceSchema = JSON.parse(readFileSync(
  new URL(
    "../../docs/schemas/agentic-sdlc-admission-evidence.v1.schema.json",
    import.meta.url,
  ),
  "utf8",
));
const receiptSchema = JSON.parse(readFileSync(
  new URL(
    "../../docs/schemas/agentic-sdlc-admission-stage-receipt.v1.schema.json",
    import.meta.url,
  ),
  "utf8",
));

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
ajv.addFormat("date-time", {
  type: "string",
  validate: (value) => (
    typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
  ),
});

const validateEvidence = ajv.compile(evidenceSchema);
const validateReceipt = ajv.compile(receiptSchema);

export function inspectAdmissionEvidenceSchema(artifact) {
  return inspect(validateEvidence, artifact);
}

export function assertAdmissionStageReceiptSchema(receipt) {
  const result = inspect(validateReceipt, receipt);
  if (result.valid) return receipt;
  throw new TypeError(
    `agentic-sdlc-admission-stage-receipt/v1 schema validation failed: ${
      result.errors.join("; ") || "unknown error"
    }`,
  );
}

function inspect(validate, artifact) {
  const valid = validate(artifact);
  const errors = [...(validate.errors ?? [])]
    .map((error) =>
      `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .sort(compareText);
  return Object.freeze({ valid, errors: Object.freeze(errors) });
}

export {
  evidenceSchema as AGENTIC_SDLC_ADMISSION_EVIDENCE_JSON_SCHEMA,
  receiptSchema as AGENTIC_SDLC_ADMISSION_STAGE_RECEIPT_JSON_SCHEMA,
};
