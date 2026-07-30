---
title: "Portable Alignment Guideline"
graphId: "fixture:portable-alignment-guideline"
doc_type: "Guideline"
date: "2026-07-28"
lang: "en-US"
schema: "portable-alignment-guideline/v1"
frontmatter_contract: "required"
status: "spec-complete"
universal_scope: "true"
runtime_scope: "alignment-audit"
owner: "alignment-audit-contract"
---

# Portable Alignment Guideline

This fixture applies universally. Product names below appear only in labelled
reference-implementation examples.

## Problem validation

Gate: `problem-validation`

Entry condition: the problem statement is observable.

Exit condition: record a return-on-investment document, a 12-month
total-cost-of-ownership value, a token budget, and a time-to-value estimate.

Required evidence: a recorded economics assessment.

- Directive: Record the four economics statements in an auditable document.

## Requirements authoring

Gate: `requirements-authoring`

Entry condition: the economics assessment exists.

Exit condition: every acceptance criterion names an observable end state.

Required evidence: a requirements check result.

- [ ] A requirements document must record a measurable completion condition.

## Architecture authoring

Gate: `architecture-authoring`

Entry condition: observable requirements exist.

Exit condition: record a component table, contract schema, topology diagram,
and bounded harness check.

Required evidence: an architecture contract check.

- Directive: The runtime must provide a named contract schema and topology table.

## Alignment review

Gate: `alignment-review`

Entry condition: requirements and architecture are addressable.

Exit condition: every artifact-bearing element links to a runtime artifact.

Required evidence: a traceability closure check.

- [ ] Record the bidirectional traceability table.

## Implementation

Gate: `implementation`

Entry condition: alignment review is complete.

Exit condition: a runtime module exists for every required contract.

Required evidence: an implementation inventory.

- Required field: `runtime_module`

## Local proof

Gate: `local-proof`

Entry condition: the implementation inventory is complete.

Exit condition: a reproducible local validation command records a passing result.

Required evidence: a local validation result.

- Directive: Run and record the named local check.

## Release readiness

Gate: `release-readiness`

Entry condition: local proof is complete.

Exit condition: every linked completion condition carries evidence.

Required evidence: an evidence-closure result.

- Anti-pattern: Do not claim runtime-ready without evidence. Correct by
  recording the check, result, and constraint.
