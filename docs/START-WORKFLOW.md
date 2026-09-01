---
title: "Start Workflow"
graphId: "md:acos-adlc-start-workflow"
doc_type: "Workflow Contract"
date: "2026-09-01"
lang: "en-US"
schema: "acos-adlc-start-workflow/v1"
frontmatter_contract: "required"
status: "draft"
owner: "ADLC harness"
delivered_rung: "undocumented"
---
<!-- Responsibility: Start one ACOS change in a guarded ADLC lane without disturbing existing work. -->

# Start Workflow

Read `CANONICAL-LIFECYCLE.md` and repository instructions before mutation.

## Preflight

Preflight is one pass. Report every missing, malformed, or unresolvable input
together and derive every machine-derivable operand. Validate locally knowable
constraints before publication. Bind volatile refs and provider identity
immediately before the transition that consumes them.

Classify a rejection as contended or deterministic. Re-read and retry a
contended value within the declared bound; never retry a deterministic request
unchanged. Correct wrong values at their owning source, not in a cache, marker,
report, or compatibility projection. Escalate only a semantic decision,
irreversible effect, credential grant, authority change, or unresolved
contradiction.

Attempt an environment-only bootstrap once before calling a missing dependency a
product failure. Cap shared-state repair at one attempt, state its reversal in
advance, and preserve exact residue if it does not converge.

## Start

From the canonical checkout:

```sh
git fetch origin main
npm run doctor
npm run status
npm run lane -- <lowercase-scope>
```

The last command prints the exact task worktree. Enter it, make only the scoped
change, and commit. Existing dirty bytes in any other checkout remain untouched.
Do not author on `main`, adopt another lane, activate one branch in two
worktrees, or manufacture readiness by hiding changes.

Before publication run the checks appropriate to the change, including:

```sh
npm test
npm run web:build
npm run docs:check
npm run authored-line-budget:check
```

Continue with `RELEASE-WORKFLOW.md`.
