export const OUT_OF_SCOPE_DEPLOYMENT_RECORD =
  "Production-surface and edge-surface mutation is outside the scope of an Audit_Run.";

const MUTATION_PATTERN =
  /\b(?:deploy|promot|publish|release|roll(?:back|out)|write|mutat|creat|updat|delet|remov|provision|apply|upload|ship|push|route|shift)\w*\b/iu;
const PROTECTED_SURFACE_PATTERN =
  /\b(?:production|prod|edge|public|cloudflare|production mirror)\b/iu;

export function deriveDeployBoundaryState(operatorInstruction) {
  return normalizeOperatorInstruction(operatorInstruction) === null ? "closed" : "open";
}

export function isProductionOrEdgeMutation(statement) {
  const text = String(statement ?? "");
  return MUTATION_PATTERN.test(text) && PROTECTED_SURFACE_PATTERN.test(text);
}

export function collectDeployMutationMatches(statement) {
  return [...String(statement ?? "").matchAll(
    new RegExp(MUTATION_PATTERN.source, "giu"),
  )];
}

export function gateRemediation(remediation, operatorInstructionRef = null) {
  if (!remediation || typeof remediation !== "object") {
    throw new TypeError("gateRemediation expects a remediation object");
  }

  const instruction = normalizeOperatorInstruction(operatorInstructionRef);
  const statement = populated(remediation.statement, "remediation statement");
  const protectedMutation =
    remediation.state === "deploy-gated" ||
    remediation.state === "operator-approved" ||
    isProductionOrEdgeMutation(statement);

  let state = remediation.state ?? "proposed";
  if (protectedMutation) state = instruction === null ? "deploy-gated" : "operator-approved";

  return Object.freeze({
    ...remediation,
    statement,
    state,
    operatorInstructionRef: protectedMutation ? instruction : null,
  });
}

export const applyDeployGate = gateRemediation;

export function normalizeOperatorInstruction(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    for (const key of [
      "ref",
      "reference",
      "id",
      "instructionRef",
      "operatorInstructionRef",
    ]) {
      if (typeof value[key] === "string" && value[key].trim().length > 0) {
        return value[key].trim();
      }
    }
  }
  return null;
}

function populated(value, label) {
  const text = String(value ?? "").trim();
  if (text.length === 0) throw new TypeError(`${label} must be non-empty`);
  return text;
}
