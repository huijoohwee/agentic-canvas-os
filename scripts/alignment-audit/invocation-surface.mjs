const OWNER = "alignment-audit-contract";

export const ALIGNMENT_AUDIT_INVOCATION_SURFACE = Object.freeze({
  capabilityId: "alignment-audit",
  owner: OWNER,
  command: Object.freeze({
    surface: "slash",
    token: "/alignment.audit",
    owner: OWNER,
  }),
  semantic: Object.freeze({
    surface: "hash",
    token: "#alignment-audit",
    owner: OWNER,
  }),
  binding: Object.freeze({
    surface: "at",
    token: "@alignment-audit",
    owner: OWNER,
  }),
  tool: Object.freeze({
    surface: "mcp",
    token: "alignment.audit",
    owner: OWNER,
  }),
});

export const ALIGNMENT_AUDIT_ROUTES = Object.freeze([
  ALIGNMENT_AUDIT_INVOCATION_SURFACE.command,
  ALIGNMENT_AUDIT_INVOCATION_SURFACE.semantic,
  ALIGNMENT_AUDIT_INVOCATION_SURFACE.binding,
  ALIGNMENT_AUDIT_INVOCATION_SURFACE.tool,
]);

export function describeAlignmentAuditInvocation() {
  return ALIGNMENT_AUDIT_INVOCATION_SURFACE;
}
