const ROUTE_FIELDS = Object.freeze([
  "predictableControlFlow",
  "compactStructuredReduction",
  "requiresSemanticJudgment",
  "requiresApproval",
  "performsMutation",
  "requiresCitationPreservation",
  "requiresNativeArtifactValidation",
]);

function direct(reasonCode, message) {
  return Object.freeze({ route: "direct", reasonCode, message });
}

export function selectProgrammaticToolRoute({ toolCallCount, ...shape } = {}) {
  if (!Number.isInteger(toolCallCount) || toolCallCount < 0) {
    throw new TypeError("toolCallCount must be a non-negative integer.");
  }
  for (const field of ROUTE_FIELDS) {
    if (typeof shape[field] !== "boolean") throw new TypeError(`${field} must be boolean.`);
  }

  if (shape.performsMutation || shape.requiresApproval) {
    return direct("authorization_boundary", "Writes and approval-sensitive work use direct tool calls.");
  }
  if (shape.requiresCitationPreservation || shape.requiresNativeArtifactValidation) {
    return direct("native_evidence_required", "Citation and native-artifact validation stays on the direct path.");
  }
  if (shape.requiresSemanticJudgment) {
    return direct("semantic_judgment_required", "Adaptive semantic judgment stays on the direct path.");
  }
  if (toolCallCount <= 1) {
    return direct("single_call_sufficient", "A single lookup or action does not need a hosted program.");
  }
  if (!shape.predictableControlFlow) {
    return direct("control_flow_unpredictable", "Programmatic execution requires predictable control flow.");
  }
  if (!shape.compactStructuredReduction) {
    return direct("reduction_unproven", "Programmatic execution requires a smaller structured result.");
  }
  return Object.freeze({
    route: "programmatic",
    reasonCode: "predictable_structured_reduction",
    message: "Several bounded tool results can be reduced in a hosted program.",
  });
}
